from __future__ import annotations

from datetime import datetime
from collections.abc import Mapping
from uuid import UUID

from yali.ai.gateway import AiGateway
from yali.ai.protocols import (
    GenerationMetadata,
    ImageGenerationRequest,
    ImageProvider,
    Operation,
    TTSGenerationRequest,
    TTSProvider,
)
from yali.content.service import apply_cut_regeneration
from yali.domain.commands import RegenerateOptions
from yali.domain.models import Cut, IdeaDraft, IdeaVersion, Project
from yali.domain.video_settings import TTSSettings, merge_video_settings
from yali.jobs.models import QueuedJob
from yali.jobs.queue import JobNotFoundError, PersistentJobQueue
from yali.ai.providers.codex_image import CodexImageError
from yali.media.generator import GeneratedCutVisual, attach_generated_cut_visual
from yali.media.audio import GeneratedCutAudio, attach_generated_cut_audio
from yali.media.render_client import RenderWorkerClient
from yali.media.aspect import target_aspect_ratio_for_project
from yali.rendering.manifest import OutputManifest
from yali.storage.project_store import CutLockedError, CutNotFoundError, ProjectRevisionConflict, ProjectStore


class JobProcessingError(RuntimeError):
    """Raised when a queued job cannot be handled by the MVP processor."""

    def __init__(self, message: str, *, public_message: str | None = None) -> None:
        super().__init__(message)
        self.public_message = public_message


class JobProcessor:
    """Apply queued generation results to the same persistent project store."""

    def __init__(
        self,
        store: ProjectStore,
        gateway: AiGateway,
        *,
        image_provider: ImageProvider | None = None,
        tts_provider: TTSProvider | None = None,
        queue: PersistentJobQueue | None = None,
        render_client: RenderWorkerClient | None = None,
    ) -> None:
        self.store = store
        self.gateway = gateway
        self.image_provider = image_provider
        self.tts_provider = tts_provider
        self.queue = queue
        self.render_client = render_client

    def __call__(self, job: QueuedJob) -> None:
        if job.kind == "idea.generate":
            self._process_idea(job)
            return
        if job.kind == "cut.regenerate":
            self._process_cut_regeneration(job)
            return
        if job.kind in {"tts.preview", "tts.generate"}:
            self._process_tts(job)
            return
        if job.kind == "output.render":
            self._process_output_render(job)
            return
        raise JobProcessingError("Unsupported queued job kind") from None

    def _process_idea(self, job: QueuedJob) -> None:
        project = self.store.get(job.project_id)
        expected_revision = project.updated_at
        try:
            draft = IdeaDraft.model_validate(job.payload.get("draft", {}))
            result = self.gateway.generate(
                Operation.GENERATE_IDEA,
                draft.model_dump(mode="json"),
                project_id=str(project.id),
                request_id=str(job.id),
            )
            if self._job_is_cancelled(job.id):
                return
            current = self.store.get(job.project_id)
            if (
                current.updated_at != expected_revision
                or current.idea.generation_job_id != job.id
                or current.idea.draft != draft
            ):
                raise JobProcessingError("Idea generation result is stale") from None
            data = result.data
            version = IdeaVersion(
                headline=_text(data.get("title") or data.get("headline"), draft.topic),
                summary=_text(data.get("summary") or data.get("angle"), draft.source_text or draft.topic),
                key_points=_key_points(data.get("key_points")),
                content=data,
                source=draft,
            )
            current.idea.draft = draft
            current.idea.versions.append(version)
            current.idea.active_version_id = version.id
            current.idea.generation_job_id = job.id
            current.idea.generation_status = "completed"
            current.idea.generation_error = None
            self.store.update_if_unchanged(current, expected_updated_at=expected_revision)
        except JobProcessingError:
            raise
        except Exception:
            self._mark_idea_failed(job.id)
            raise JobProcessingError("Idea generation failed") from None

    def _process_cut_regeneration(self, job: QueuedJob) -> None:
        project = self.store.get(job.project_id)
        queued_revision = _parse_revision(job.payload.get("project_updated_at"))
        raw_options = job.payload.get("options", {})
        image_only = isinstance(raw_options, Mapping) and raw_options.get("image_only") is True
        options = RegenerateOptions.model_validate(raw_options)
        if not image_only and queued_revision is not None and project.updated_at != queued_revision:
            raise JobProcessingError("Cut regeneration request is stale") from None
        cut_id = job.cut_id
        if cut_id is None:
            raise JobProcessingError("Cut regeneration job is missing a cut") from None
        cut = next(
            (cut for scene in project.scenes for cut in scene.cuts if cut.id == cut_id),
            None,
        )
        if cut is None:
            raise CutNotFoundError(f"Cut not found in project {project.id}: {cut_id}")
        if self._job_is_cancelled(job.id):
            return
        queued_active_version_id = job.payload.get("active_version_id")
        current_active_version_id = str(cut.active_version_id) if cut.active_version_id else None
        if queued_active_version_id != current_active_version_id:
            raise JobProcessingError("Cut regeneration request is stale") from None
        if image_only:
            self._process_image_only_cut(
                job,
                project=project,
                cut=cut,
                options=options,
                expected_active_version_id=cut.active_version_id,
            )
            return

        expected_revision = queued_revision or project.updated_at
        result_data: Mapping[str, object] = {}
        if not image_only:
            result = self.gateway.generate(
                Operation.REGENERATE_CUT,
                {
                    "cut": {
                        "id": str(cut.id),
                        "order": cut.order,
                        "title": cut.title,
                        "duration_ms": cut.duration_ms,
                        "visual_prompt": cut.visual_prompt,
                        "narration_text": cut.narration_text,
                        "subtitle": cut.subtitle,
                        "motion_preset": cut.motion_preset,
                    },
                    "options": options.model_dump(mode="json", exclude_none=True),
                },
                project_id=str(project.id),
                cut_id=str(cut.id),
                request_id=str(job.id),
            )
            result_data = result.data
        if self._job_is_cancelled(job.id):
            return

        generated = result_data.get("cut")
        generated_options = _generated_regeneration_options(generated)
        merged_options = RegenerateOptions(
            visual_prompt=options.visual_prompt if options.visual_prompt is not None else generated_options.visual_prompt,
            narration_text=options.narration_text if options.narration_text is not None else generated_options.narration_text,
            subtitle=options.subtitle if options.subtitle is not None else generated_options.subtitle,
            motion_preset=options.motion_preset if options.motion_preset is not None else generated_options.motion_preset,
        )
        current = self.store.get(job.project_id)
        current_cut = next(
            (item for scene in current.scenes for item in scene.cuts if item.id == cut_id),
            None,
        )
        if current.updated_at != expected_revision or current_cut is None:
            raise JobProcessingError("Cut regeneration result is stale") from None
        if current_cut.locked:
            raise JobProcessingError("Cut is locked") from None
        if (
            (str(current_cut.active_version_id) if current_cut.active_version_id else None)
            != current_active_version_id
        ):
            raise JobProcessingError("Cut regeneration result is stale") from None
        if self._job_is_cancelled(job.id):
            return
        apply_cut_regeneration(current_cut, merged_options)
        generated_visuals: list[GeneratedCutVisual] = []
        should_generate_image = (
            image_only
            or merged_options.visual_prompt is not None
            or current_cut.media_asset_id is None
        )
        if should_generate_image:
            try:
                if self.image_provider is None:
                    raise JobProcessingError(
                        "Cut image provider is not configured",
                        public_message="이미지 생성 Provider가 설정되지 않았습니다.",
                    )
                model_name = _provider_model(self.image_provider)
                target_aspect_ratio = target_aspect_ratio_for_project(current)
                response = self.image_provider.generate(
                    ImageGenerationRequest(
                        prompt=current_cut.visual_prompt,
                        model_name=model_name,
                        aspect_ratio=target_aspect_ratio,
                        metadata=GenerationMetadata(
                            request_id=str(job.id),
                            project_id=str(current.id),
                            cut_id=str(current_cut.id),
                            operation=Operation.REGENERATE_CUT,
                            model=model_name,
                        ),
                    )
                )
                generated_visuals.append(
                    attach_generated_cut_visual(
                        current,
                        current_cut,
                        self.store.projects_root / str(current.id) / "assets",
                        content=response.content,
                        media_type=response.media_type,
                        expected_aspect_ratio=target_aspect_ratio,
                    )
                )
            except JobProcessingError:
                self._mark_cut_failed(
                    current,
                    expected_revision,
                    cut_id,
                    "이미지 생성 Provider가 설정되지 않았습니다.",
                )
                raise
            except Exception as error:
                message = _image_generation_error(error)
                self._mark_cut_failed(current, expected_revision, cut_id, message)
                raise JobProcessingError("Cut image generation failed", public_message=message) from None
        try:
            self.store.update_if_unchanged(
                current,
                expected_updated_at=expected_revision,
                guard=lambda: not self._job_is_cancelled(job.id),
            )
        except ProjectRevisionConflict:
            _discard_generated_visuals(generated_visuals)
            if self._job_is_cancelled(job.id):
                return
            raise
        except Exception:
            _discard_generated_visuals(generated_visuals)
            raise

    def _process_image_only_cut(
        self,
        job: QueuedJob,
        *,
        project: Project,
        cut: Cut,
        options: RegenerateOptions,
        expected_active_version_id: UUID | None,
    ) -> None:
        if self.image_provider is None:
            message = "이미지 생성 Provider가 설정되지 않았습니다."
            self._mark_cut_failed_for_version(
                job.id,
                job.project_id,
                cut.id,
                expected_active_version_id,
                message,
            )
            raise JobProcessingError("Cut image provider is not configured", public_message=message)

        target_aspect_ratio = target_aspect_ratio_for_project(project)
        model_name = _provider_model(self.image_provider)
        prompt = options.visual_prompt if options.visual_prompt is not None else cut.visual_prompt
        generated_visuals: list[GeneratedCutVisual] = []
        try:
            response = self.image_provider.generate(
                ImageGenerationRequest(
                    prompt=prompt,
                    model_name=model_name,
                    aspect_ratio=target_aspect_ratio,
                    metadata=GenerationMetadata(
                        request_id=str(job.id),
                        project_id=str(project.id),
                        cut_id=str(cut.id),
                        operation=Operation.REGENERATE_CUT,
                        model=model_name,
                    ),
                )
            )
            if self._job_is_cancelled(job.id):
                return

            def apply_image(current: Project, current_cut: Cut) -> None:
                if target_aspect_ratio_for_project(current) != target_aspect_ratio:
                    raise ProjectRevisionConflict("Project image target changed before update")
                apply_cut_regeneration(current_cut, options)
                generated_visuals.append(
                    attach_generated_cut_visual(
                        current,
                        current_cut,
                        self.store.projects_root / str(current.id) / "assets",
                        content=response.content,
                        media_type=response.media_type,
                        expected_aspect_ratio=target_aspect_ratio,
                    )
                )

            self.store.update_cut_if_current(
                job.project_id,
                cut.id,
                expected_active_version_id=expected_active_version_id,
                update=apply_image,
                guard=lambda: not self._job_is_cancelled(job.id),
            )
        except ProjectRevisionConflict:
            _discard_generated_visuals(generated_visuals)
            if self._job_is_cancelled(job.id):
                return
            raise
        except CutLockedError:
            _discard_generated_visuals(generated_visuals)
            raise JobProcessingError(
                "Cut is locked",
                public_message="잠긴 컷은 다시 만들 수 없습니다.",
            ) from None
        except Exception as error:
            _discard_generated_visuals(generated_visuals)
            message = _image_generation_error(error)
            self._mark_cut_failed_for_version(
                job.id,
                job.project_id,
                cut.id,
                expected_active_version_id,
                message,
            )
            raise JobProcessingError("Cut image generation failed", public_message=message) from None

    def _process_tts(self, job: QueuedJob) -> None:
        if self.tts_provider is None:
            raise JobProcessingError(
                "TTS provider is not configured",
                public_message="음성 생성 Provider가 설정되지 않았습니다.",
            )
        cut_id = job.cut_id
        if cut_id is None:
            raise JobProcessingError("TTS job is missing a cut") from None
        try:
            snapshot_settings = TTSSettings.model_validate(job.payload.get("audio_settings", {}))
            narration_text = _required_text(job.payload.get("narration_text"))
            expected_active_version_id = _uuid_from_payload(job.payload.get("active_version_id"))
        except ValueError:
            raise JobProcessingError("TTS job payload is invalid") from None

        project = self.store.get(job.project_id)
        cut = _find_cut(project, cut_id)
        if cut is None:
            raise CutNotFoundError(f"Cut not found in project {project.id}: {cut_id}")
        try:
            _ensure_tts_snapshot(cut, project, narration_text, snapshot_settings, expected_active_version_id)
        except CutLockedError as error:
            raise JobProcessingError(
                "Cut is locked",
                public_message="잠긴 컷은 음성을 생성할 수 없습니다.",
            ) from error
        except ProjectRevisionConflict as error:
            raise JobProcessingError(
                "TTS request is stale",
                public_message="음성 생성 요청의 대본 또는 설정이 변경되었습니다. 다시 시도해 주세요.",
            ) from error
        if snapshot_settings.provider != self.tts_provider.name:
            raise JobProcessingError(
                "TTS provider is unavailable",
                public_message="선택한 음성 엔진을 현재 사용할 수 없습니다.",
            )
        if not snapshot_settings.enabled:
            raise JobProcessingError(
                "TTS is disabled",
                public_message="현재 컷의 TTS가 꺼져 있습니다.",
            )
        if self._job_is_cancelled(job.id):
            return

        try:
            response = self.tts_provider.generate(
                TTSGenerationRequest(
                    text=narration_text,
                    language=snapshot_settings.language,
                    voice_id=snapshot_settings.voice_id,
                    speed=snapshot_settings.speed,
                    volume=snapshot_settings.volume,
                    pitch=snapshot_settings.pitch,
                    metadata=GenerationMetadata(
                        request_id=str(job.id),
                        project_id=str(project.id),
                        cut_id=str(cut.id),
                        operation=Operation.GENERATE_TTS,
                        model=None,
                    ),
                )
            )
        except Exception as error:
            message = _tts_generation_error(error)
            raise JobProcessingError("TTS generation failed", public_message=message) from None
        if self._job_is_cancelled(job.id):
            return

        generated_audio: list[GeneratedCutAudio] = []
        try:
            def attach_audio(current: Project, current_cut: Cut) -> None:
                _ensure_tts_snapshot(
                    current_cut,
                    current,
                    narration_text,
                    snapshot_settings,
                    expected_active_version_id,
                )
                generated_audio.append(
                    attach_generated_cut_audio(
                        current,
                        current_cut,
                        self.store.projects_root / str(current.id) / "assets",
                        content=response.content,
                        media_type=response.media_type,
                    )
                )

            self.store.update_cut_if_current(
                job.project_id,
                cut_id,
                expected_active_version_id=expected_active_version_id,
                update=attach_audio,
                guard=lambda: not self._job_is_cancelled(job.id),
            )
        except ProjectRevisionConflict as error:
            _discard_generated_audio(generated_audio)
            if self._job_is_cancelled(job.id):
                return
            raise JobProcessingError(
                "TTS result is stale",
                public_message="음성 생성 중 컷의 대본 또는 음성 설정이 변경되었습니다. 다시 시도해 주세요.",
            ) from error
        except CutLockedError as error:
            _discard_generated_audio(generated_audio)
            raise JobProcessingError(
                "Cut is locked",
                public_message="잠긴 컷은 음성을 생성할 수 없습니다.",
            ) from error
        except Exception as error:
            _discard_generated_audio(generated_audio)
            raise JobProcessingError("TTS asset persistence failed") from error

    def _process_output_render(self, job: QueuedJob) -> None:
        if self.render_client is None:
            raise JobProcessingError("Render worker is not configured") from None
        try:
            manifest = OutputManifest.model_validate(job.payload.get("manifest", {}))
        except Exception:
            raise JobProcessingError("Output render manifest is invalid") from None
        if manifest.project_id != job.project_id:
            raise JobProcessingError("Output render project does not match the job") from None

        expected_revision = _parse_revision(job.payload.get("project_updated_at"))
        project = self.store.get(job.project_id)
        if expected_revision is not None and project.updated_at != expected_revision:
            raise JobProcessingError("Output render request is stale") from None

        final_output_path = f"outputs/{manifest.output_variant_id}.mp4"
        staged_output_path = f"outputs/.{manifest.output_variant_id}.{job.id}.mp4"
        quality = _render_quality(job.payload.get("quality"))
        staged_path = self.store.projects_root / str(project.id) / staged_output_path
        try:
            self.render_client.render(
                manifest,
                project_root=self.store.projects_root / str(project.id),
                output_path=staged_output_path,
                quality=quality,
            )
            if self._job_is_cancelled(job.id):
                return
            self.store.finalize_output_file(
                project.id,
                manifest.output_variant_id,
                staged_output_path,
                final_output_path,
                expected_updated_at=expected_revision,
                guard=lambda: not self._job_is_cancelled(job.id),
            )
        except ProjectRevisionConflict:
            if self._job_is_cancelled(job.id):
                return
            raise
        finally:
            staged_path.unlink(missing_ok=True)

    def _job_is_cancelled(self, job_id: UUID) -> bool:
        if self.queue is None:
            return False
        try:
            return self.queue.get(job_id).status == "cancelled"
        except JobNotFoundError:
            return True

    def _mark_idea_failed(self, job_id: UUID) -> None:
        try:
            if self._job_is_cancelled(job_id):
                return
            project = self.store.get(self._project_id_for_job(job_id))
            if project.idea.generation_status == "cancelled":
                return
            if project.idea.generation_job_id not in {None, job_id}:
                return
            expected_revision = project.updated_at
            project.idea.generation_job_id = job_id
            project.idea.generation_status = "failed"
            project.idea.generation_error = "아이디어 생성에 실패했습니다."
            self.store.update_if_unchanged(project, expected_updated_at=expected_revision)
        except Exception:
            return

    def _project_id_for_job(self, job_id: UUID) -> UUID:
        if self.queue is None:
            raise JobProcessingError("Job queue is required for failure recovery") from None
        return self.queue.get(job_id).project_id

    def _mark_cut_failed(
        self,
        project: Project,
        expected_revision: datetime,
        cut_id: UUID,
        message: str,
    ) -> None:
        try:
            cut = next(
                (item for scene in project.scenes for item in scene.cuts if item.id == cut_id),
                None,
            )
            if cut is None or cut.locked:
                return
            cut.status = "failed"
            cut.error = message
            self.store.update_if_unchanged(project, expected_updated_at=expected_revision)
        except Exception:
            return

    def _mark_cut_failed_for_version(
        self,
        job_id: UUID,
        project_id: UUID,
        cut_id: UUID,
        expected_active_version_id: UUID | None,
        message: str,
    ) -> None:
        try:
            self.store.update_cut_if_current(
                project_id,
                cut_id,
                expected_active_version_id=expected_active_version_id,
                update=lambda _project, cut: self._set_cut_failure(cut, message),
                guard=lambda: not self._job_is_cancelled(job_id),
            )
        except Exception:
            return

    @staticmethod
    def _set_cut_failure(cut: Cut, message: str) -> None:
        cut.status = "failed"
        cut.error = message


def _text(value: object, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()[:5_000]
    return fallback.strip()[:5_000] or "새 콘텐츠 아이디어"


def _find_cut(project: Project, cut_id: UUID) -> Cut | None:
    return next(
        (cut for scene in project.scenes for cut in scene.cuts if cut.id == cut_id),
        None,
    )


def _required_text(value: object) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()[:5_000]
    raise ValueError("TTS narration text is missing")


def _uuid_from_payload(value: object) -> UUID | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    if isinstance(value, str):
        try:
            return UUID(value)
        except ValueError:
            pass
    raise ValueError("TTS active version is invalid")


def _ensure_tts_snapshot(
    cut: Cut,
    project: Project,
    narration_text: str,
    audio_settings: TTSSettings,
    expected_active_version_id: UUID | None,
) -> None:
    if cut.locked:
        raise CutLockedError(f"Cut is locked: {cut.id}")
    if cut.active_version_id != expected_active_version_id:
        raise ProjectRevisionConflict(f"Cut changed before TTS update: {cut.id}")
    current_version = _active_version(cut)
    current_text = current_version.narration_text if current_version is not None else cut.narration_text
    if current_text.strip() != narration_text:
        raise ProjectRevisionConflict(f"Cut narration changed before TTS update: {cut.id}")
    current_settings = merge_video_settings(project.video_settings, cut.video_settings_overrides).audio
    if current_settings != audio_settings:
        raise ProjectRevisionConflict(f"Cut audio settings changed before TTS update: {cut.id}")


def _active_version(cut: Cut):
    if not cut.versions:
        return None
    if cut.active_version_id is None:
        return cut.versions[-1]
    return next((version for version in cut.versions if version.id == cut.active_version_id), None)


def _key_points(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip()[:500] for item in value if isinstance(item, str) and item.strip()][:8]


def _parse_revision(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise JobProcessingError("Output render revision is invalid") from None


def _render_quality(value: object) -> str:
    if value in {"draft", "standard", "high"}:
        return str(value)
    return "draft"


def _provider_model(provider: ImageProvider) -> str | None:
    model = getattr(provider, "model", None)
    return model.strip() or None if isinstance(model, str) else None


def _image_generation_error(error: Exception) -> str:
    if isinstance(error, CodexImageError) and str(error).strip():
        return f"이미지 생성에 실패했습니다. {str(error).strip()}"[:500]
    return "이미지 생성에 실패했습니다. Codex ImageGen 결과를 확인해 주세요."


def _generated_regeneration_options(value: object) -> RegenerateOptions:
    if not isinstance(value, Mapping):
        return RegenerateOptions()

    def optional_text(key: str) -> str | None:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
        return None

    return RegenerateOptions(
        visual_prompt=optional_text("visual_prompt"),
        narration_text=optional_text("narration_text"),
        subtitle=optional_text("subtitle"),
        motion_preset=optional_text("motion_preset"),
    )


def _discard_generated_visuals(visuals: list[GeneratedCutVisual]) -> None:
    for visual in visuals:
        if visual.created:
            visual.path.unlink(missing_ok=True)


def _discard_generated_audio(audio_files: list[GeneratedCutAudio]) -> None:
    for audio in audio_files:
        if audio.created:
            audio.path.unlink(missing_ok=True)


def _tts_generation_error(error: Exception) -> str:
    if isinstance(error, ValueError):
        return "음성 생성 결과를 확인할 수 없습니다."
    return "음성 생성에 실패했습니다. Edge TTS 연결을 확인해 주세요."

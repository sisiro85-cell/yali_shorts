from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, Query, Request, status
from pydantic import BaseModel, Field, field_validator

from yali.api.dependencies import get_job_queue, get_project_store
from yali.api.errors import ApiValidationError, IdeaJobStateError
from yali.domain.enums import ProjectStage
from yali.domain.models import IdeaDraft, IdeaVersion, MediaAsset, ProjectPreviewMedia
from yali.jobs.models import JobAccepted, JobStatusResponse, QueuedJob
from yali.jobs.queue import JobNotFoundError, PersistentJobQueue
from yali.media.probe import detect_image_dimensions
from yali.storage.project_store import ProjectStore

router = APIRouter(prefix="/projects/{project_id}/ideas", tags=["ideas"])

_FORMAT_ORDER = {"shorts": 0, "reels": 1, "card_news": 2}
_PREVIEWABLE_MEDIA_TYPES = {"image", "video"}
_MAX_REFERENCE_ASSET_BYTES = 50_000_000
_IMAGE_PROBE_BYTES = 1_000_000


class IdeaGenerateRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=500)
    source_text: str = Field(default="", max_length=100_000)
    formats: set[Literal["shorts", "reels", "card_news"]] = Field(min_length=1)
    reference_asset_ids: list[UUID] = Field(default_factory=list)

    @field_validator("topic")
    @classmethod
    def topic_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("주제 또는 키워드를 입력해 주세요.")
        return value


class IdeaDraftRequest(BaseModel):
    topic: str = Field(default="", max_length=500)
    source_text: str = Field(default="", max_length=100_000)
    formats: set[Literal["shorts", "reels", "card_news"]] = Field(default_factory=set)
    reference_asset_ids: list[UUID] = Field(default_factory=list)


class IdeaDraftResponse(BaseModel):
    topic: str
    source_text: str
    formats: list[Literal["shorts", "reels", "card_news"]]
    reference_asset_ids: list[UUID]
    updated_at: str

    @classmethod
    def from_draft(cls, draft: IdeaDraft) -> "IdeaDraftResponse":
        return cls(
            topic=draft.topic,
            source_text=draft.source_text,
            formats=draft.formats,
            reference_asset_ids=draft.reference_asset_ids,
            updated_at=draft.updated_at.isoformat(),
        )


class IdeaReferenceAssetResponse(BaseModel):
    id: UUID
    filename: str
    media_type: Literal["image", "video", "audio", "other"]
    created_at: str
    preview_media: ProjectPreviewMedia | None = None

    @classmethod
    def from_asset(cls, project_id: UUID, asset: MediaAsset) -> "IdeaReferenceAssetResponse":
        preview = None
        if asset.media_type in _PREVIEWABLE_MEDIA_TYPES and asset.width and asset.height:
            preview = ProjectPreviewMedia(
                url=f"/api/projects/{project_id}/assets/{asset.id}/preview",
                media_type=asset.media_type,
                width=asset.width,
                height=asset.height,
                alt=f"참고 자료 원본 미디어: {asset.filename}",
            )
        return cls(
            id=asset.id,
            filename=asset.filename,
            media_type=asset.media_type,
            created_at=asset.created_at.isoformat(),
            preview_media=preview,
        )


class IdeaVersionResponse(BaseModel):
    id: UUID
    headline: str
    summary: str
    key_points: list[str]
    created_at: str

    @classmethod
    def from_version(cls, version: IdeaVersion) -> "IdeaVersionResponse":
        return cls(
            id=version.id,
            headline=version.headline,
            summary=version.summary,
            key_points=version.key_points,
            created_at=version.created_at.isoformat(),
        )


class IdeaPageResponse(BaseModel):
    project_id: UUID
    project_title: str
    stage: ProjectStage
    draft: IdeaDraftResponse
    reference_assets: list[IdeaReferenceAssetResponse]
    generation_job: JobStatusResponse | None = None
    active_version: IdeaVersionResponse | None = None


class IdeaCompletionRequest(BaseModel):
    job_id: UUID | None = None
    headline: str = Field(min_length=1, max_length=500)
    summary: str = Field(min_length=1, max_length=5_000)
    key_points: list[str] = Field(default_factory=list, max_length=8)
    content: dict[str, Any] = Field(default_factory=dict)
    source: IdeaGenerateRequest | None = None


@router.get("", response_model=IdeaPageResponse, response_model_exclude_none=True)
def get_idea_page(
    project_id: UUID,
    store: ProjectStore = Depends(get_project_store),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
) -> IdeaPageResponse:
    project = store.get(project_id)
    return _build_response(project_id, project.title, project.stage, project.idea.draft, project.assets, project.idea, job_queue)


@router.patch("/draft", response_model=IdeaPageResponse, response_model_exclude_none=True)
def save_idea_draft(
    project_id: UUID,
    request: IdeaDraftRequest,
    store: ProjectStore = Depends(get_project_store),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
) -> IdeaPageResponse:
    project = store.get(project_id)
    _validate_reference_assets(project.assets, request.reference_asset_ids)
    project.idea.draft = _draft_from_request(request)
    store.update(project)
    return _build_response(project_id, project.title, project.stage, project.idea.draft, project.assets, project.idea, job_queue)


@router.post("/assets", response_model=IdeaPageResponse, response_model_exclude_none=True)
async def upload_idea_reference_asset(
    project_id: UUID,
    request: Request,
    filename: str = Query(min_length=1, max_length=255),
    store: ProjectStore = Depends(get_project_store),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
) -> IdeaPageResponse:
    project = store.get(project_id)
    safe_filename = Path(unquote(filename)).name.strip()
    if not safe_filename or safe_filename in {".", ".."}:
        raise ApiValidationError([_file_error("파일 이름을 확인해 주세요.")])
    media_type = _media_type_from_content_type(request.headers.get("content-type", ""))
    relative_path = f"assets/{uuid4().hex}-{safe_filename}"
    asset_path = store.projects_root / str(project_id) / relative_path
    temporary_path = asset_path.with_name(f".{asset_path.name}.uploading")
    asset_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        content_hash, probe_content = await _stream_upload(request, temporary_path)
        dimensions = (
            detect_image_dimensions(probe_content, request.headers.get("content-type", ""))
            if media_type == "image"
            else None
        )
        asset = MediaAsset(
            filename=safe_filename,
            relative_path=relative_path,
            media_type=media_type,
            width=dimensions[0] if dimensions else None,
            height=dimensions[1] if dimensions else None,
            content_hash=content_hash,
        )
        temporary_path.replace(asset_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    previous_project = project.model_copy(deep=True)
    project.assets.append(asset)
    try:
        store.update(project)
    except Exception:
        asset_path.unlink(missing_ok=True)
        try:
            store.restore(previous_project)
        except Exception:
            pass
        raise
    return _build_response(project_id, project.title, project.stage, project.idea.draft, project.assets, project.idea, job_queue)


@router.post("/generate", response_model=JobAccepted, status_code=status.HTTP_202_ACCEPTED)
def generate_idea(
    project_id: UUID,
    request: IdeaGenerateRequest,
    http_request: Request,
    idempotency_key_header: str | None = Header(default=None, alias="Idempotency-Key"),
    store: ProjectStore = Depends(get_project_store),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
) -> JobAccepted:
    project = store.get(project_id)
    _validate_reference_assets(project.assets, request.reference_asset_ids)
    draft = _draft_from_request(request)
    job = job_queue.enqueue(
        project_id=project_id,
        kind="idea.generate",
        idempotency_key=idempotency_key_header or str(uuid4()),
        payload={
            "project_id": str(project_id),
            "draft": draft.model_dump(mode="json"),
        },
    )
    project.idea.draft = draft
    project.idea.generation_job_id = job.id
    project.idea.generation_status = job.status
    project.idea.generation_error = None
    try:
        store.update(project)
    except Exception:
        job_queue.discard(job.id)
        raise
    runner = getattr(http_request.app.state, "job_runner", None)
    if runner is not None:
        runner.submit(job)
    return JobAccepted(job_id=job.id, status=job.status)


@router.post("/jobs/{job_id}/cancel", response_model=JobStatusResponse)
def cancel_idea_generation(
    project_id: UUID,
    job_id: UUID,
    store: ProjectStore = Depends(get_project_store),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
) -> JobStatusResponse:
    project = store.get(project_id)
    job = job_queue.get(job_id)
    if job.project_id != project_id or job.kind != "idea.generate":
        raise JobNotFoundError(f"Job not found: {job_id}")
    if job.status in {"completed", "failed", "cancelled"}:
        return JobStatusResponse.from_job(job)
    previous_project = project.model_copy(deep=True)
    project.idea.generation_job_id = job.id
    project.idea.generation_status = "cancelled"
    project.idea.generation_error = None
    project_persisted = False
    queue_transition_attempted = False
    try:
        store.update(project)
        project_persisted = True
        queue_transition_attempted = True
        cancelled = job_queue.cancel(job_id)
    except Exception:
        if queue_transition_attempted:
            _restore_job_after_failed_transition(job_queue, job, expected_status="cancelled")
        if project_persisted:
            store.restore(previous_project)
        raise
    return JobStatusResponse.from_job(cancelled)


@router.post("/complete", response_model=IdeaPageResponse, response_model_exclude_none=True)
def complete_idea_generation(
    project_id: UUID,
    request: IdeaCompletionRequest,
    store: ProjectStore = Depends(get_project_store),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
) -> IdeaPageResponse:
    project = store.get(project_id)
    previous_project = project.model_copy(deep=True)
    if request.job_id is not None:
        job = job_queue.get(request.job_id)
        if job.project_id != project_id or job.kind != "idea.generate":
            raise JobNotFoundError(f"Job not found: {request.job_id}")
        if job.status in {"failed", "cancelled"}:
            raise IdeaJobStateError(job.id, job.status)
    source_request = request.source or IdeaGenerateRequest(
        topic=project.idea.draft.topic or request.headline,
        source_text=project.idea.draft.source_text,
        formats=set(project.idea.draft.formats or ["shorts"]),
        reference_asset_ids=project.idea.draft.reference_asset_ids,
    )
    _validate_reference_assets(project.assets, source_request.reference_asset_ids)
    version = IdeaVersion(
        headline=request.headline.strip(),
        summary=request.summary.strip(),
        key_points=[item.strip() for item in request.key_points if item.strip()],
        content=request.content,
        source=_draft_from_request(source_request),
    )
    project.idea.versions.append(version)
    project.idea.active_version_id = version.id
    project.idea.draft = version.source
    project.idea.generation_status = "completed"
    project.idea.generation_error = None
    project_persisted = False
    queue_transition_attempted = False
    if request.job_id is not None:
        project.idea.generation_job_id = request.job_id
    try:
        store.update(project)
        project_persisted = True
        if request.job_id is not None:
            queue_transition_attempted = True
            job_queue.set_status(request.job_id, status="completed", progress=100, error=None)
    except Exception:
        if request.job_id is not None and queue_transition_attempted:
            _restore_job_after_failed_transition(job_queue, job, expected_status="completed")
        if project_persisted:
            store.restore(previous_project)
        raise
    return _build_response(project_id, project.title, project.stage, project.idea.draft, project.assets, project.idea, job_queue)


def _restore_job_after_failed_transition(
    job_queue: PersistentJobQueue,
    previous_job: QueuedJob,
    *,
    expected_status: Literal["completed", "cancelled"],
) -> None:
    """Undo a queue transition only when the target state was actually persisted."""
    try:
        current_job = job_queue.get(previous_job.id)
    except JobNotFoundError:
        return
    if current_job.status != expected_status:
        return
    job_queue.set_status(
        previous_job.id,
        status=previous_job.status,
        progress=previous_job.progress,
        error=previous_job.error,
    )


def _build_response(
    project_id: UUID,
    project_title: str,
    stage: ProjectStage,
    draft: IdeaDraft,
    assets: list[MediaAsset],
    idea_state,
    job_queue: PersistentJobQueue,
) -> IdeaPageResponse:
    job_response = None
    if idea_state.generation_job_id is not None:
        try:
            job = job_queue.get(idea_state.generation_job_id)
            job_response = JobStatusResponse.from_job(job)
        except JobNotFoundError:
            job_response = None
    active_version = next((item for item in idea_state.versions if item.id == idea_state.active_version_id), None)
    if active_version is None and idea_state.versions:
        active_version = idea_state.versions[-1]
    return IdeaPageResponse(
        project_id=project_id,
        project_title=project_title,
        stage=stage,
        draft=IdeaDraftResponse.from_draft(draft),
        reference_assets=[IdeaReferenceAssetResponse.from_asset(project_id, asset) for asset in assets],
        generation_job=job_response,
        active_version=IdeaVersionResponse.from_version(active_version) if active_version is not None else None,
    )


def _draft_from_request(request: IdeaGenerateRequest | IdeaDraftRequest) -> IdeaDraft:
    return IdeaDraft(
        topic=request.topic.strip(),
        source_text=request.source_text,
        formats=sorted(request.formats, key=_FORMAT_ORDER.__getitem__),
        reference_asset_ids=request.reference_asset_ids,
    )


def _file_error(message: str) -> dict[str, object]:
    return {
        "loc": ["body", "file"],
        "msg": message,
        "type": "value_error.reference_file",
    }


async def _stream_upload(request: Request, temporary_path: Path) -> tuple[str, bytes]:
    digest = hashlib.sha256()
    probe = bytearray()
    total = 0
    with temporary_path.open("wb") as handle:
        async for chunk in request.stream():
            if not chunk:
                continue
            total += len(chunk)
            if total > _MAX_REFERENCE_ASSET_BYTES:
                raise ApiValidationError([_file_error("참고 자료는 50MB 이하만 등록할 수 있습니다.")])
            handle.write(chunk)
            digest.update(chunk)
            if len(probe) < _IMAGE_PROBE_BYTES:
                probe.extend(chunk[: _IMAGE_PROBE_BYTES - len(probe)])
    if total == 0:
        raise ApiValidationError([_file_error("등록할 파일이 없습니다.")])
    return digest.hexdigest(), bytes(probe)


def _media_type_from_content_type(content_type: str) -> Literal["image", "video", "audio", "other"]:
    media_type = content_type.split(";", 1)[0].strip().lower()
    if media_type.startswith("image/"):
        return "image"
    if media_type.startswith("video/"):
        return "video"
    if media_type.startswith("audio/"):
        return "audio"
    return "other"


def _validate_reference_assets(assets: list[MediaAsset], reference_asset_ids: list[UUID]) -> None:
    registered_ids = {asset.id for asset in assets}
    missing = [str(asset_id) for asset_id in reference_asset_ids if asset_id not in registered_ids]
    if not missing:
        return
    raise ApiValidationError(
        [
            {
                "loc": ["body", "reference_asset_ids"],
                "msg": "등록된 자료만 선택할 수 있습니다.",
                "type": "value_error.reference_asset_ids",
                "input": missing,
            }
        ]
    )

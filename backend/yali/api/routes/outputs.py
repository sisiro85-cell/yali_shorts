from __future__ import annotations

from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel, ConfigDict, Field
from fastapi.responses import FileResponse

from yali.api.dependencies import get_job_queue, get_project_store
from yali.api.errors import ApiValidationError
from yali.domain.models import OutputVariant, Project
from yali.domain.video_settings import ProjectVideoSettings
from yali.jobs.models import JobAccepted
from yali.jobs.queue import PersistentJobQueue
from yali.rendering.manifest import OutputManifest, SubtitleStyle, build_manifest
from yali.storage.project_store import MediaAssetNotFoundError, ProjectDataError, ProjectStore


router = APIRouter(prefix="/projects/{project_id}/output", tags=["output"])


class OutputManifestRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    output_format: Literal["shorts", "reels", "card_news"] = Field(alias="format")
    preset_id: str | None = Field(default=None, max_length=200)
    subtitle_style: SubtitleStyle | None = None
    video_settings: ProjectVideoSettings | None = None


class OutputRenderRequest(OutputManifestRequest):
    quality: Literal["draft", "standard", "high"] = "draft"


@router.post("/manifest", response_model=OutputManifest)
def create_output_manifest(
    project_id: UUID,
    request: OutputManifestRequest,
    store: ProjectStore = Depends(get_project_store),
) -> OutputManifest:
    project = store.get(project_id)
    manifest = _prepare_manifest(project, request, store)
    return manifest


@router.post("/render", response_model=JobAccepted, status_code=status.HTTP_202_ACCEPTED)
def queue_output_render(
    project_id: UUID,
    request: OutputRenderRequest,
    http_request: Request,
    idempotency_key_header: str | None = Header(default=None, alias="Idempotency-Key"),
    store: ProjectStore = Depends(get_project_store),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
) -> JobAccepted:
    project = store.get(project_id)
    manifest = _prepare_manifest(project, request, store)
    _validate_render_sources(project, manifest, store)
    job = job_queue.enqueue(
        project_id=project_id,
        kind="output.render",
        idempotency_key=idempotency_key_header or str(uuid4()),
        payload={
            "project_id": str(project_id),
            "project_updated_at": project.updated_at.isoformat(),
            "manifest": manifest.model_dump(mode="json"),
            "quality": request.quality,
        },
    )
    runner = getattr(http_request.app.state, "job_runner", None)
    if runner is not None:
        runner.submit(job)
    return JobAccepted(job_id=job.id, status=job.status)


@router.get("/{variant_id}/file")
def download_output_variant(
    project_id: UUID,
    variant_id: UUID,
    store: ProjectStore = Depends(get_project_store),
) -> FileResponse:
    path = store.get_output_path(project_id, variant_id)
    return FileResponse(path, media_type="video/mp4", filename=path.name)


def _variant_name(output_format: str) -> str:
    return {"shorts": "쇼츠", "reels": "릴스", "card_news": "카드뉴스"}[output_format]


def _prepare_manifest(
    project: Project,
    request: OutputManifestRequest,
    store: ProjectStore,
) -> OutputManifest:
    if not any(scene.cuts for scene in project.scenes):
        raise ApiValidationError(
            [{"loc": ["body", "format"], "msg": "출력할 컷을 먼저 생성해 주세요.", "type": "value_error.output_source"}]
        )
    if _cut_plan_is_stale(project):
        raise ApiValidationError(
            [{"loc": ["body", "format"], "msg": "대본 변경 후 컷 구성을 다시 생성해 주세요.", "type": "value_error.stale_cut_plan"}]
        )
    manifest = build_manifest(
        project,
        request.output_format,
        request.preset_id,
        request.subtitle_style,
        request.video_settings,
    )
    existing = next(
        (variant for variant in project.output_variants if variant.id == manifest.output_variant_id),
        None,
    )
    if existing is None:
        project.output_variants.append(
            OutputVariant(
                id=manifest.output_variant_id,
                name=_variant_name(request.output_format),
                format=request.output_format,
                preset_id=request.preset_id,
                cut_version_ids=manifest.cut_version_ids,
                subtitle_style=manifest.video_settings.subtitle.style.model_dump(mode="json"),
                video_settings=manifest.video_settings.model_dump(mode="json"),
                created_at=manifest.created_at,
            )
        )
        store.update(project)
    return manifest


def _cut_plan_is_stale(project: Project) -> bool:
    source_script_version_ids = {scene.source_script_version_id for scene in project.scenes}
    return project.script.active_version_id is None or source_script_version_ids != {project.script.active_version_id}


def _validate_render_sources(project: Project, manifest: OutputManifest, store: ProjectStore) -> None:
    assets = {asset.id: asset for asset in project.assets}
    errors: list[dict[str, object]] = []
    for cut in manifest.cuts:
        if cut.media_asset_id is None:
            errors.append(
                {
                    "loc": ["body", "format"],
                    "msg": f"{cut.cut_order}번째 컷의 미디어를 먼저 생성하거나 등록해 주세요.",
                    "type": "value_error.render_source",
                }
            )
            continue
        asset = assets.get(cut.media_asset_id)
        if asset is None or asset.media_type not in {"image", "video"}:
            errors.append(
                {
                    "loc": ["body", "format"],
                    "msg": f"{cut.cut_order}번째 컷에 사용할 이미지 또는 영상을 확인해 주세요.",
                    "type": "value_error.render_source",
                }
            )
    for asset in manifest.assets:
        try:
            store.get_asset_path(project.id, asset.asset_id)
        except (MediaAssetNotFoundError, ProjectDataError):
            errors.append(
                {
                    "loc": ["body", "format"],
                    "msg": f"원본 미디어 파일을 찾을 수 없습니다: {asset.filename}",
                    "type": "value_error.render_asset_file",
                }
            )
    if errors:
        raise ApiValidationError(errors)

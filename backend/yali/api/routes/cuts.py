from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel, Field

from yali.ai.gateway import AiGateway
from yali.api.dependencies import get_ai_gateway, get_job_queue, get_project_store
from yali.api.errors import ApiValidationError
from yali.content.models import CutPlanRequest
from yali.content.service import (
    DeterministicContentService,
    CutVersionNotFoundError,
    activate_cut_version,
    apply_cut_regeneration,
    cut_plan_to_scenes,
)
from yali.domain.commands import RegenerateOptions
from yali.domain.enums import ProjectStage
from yali.domain.models import Cut, CutVersion, Project, Scene
from yali.jobs.models import JobAccepted
from yali.jobs.queue import PersistentJobQueue
from yali.storage.project_store import CutNotFoundError, ProjectStore

router = APIRouter(prefix="/projects/{project_id}/cuts", tags=["cuts"])


class RegenerateCutRequest(RegenerateOptions):
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)
    image_only: bool = False


class CutLockResponse(BaseModel):
    cut_id: UUID
    locked: bool


class CutResponse(BaseModel):
    id: UUID
    order: int
    title: str
    duration_ms: int
    visual_prompt: str
    media_asset_id: UUID | None
    audio_asset_id: UUID | None
    narration_text: str
    subtitle: str
    motion_preset: str
    locked: bool
    status: str
    error: str | None
    active_version_id: UUID | None
    versions: list[CutVersion]

    @classmethod
    def from_cut(cls, cut: Cut) -> "CutResponse":
        return cls(**cut.model_dump())


class SceneResponse(BaseModel):
    id: UUID
    order: int
    title: str
    source_script_version_id: UUID | None
    cuts: list[CutResponse]

    @classmethod
    def from_scene(cls, scene: Scene) -> "SceneResponse":
        return cls(
            id=scene.id,
            order=scene.order,
            title=scene.title,
            source_script_version_id=scene.source_script_version_id,
            cuts=[CutResponse.from_cut(cut) for cut in scene.cuts],
        )


class CutBoardResponse(BaseModel):
    project_id: UUID
    project_title: str
    stage: ProjectStage
    script_version_id: UUID | None
    stale: bool = False
    scenes: list[SceneResponse]


class CutPlanGenerateRequest(BaseModel):
    model_name: str | None = Field(default=None, max_length=200)


@router.get("", response_model=CutBoardResponse)
def get_cut_board(
    project_id: UUID,
    store: ProjectStore = Depends(get_project_store),
) -> CutBoardResponse:
    return _board_response(store.get(project_id))


@router.post("/generate", response_model=CutBoardResponse)
def generate_cut_plan(
    project_id: UUID,
    request: CutPlanGenerateRequest,
    store: ProjectStore = Depends(get_project_store),
    gateway: AiGateway = Depends(get_ai_gateway),
) -> CutBoardResponse:
    project = store.get(project_id)
    script = _active_script(project)
    if script is None:
        raise ApiValidationError(
            [{"loc": ["body"], "msg": "대본을 먼저 생성해 주세요.", "type": "value_error.cut_source"}]
        )
    if any(cut.locked for scene in project.scenes for cut in scene.cuts):
        raise ApiValidationError(
            [{"loc": ["body"], "msg": "잠긴 컷이 있어 전체 컷을 다시 구성할 수 없습니다.", "type": "value_error.locked_cuts"}]
        )
    plan = asyncio.run(
        DeterministicContentService(gateway).generate_cut_plan(
            CutPlanRequest(script=script),
            model_name=request.model_name,
        )
    )
    project.scenes = cut_plan_to_scenes(
        plan,
        source_script_version_id=script.id,
    )
    project = _with_stage(project, ProjectStage.CUTS)
    store.update(project)
    return _board_response(project)


@router.post("/{cut_id}/regenerate/apply", response_model=CutResponse)
def apply_cut_regeneration_options(
    project_id: UUID,
    cut_id: UUID,
    request: RegenerateCutRequest,
    store: ProjectStore = Depends(get_project_store),
) -> CutResponse:
    project = store.get(project_id)
    cut = next(
        (cut for scene in project.scenes for cut in scene.cuts if cut.id == cut_id),
        None,
    )
    if cut is None:
        raise CutNotFoundError(f"Cut not found in project {project_id}: {cut_id}")
    options = RegenerateOptions.model_validate(
        request.model_dump(exclude={"idempotency_key", "image_only"})
    )
    apply_cut_regeneration(cut, options)
    store.update(project)
    return CutResponse.from_cut(cut)


@router.post("/{cut_id}/versions/{version_id}/activate", response_model=CutResponse)
def activate_historical_cut_version(
    project_id: UUID,
    cut_id: UUID,
    version_id: UUID,
    store: ProjectStore = Depends(get_project_store),
) -> CutResponse:
    project = store.get(project_id)
    cut = next(
        (cut for scene in project.scenes for cut in scene.cuts if cut.id == cut_id),
        None,
    )
    if cut is None:
        raise CutNotFoundError(f"Cut not found in project {project_id}: {cut_id}")
    try:
        activate_cut_version(cut, version_id)
    except CutVersionNotFoundError:
        raise ApiValidationError(
            [{"loc": ["path", "version_id"], "msg": "컷 버전을 찾을 수 없습니다.", "type": "value_error.cut_version"}]
        ) from None
    store.update(project)
    return CutResponse.from_cut(cut)


@router.post("/{cut_id}/regenerate", response_model=JobAccepted, status_code=status.HTTP_202_ACCEPTED)
def regenerate_cut(
    project_id: UUID,
    cut_id: UUID,
    request: RegenerateCutRequest,
    http_request: Request,
    idempotency_key_header: str | None = Header(default=None, alias="Idempotency-Key"),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
) -> JobAccepted:
    idempotency_key = idempotency_key_header or request.idempotency_key or str(uuid4())
    job = job_queue.enqueue_cut_regeneration(project_id, cut_id, request, idempotency_key)
    runner = getattr(http_request.app.state, "job_runner", None)
    if runner is not None:
        runner.submit(job)
    return JobAccepted(job_id=job.id, cut_id=cut_id, status=job.status)


@router.post("/{cut_id}/lock", response_model=CutLockResponse)
def lock_cut(project_id: UUID, cut_id: UUID, store: ProjectStore = Depends(get_project_store)) -> CutLockResponse:
    cut = store.get_cut(project_id, cut_id)
    if not cut.locked:
        store.update_cut(project_id, cut_id, locked=True)
    return CutLockResponse(cut_id=cut_id, locked=True)


@router.post("/{cut_id}/unlock", response_model=CutLockResponse)
def unlock_cut(project_id: UUID, cut_id: UUID, store: ProjectStore = Depends(get_project_store)) -> CutLockResponse:
    store.unlock_cut(project_id, cut_id)
    return CutLockResponse(cut_id=cut_id, locked=False)


def _active_script(project: Project):
    if project.script.active_version_id is not None:
        selected = next(
            (version for version in project.script.versions if version.id == project.script.active_version_id),
            None,
        )
        if selected is not None:
            return selected
    return project.script.versions[-1] if project.script.versions else None


def _board_response(project: Project) -> CutBoardResponse:
    source_script_version_ids = {
        scene.source_script_version_id for scene in project.scenes
    }
    stale = bool(project.scenes) and (
        project.script.active_version_id is None
        or source_script_version_ids != {project.script.active_version_id}
    )
    return CutBoardResponse(
        project_id=project.id,
        project_title=project.title,
        stage=project.stage,
        script_version_id=project.script.active_version_id,
        stale=stale,
        scenes=[SceneResponse.from_scene(scene) for scene in project.scenes],
    )


def _with_stage(project: Project, stage: ProjectStage) -> Project:
    payload = project.model_dump()
    payload["status"] = stage
    payload["stage"] = stage
    return Project.model_validate(payload)

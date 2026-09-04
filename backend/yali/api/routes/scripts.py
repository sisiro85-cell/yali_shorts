from __future__ import annotations

import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from yali.ai.gateway import AiGateway
from yali.api.dependencies import get_ai_gateway, get_project_store
from yali.api.errors import ApiValidationError
from yali.content.models import ContentText, ScriptGenerationRequest, ScriptLine, ScriptVersion
from yali.content.service import DeterministicContentService
from yali.domain.enums import ProjectStage
from yali.domain.models import IdeaVersion, Project
from yali.storage.project_store import ProjectStore


router = APIRouter(prefix="/projects/{project_id}/script", tags=["script"])


class ScriptGenerateRequest(BaseModel):
    model_name: str | None = Field(default=None, max_length=200)


class ScriptVersionUpdateRequest(BaseModel):
    """Editable fields for creating a new immutable script snapshot."""

    hook: ContentText | None = None
    body: ContentText | None = None
    cta: ContentText | None = None
    lines: list[ScriptLine] | None = Field(default=None, min_length=1, max_length=200)


class ScriptPageResponse(BaseModel):
    project_id: UUID
    project_title: str
    stage: ProjectStage
    source_idea_id: UUID | None = None
    active_version: ScriptVersion | None = None
    versions: list[ScriptVersion]


@router.get("", response_model=ScriptPageResponse, response_model_exclude_none=True)
def get_script_page(
    project_id: UUID,
    store: ProjectStore = Depends(get_project_store),
) -> ScriptPageResponse:
    return _response(store.get(project_id))


@router.post("/generate", response_model=ScriptPageResponse, response_model_exclude_none=True)
def generate_script(
    project_id: UUID,
    request: ScriptGenerateRequest,
    store: ProjectStore = Depends(get_project_store),
    gateway: AiGateway = Depends(get_ai_gateway),
) -> ScriptPageResponse:
    project = store.get(project_id)
    idea = _active_idea(project)
    if idea is None:
        raise ApiValidationError(
            [{"loc": ["body"], "msg": "아이디어 결과를 먼저 확정해 주세요.", "type": "value_error.script_source"}]
        )
    script_request = ScriptGenerationRequest(
        topic=idea.source.topic or idea.headline,
        headline=idea.headline,
        summary=idea.summary,
        key_points=idea.key_points,
        source_text=idea.source.source_text,
    )
    script = asyncio.run(
        DeterministicContentService(gateway).generate_script(
            script_request,
            model_name=request.model_name,
        )
    )
    script = script.model_copy(update={"source_idea_version_id": idea.id})
    project.script.versions.append(script)
    project.script.active_version_id = script.id
    project = _with_stage(project, ProjectStage.SCRIPT)
    store.update(project)
    return _response(project, source_idea_id=idea.id)


@router.patch("/versions/{version_id}", response_model=ScriptPageResponse, response_model_exclude_none=True)
def update_script_version(
    project_id: UUID,
    version_id: UUID,
    request: ScriptVersionUpdateRequest,
    store: ProjectStore = Depends(get_project_store),
) -> ScriptPageResponse:
    project = store.get(project_id)
    current = _find_script_version(project, version_id)
    if current is None:
        raise _missing_script_version(version_id)
    if len(project.script.versions) >= 200:
        raise ApiValidationError(
            [{"loc": ["body"], "msg": "대본 버전은 최대 200개까지 저장할 수 있습니다.", "type": "value_error.script_version_limit"}]
        )

    lines = (
        request.lines
        if request.lines is not None
        else [line.model_copy(deep=True) for line in current.lines]
    )
    _validate_candidate_lines(lines)
    candidate = ScriptVersion(
        source_idea_version_id=current.source_idea_version_id,
        hook=request.hook if request.hook is not None else current.hook,
        body=request.body if request.body is not None else current.body,
        cta=request.cta if request.cta is not None else current.cta,
        lines=lines,
    )

    updated = project.model_copy(deep=True)
    updated.script.versions.append(candidate)
    updated.script.active_version_id = candidate.id
    updated = _with_stage(updated, ProjectStage.SCRIPT)
    store.update(updated)
    return _response(updated, source_idea_id=candidate.source_idea_version_id)


@router.post(
    "/versions/{version_id}/activate",
    response_model=ScriptPageResponse,
    response_model_exclude_none=True,
)
def activate_script_version(
    project_id: UUID,
    version_id: UUID,
    store: ProjectStore = Depends(get_project_store),
) -> ScriptPageResponse:
    project = store.get(project_id)
    version = _find_script_version(project, version_id)
    if version is None:
        raise _missing_script_version(version_id)

    updated = project.model_copy(deep=True)
    updated.script.active_version_id = version.id
    updated = _with_stage(updated, ProjectStage.SCRIPT)
    store.update(updated)
    return _response(updated, source_idea_id=version.source_idea_version_id)


def _find_script_version(project: Project, version_id: UUID) -> ScriptVersion | None:
    return next((version for version in project.script.versions if version.id == version_id), None)


def _validate_candidate_lines(lines: list[ScriptLine]) -> None:
    orders = [line.order for line in lines]
    expected = list(range(1, len(lines) + 1))
    if orders != expected:
        raise ApiValidationError(
            [
                {
                    "loc": ["body", "lines"],
                    "msg": "대본 라인 순서는 1부터 차례대로 이어져야 합니다.",
                    "type": "value_error.script_lines_order",
                }
            ]
        )

    line_ids = [line.id for line in lines]
    if len(line_ids) != len(set(line_ids)):
        raise ApiValidationError(
            [
                {
                    "loc": ["body", "lines"],
                    "msg": "대본 라인 ID는 서로 달라야 합니다.",
                    "type": "value_error.script_lines_duplicate_id",
                }
            ]
        )


def _missing_script_version(version_id: UUID) -> ApiValidationError:
    return ApiValidationError(
        [
            {
                "loc": ["path", "version_id"],
                "msg": f"대본 버전을 찾을 수 없습니다: {version_id}",
                "type": "value_error.script_version",
            }
        ]
    )


def _active_idea(project: Project) -> IdeaVersion | None:
    if project.idea.active_version_id is not None:
        selected = next(
            (version for version in project.idea.versions if version.id == project.idea.active_version_id),
            None,
        )
        if selected is not None:
            return selected
    return project.idea.versions[-1] if project.idea.versions else None


def _response(project: Project, source_idea_id: UUID | None = None) -> ScriptPageResponse:
    active = next(
        (version for version in project.script.versions if version.id == project.script.active_version_id),
        None,
    )
    if active is None and project.script.versions:
        active = project.script.versions[-1]
    if source_idea_id is None and active is not None:
        source_idea_id = active.source_idea_version_id
    return ScriptPageResponse(
        project_id=project.id,
        project_title=project.title,
        stage=project.stage,
        source_idea_id=source_idea_id,
        active_version=active,
        versions=project.script.versions,
    )


def _with_stage(project: Project, stage: ProjectStage) -> Project:
    payload = project.model_dump()
    payload["status"] = stage
    payload["stage"] = stage
    return Project.model_validate(payload)

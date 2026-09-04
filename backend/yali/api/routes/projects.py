from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from yali.api.dependencies import get_project_store
from yali.domain.enums import ProjectStage, ProjectStatus
from yali.domain.models import Project, ProjectSummary
from yali.storage.project_store import ProjectStore

router = APIRouter(prefix="/projects", tags=["projects"])

_STAGE_PROGRESS = {
    ProjectStage.IDEA: 0,
    ProjectStage.SCRIPT: 25,
    ProjectStage.CUTS: 50,
    ProjectStage.DESIGN: 75,
    ProjectStage.OUTPUT: 90,
    ProjectStage.COMPLETED: 100,
    ProjectStage.FAILED: 0,
}


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    stage: ProjectStage = ProjectStage.IDEA

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("프로젝트 이름을 입력해 주세요.")
        return value


class ProjectPatchRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    status: ProjectStatus | None = None
    stage: ProjectStage | None = None

    @field_validator("title")
    @classmethod
    def patch_title_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("프로젝트 이름을 입력해 주세요.")
        return value

    @model_validator(mode="after")
    def lifecycle_values_match(self) -> ProjectPatchRequest:
        if self.status is not None and self.stage is not None and self.status != self.stage:
            raise ValueError("status and stage must match")
        return self


class ProjectListItem(ProjectSummary):
    progress: int = Field(ge=0, le=100)

    @classmethod
    def from_summary(cls, summary: ProjectSummary) -> ProjectListItem:
        return cls(**summary.model_dump(), progress=_STAGE_PROGRESS[summary.stage])


class ProjectListResponse(BaseModel):
    projects: list[ProjectListItem]


class ProjectDeleteResponse(BaseModel):
    id: UUID
    deleted: bool = True


@router.get("", response_model=ProjectListResponse, response_model_exclude_none=True)
def list_projects(store: ProjectStore = Depends(get_project_store)) -> ProjectListResponse:
    return ProjectListResponse(projects=[ProjectListItem.from_summary(item) for item in store.list_summaries()])


@router.post("", response_model=Project, status_code=status.HTTP_201_CREATED)
def create_project(request: ProjectCreateRequest, store: ProjectStore = Depends(get_project_store)) -> Project:
    project = Project(title=request.title.strip(), status=request.stage)
    store.save(project)
    return project


@router.delete("/{project_id}", response_model=ProjectDeleteResponse)
def delete_project(project_id: UUID, store: ProjectStore = Depends(get_project_store)) -> ProjectDeleteResponse:
    store.delete(project_id)
    return ProjectDeleteResponse(id=project_id)


@router.get("/{project_id}/assets/{asset_id}/preview")
def get_project_preview(project_id: UUID, asset_id: UUID, store: ProjectStore = Depends(get_project_store)) -> FileResponse:
    return FileResponse(store.get_preview_asset_path(project_id, asset_id))


@router.get("/{project_id}", response_model=Project)
def get_project(project_id: UUID, store: ProjectStore = Depends(get_project_store)) -> Project:
    return store.get(project_id)


@router.patch("/{project_id}", response_model=Project)
def patch_project(
    project_id: UUID, request: ProjectPatchRequest, store: ProjectStore = Depends(get_project_store)
) -> Project:
    project = store.get(project_id)
    changes = request.model_dump(exclude_none=True)
    if "title" in changes:
        project.title = request.title.strip()  # type: ignore[union-attr]
    lifecycle = request.status or request.stage
    if lifecycle is not None:
        payload = project.model_dump()
        payload["status"] = lifecycle
        payload["stage"] = lifecycle
        project = Project.model_validate(payload)
    store.update(project)
    return project

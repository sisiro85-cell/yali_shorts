from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from yali.content.models import ScriptState
from yali.domain.enums import ProjectStage, ProjectStatus


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class CutVersion(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=utc_now)
    visual_prompt: str = ""
    narration_text: str = ""
    subtitle: str = ""
    motion_preset: str = "static"
    media_asset_id: UUID | None = None
    audio_asset_id: UUID | None = None


class Cut(BaseModel):
    id: UUID
    order: int
    title: str
    duration_ms: int = Field(ge=250)
    visual_prompt: str = ""
    media_asset_id: UUID | None = None
    audio_asset_id: UUID | None = None
    narration_text: str = ""
    subtitle: str = ""
    motion_preset: str = "static"
    locked: bool = False
    versions: list[CutVersion] = Field(default_factory=list)
    active_version_id: UUID | None = None
    status: Literal["draft", "generating", "ready", "failed"] = "draft"
    error: str | None = None

    @model_validator(mode="after")
    def validate_versions(self) -> Cut:
        version_ids = [version.id for version in self.versions]
        if len(version_ids) != len(set(version_ids)):
            raise ValueError("Cut version IDs must be unique")
        if self.versions and self.active_version_id is None:
            raise ValueError("active_version_id is required when cut versions exist")
        if self.active_version_id is not None and self.active_version_id not in version_ids:
            raise ValueError("active_version_id must reference a stored cut version")
        return self


class Scene(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    order: int
    title: str
    source_script_version_id: UUID | None = None
    cuts: list[Cut] = Field(default_factory=list)


class MediaAsset(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    filename: str
    relative_path: str
    media_type: Literal["image", "video", "audio", "other"] = "other"
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    media_color_profile: str | None = None
    content_hash: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class OutputVariant(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str
    format: Literal["shorts", "reels", "card_news"] = "shorts"
    relative_path: str | None = None
    preset_id: str | None = None
    cut_version_ids: list[UUID] = Field(default_factory=list)
    subtitle_style: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


IdeaFormat = Literal["shorts", "reels", "card_news"]
IdeaJobStatus = Literal["idle", "queued", "running", "completed", "failed", "cancelled"]


class IdeaDraft(BaseModel):
    topic: str = ""
    source_text: str = ""
    formats: list[IdeaFormat] = Field(default_factory=list)
    reference_asset_ids: list[UUID] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=utc_now)


class IdeaVersion(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=utc_now)
    headline: str
    summary: str
    key_points: list[str] = Field(default_factory=list)
    content: dict[str, Any] = Field(default_factory=dict)
    source: IdeaDraft


class IdeaState(BaseModel):
    draft: IdeaDraft = Field(default_factory=IdeaDraft)
    versions: list[IdeaVersion] = Field(default_factory=list)
    active_version_id: UUID | None = None
    generation_job_id: UUID | None = None
    generation_status: IdeaJobStatus = "idle"
    generation_error: str | None = None


class JobRecord(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    project_id: UUID
    cut_id: UUID | None = None
    kind: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"] = "queued"
    progress: int = Field(default=0, ge=0, le=100)
    error: str | None = None
    retry_count: int = Field(default=0, ge=0)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Project(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    id: UUID = Field(default_factory=uuid4)
    title: str
    status: ProjectStatus = ProjectStatus.IDEA
    stage: ProjectStage = ProjectStage.IDEA
    scenes: list[Scene] = Field(default_factory=list)
    assets: list[MediaAsset] = Field(default_factory=list)
    idea: IdeaState = Field(default_factory=IdeaState)
    script: ScriptState = Field(default_factory=ScriptState)
    output_variants: list[OutputVariant] = Field(default_factory=list)
    jobs: list[JobRecord] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def synchronize_lifecycle_fields(self) -> Project:
        fields_set = self.model_fields_set
        if "status" in fields_set and "stage" in fields_set:
            if self.status != self.stage:
                raise ValueError("status and stage must match")
        elif "status" in fields_set:
            object.__setattr__(self, "stage", self.status)
        else:
            object.__setattr__(self, "status", self.stage)
        return self

    def __setattr__(self, name: str, value: object) -> None:
        if name in {"status", "stage"} and hasattr(self, "status") and hasattr(self, "stage"):
            candidate_data = self.model_dump()
            candidate_data[name] = value
            candidate = type(self).model_validate(candidate_data)
            object.__setattr__(self, "status", candidate.status)
            object.__setattr__(self, "stage", candidate.stage)
            self.__pydantic_fields_set__.update({"status", "stage"})
            return
        super().__setattr__(name, value)


class ProjectPreviewMedia(BaseModel):
    url: str
    media_type: Literal["image", "video"]
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    alt: str


class ProjectSummary(BaseModel):
    id: UUID
    title: str
    status: ProjectStatus
    stage: ProjectStage
    scene_count: int = Field(ge=0)
    cut_count: int = Field(ge=0)
    updated_at: datetime
    preview_media: ProjectPreviewMedia | None = None

    @classmethod
    def from_project(cls, project: Project) -> ProjectSummary:
        return cls(
            id=project.id,
            title=project.title,
            status=project.status,
            stage=project.stage,
            scene_count=len(project.scenes),
            cut_count=sum(len(scene.cuts) for scene in project.scenes),
            updated_at=project.updated_at,
            preview_media=_preview_media(project),
        )


def _preview_media(project: Project) -> ProjectPreviewMedia | None:
    asset = next(
        (
            item
            for item in project.assets
            if item.media_type in {"image", "video"} and item.width is not None and item.height is not None
        ),
        None,
    )
    if asset is None:
        return None
    return ProjectPreviewMedia(
        url=f"/api/projects/{project.id}/assets/{asset.id}/preview",
        media_type=asset.media_type,
        width=asset.width,
        height=asset.height,
        alt=f"{project.title} 원본 미디어: {asset.filename}",
    )

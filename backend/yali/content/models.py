from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4

from pydantic import AwareDatetime, BaseModel, Field, StringConstraints, model_validator

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ContentText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)]
PromptText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _require_contiguous(items: list[object], *, label: str) -> None:
    orders = [getattr(item, "order") for item in items]
    expected = list(range(1, len(items) + 1))
    if orders != expected:
        raise ValueError(f"{label} order must be contiguous starting at 1; got {orders}")


def _require_unique_ids(items: list[object], *, label: str) -> None:
    identifiers = [getattr(item, "id") for item in items]
    if len(identifiers) != len(set(identifiers)):
        raise ValueError(f"{label} IDs must be unique")


class ScriptLine(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    order: int = Field(ge=1, le=200)
    speaker: ShortText = "내레이션"
    text: ContentText
    duration_ms: int = Field(ge=250, le=600_000)
    scene_intent: ContentText | None = None


class ScriptVersion(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    created_at: AwareDatetime = Field(default_factory=_utc_now)
    source_idea_version_id: UUID | None = None
    hook: ContentText
    body: ContentText
    cta: ContentText
    lines: list[ScriptLine] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_line_order(self) -> ScriptVersion:
        _require_contiguous(self.lines, label="Script line")
        _require_unique_ids(self.lines, label="Script line")
        return self


class ScriptState(BaseModel):
    versions: list[ScriptVersion] = Field(default_factory=list, max_length=200)
    active_version_id: UUID | None = None

    @model_validator(mode="after")
    def validate_active_version(self) -> ScriptState:
        if self.active_version_id is not None and all(
            version.id != self.active_version_id for version in self.versions
        ):
            raise ValueError("active_version_id must reference a stored script version")
        return self


class ScriptGenerationRequest(BaseModel):
    topic: ShortText
    headline: ContentText
    summary: ContentText
    key_points: list[ContentText] = Field(default_factory=list, max_length=50)
    source_text: str = Field(default="", max_length=100_000)


class CutPlanCut(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    order: int = Field(ge=1, le=200)
    title: ShortText
    duration_ms: int = Field(ge=250, le=600_000)
    visual_prompt: PromptText
    narration_text: ContentText
    subtitle: ContentText
    motion_preset: ShortText = "static"


class CutPlanScene(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    order: int = Field(ge=1, le=100)
    title: ShortText
    cuts: list[CutPlanCut] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_cut_order(self) -> CutPlanScene:
        _require_contiguous(self.cuts, label="Cut")
        _require_unique_ids(self.cuts, label="Cut")
        return self


class CutPlanRequest(BaseModel):
    script: ScriptVersion


class CutPlanResult(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    created_at: AwareDatetime = Field(default_factory=_utc_now)
    scenes: list[CutPlanScene] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_scene_order(self) -> CutPlanResult:
        _require_contiguous(self.scenes, label="Scene")
        _require_unique_ids(self.scenes, label="Scene")
        _require_unique_ids(
            [cut for scene in self.scenes for cut in scene.cuts],
            label="Cut",
        )
        return self

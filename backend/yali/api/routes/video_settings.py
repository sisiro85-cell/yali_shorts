from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from yali.api.dependencies import get_project_store
from yali.domain.models import Project
from yali.domain.video_settings import ProjectVideoSettings, SubtitleAlignment, SubtitlePosition, TTSProvider
from yali.storage.project_store import ProjectStore


router = APIRouter(prefix="/projects/{project_id}/video-settings", tags=["video-settings"])


class TTSSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    provider: TTSProvider | None = None
    language: str | None = Field(default=None, min_length=2, max_length=20)
    voice_id: str | None = Field(default=None, min_length=1, max_length=200)
    speed: float | None = Field(default=None, ge=0.7, le=1.3)
    volume: float | None = Field(default=None, ge=0.0, le=1.0)
    pitch: float | None = Field(default=None, ge=-12.0, le=12.0)


class SubtitleStylePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: SubtitlePosition | None = None
    font_family: str | None = Field(default=None, min_length=1, max_length=200)
    font_size: int | None = Field(default=None, gt=0, le=160)
    color: str | None = None
    outline_color: str | None = None
    outline_width: float | None = Field(default=None, ge=0.0, le=20.0)
    background_color: str | None = None
    custom_x: float | None = Field(default=None, ge=0, le=100)
    custom_y: float | None = Field(default=None, ge=0, le=100)
    alignment: SubtitleAlignment | None = None
    max_lines: int | None = Field(default=None, ge=1, le=4)
    safe_area: bool | None = None


class SubtitleSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    style: SubtitleStylePatch | None = None


class VideoSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audio: TTSSettingsPatch | None = None
    subtitle: SubtitleSettingsPatch | None = None


@router.get("", response_model=ProjectVideoSettings)
def get_video_settings(
    project_id: UUID,
    store: ProjectStore = Depends(get_project_store),
) -> ProjectVideoSettings:
    return store.get(project_id).video_settings


@router.patch("", response_model=ProjectVideoSettings)
def patch_video_settings(
    project_id: UUID,
    request: VideoSettingsPatch,
    store: ProjectStore = Depends(get_project_store),
) -> ProjectVideoSettings:
    project = store.get(project_id)
    project.video_settings = merge_video_settings(project.video_settings, request)
    store.update(project)
    return project.video_settings


def merge_video_settings(
    current: ProjectVideoSettings,
    patch: VideoSettingsPatch,
) -> ProjectVideoSettings:
    payload = current.model_dump(mode="python")
    _merge_defined_values(payload, patch.model_dump(mode="python", exclude_unset=True))
    return ProjectVideoSettings.model_validate(payload)


def _merge_defined_values(target: dict[str, object], updates: dict[str, object]) -> None:
    for key, value in updates.items():
        if value is None:
            continue
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _merge_defined_values(target[key], value)  # type: ignore[arg-type]
        else:
            target[key] = value

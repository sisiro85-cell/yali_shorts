from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


TTSProvider = Literal["edge_tts", "azure_speech", "elevenlabs", "upload"]
SubtitlePosition = Literal["top", "center", "bottom", "custom"]
SubtitleAlignment = Literal["left", "center", "right"]


class TTSSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    enabled: bool = True
    provider: TTSProvider = "edge_tts"
    language: str = Field(default="ko-KR", min_length=2, max_length=20)
    voice_id: str = Field(default="ko-KR-SunHiNeural", min_length=1, max_length=200)
    speed: float = Field(default=1.0, ge=0.7, le=1.3)
    volume: float = Field(default=0.85, ge=0.0, le=1.0)
    pitch: float = Field(default=0.0, ge=-12.0, le=12.0)


class SubtitleStyle(BaseModel):
    model_config = ConfigDict(frozen=True)

    position: SubtitlePosition = "bottom"
    font_family: str = Field(default="Pretendard", min_length=1, max_length=200)
    font_size: int = Field(default=60, gt=0, le=160)
    color: str = "#FFFFFF"
    outline_color: str = "#111111"
    outline_width: float = Field(default=2.0, ge=0.0, le=20.0)
    background_color: str | None = None
    custom_x: float = Field(default=50.0, ge=0, le=100)
    custom_y: float = Field(default=82.0, ge=0, le=100)
    alignment: SubtitleAlignment = "center"
    max_lines: int = Field(default=2, ge=1, le=4)
    safe_area: bool = True


class SubtitleSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    enabled: bool = True
    style: SubtitleStyle = Field(default_factory=SubtitleStyle)


class ProjectVideoSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    audio: TTSSettings = Field(default_factory=TTSSettings)
    subtitle: SubtitleSettings = Field(default_factory=SubtitleSettings)


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


def normalize_video_settings_overrides(value: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and keep only explicitly configured cut-level settings."""
    patch = VideoSettingsPatch.model_validate(value)
    payload = patch.model_dump(mode="python", exclude_unset=True)

    # Most nullable patch fields mean "not provided".  A subtitle background
    # is different: null is a meaningful cut-level override that explicitly
    # clears a project-level background color.
    audio = payload.get("audio")
    if isinstance(audio, Mapping):
        cleaned_audio = {key: item for key, item in audio.items() if item is not None}
        if cleaned_audio:
            payload["audio"] = cleaned_audio
        else:
            payload.pop("audio", None)
    else:
        payload.pop("audio", None)

    subtitle = payload.get("subtitle")
    if isinstance(subtitle, Mapping):
        cleaned_subtitle = {
            key: item for key, item in subtitle.items() if item is not None
        }
        style = cleaned_subtitle.get("style")
        if isinstance(style, Mapping):
            cleaned_style = {
                key: item
                for key, item in style.items()
                if item is not None or key == "background_color"
            }
            if cleaned_style:
                cleaned_subtitle["style"] = cleaned_style
            else:
                cleaned_subtitle.pop("style", None)
        if cleaned_subtitle:
            payload["subtitle"] = cleaned_subtitle
        else:
            payload.pop("subtitle", None)
    else:
        payload.pop("subtitle", None)

    return payload


def merge_video_settings(
    current: ProjectVideoSettings,
    patch: VideoSettingsPatch | Mapping[str, Any],
) -> ProjectVideoSettings:
    payload = current.model_dump(mode="python")
    updates = (
        patch.model_dump(mode="python", exclude_unset=True, exclude_none=True)
        if isinstance(patch, VideoSettingsPatch)
        else normalize_video_settings_overrides(patch)
    )
    _merge_defined_values(payload, updates)
    return ProjectVideoSettings.model_validate(payload)


def _merge_defined_values(target: dict[str, Any], updates: Mapping[str, Any]) -> None:
    for key, value in updates.items():
        if isinstance(value, Mapping) and isinstance(target.get(key), dict):
            _merge_defined_values(target[key], value)  # type: ignore[arg-type]
        else:
            target[key] = value

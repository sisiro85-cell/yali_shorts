from __future__ import annotations

from typing import Literal

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

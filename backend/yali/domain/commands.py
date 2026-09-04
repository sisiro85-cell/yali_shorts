from __future__ import annotations

from pydantic import BaseModel


class RegenerateOptions(BaseModel):
    """Optional inputs that control a later cut regeneration request."""

    visual_prompt: str | None = None
    narration_text: str | None = None
    subtitle: str | None = None
    motion_preset: str | None = None

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

from yali.domain.models import Project


ImageAspectRatio = Literal["9:16", "1:1"]
ASPECT_RATIO_TOLERANCE = 0.04


def target_aspect_ratio_for_formats(formats: Sequence[str]) -> ImageAspectRatio:
    """Return the canvas used by the current single cut board."""
    if formats and all(item == "card_news" for item in formats):
        return "1:1"
    return "9:16"


def target_aspect_ratio_for_project(project: Project) -> ImageAspectRatio:
    return target_aspect_ratio_for_formats(project.idea.draft.formats)


def is_aspect_ratio_compatible(
    width: int,
    height: int,
    expected: ImageAspectRatio,
) -> bool:
    if width <= 0 or height <= 0:
        return False
    expected_value = 9 / 16 if expected == "9:16" else 1.0
    actual_value = width / height
    return abs(actual_value - expected_value) / expected_value <= ASPECT_RATIO_TOLERANCE

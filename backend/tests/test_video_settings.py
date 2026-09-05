from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from yali.domain.models import Cut, Project
from yali.domain.video_settings import (
    ProjectVideoSettings,
    SubtitleStyle,
    TTSSettings,
    merge_video_settings,
)
from yali.storage.project_store import ProjectStore


def test_new_project_has_stable_video_settings_defaults() -> None:
    project = Project(title="설정 테스트")

    assert project.video_settings.audio.provider == "edge_tts"
    assert project.video_settings.audio.speed == 1.0
    assert project.video_settings.audio.volume == 0.85
    assert project.video_settings.subtitle.enabled is True
    assert project.video_settings.subtitle.style.position == "bottom"
    assert project.video_settings.subtitle.style.max_lines == 2


def test_video_settings_validate_ranges_and_provider() -> None:
    with pytest.raises(ValidationError):
        TTSSettings(speed=1.31)

    with pytest.raises(ValidationError):
        TTSSettings(provider="unknown")

    with pytest.raises(ValidationError):
        SubtitleStyle(custom_y=101)


def test_project_video_settings_round_trips_through_store(tmp_path: Path) -> None:
    project = Project(
        title="설정 테스트",
        video_settings=ProjectVideoSettings(
            audio=TTSSettings(speed=1.15),
            subtitle={"style": {"position": "top", "font_size": 72}},
        ),
    )
    store = ProjectStore(tmp_path)

    store.save(project)
    restored = store.get(project.id)

    assert restored.video_settings == project.video_settings


def test_cut_override_can_clear_inherited_subtitle_background() -> None:
    project_settings = ProjectVideoSettings(
        subtitle={"style": {"background_color": "#111111"}},
    )
    cut = Cut(
        id=uuid4(),
        order=1,
        title="배경 해제",
        subtitle="자막",
        narration="내레이션",
        duration_ms=3000,
        video_settings_overrides={"subtitle": {"style": {"background_color": None}}},
    )

    resolved = merge_video_settings(project_settings, cut.video_settings_overrides)

    assert cut.video_settings_overrides == {
        "subtitle": {"style": {"background_color": None}}
    }
    assert resolved.subtitle.style.background_color is None

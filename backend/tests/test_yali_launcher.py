from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def _load_launcher_module():
    launcher_path = Path(__file__).parents[2] / "scripts" / "yali-launcher.py"
    spec = importlib.util.spec_from_file_location("yali_launcher", launcher_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_missing_project_requirements_identify_frontend_and_render_artifacts(tmp_path: Path):
    launcher = _load_launcher_module()
    (tmp_path / "backend").mkdir()
    (tmp_path / "frontend").mkdir()

    assert launcher.missing_project_requirements(tmp_path) == [
        "frontend dependencies (vite)",
        "render worker build",
    ]


def test_start_services_restarts_existing_processes_before_launching(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    launcher = _load_launcher_module()
    events: list[str] = []

    monkeypatch.setattr(launcher, "missing_project_requirements", lambda _root: [])
    monkeypatch.setattr(launcher, "stop_services", lambda _root: events.append("stop") or 0)
    monkeypatch.setattr(launcher.subprocess, "Popen", lambda *_args, **_kwargs: events.append("start"))
    monkeypatch.setattr(launcher, "open_frontend", lambda: events.append("open") or True)

    assert launcher.start_services(tmp_path) == 0
    assert events == ["stop", "start", "open"]

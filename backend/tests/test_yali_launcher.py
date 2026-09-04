from __future__ import annotations

import importlib.util
from pathlib import Path


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

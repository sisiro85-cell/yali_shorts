from __future__ import annotations

import os
from pathlib import Path

from yali.ai.providers import codex_mcp


def test_bridge_environment_keeps_the_backend_package_root(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("PYTHONPATH", "existing-python-path")

    environment = codex_mcp._process_environment(tmp_path)
    roots = environment["PYTHONPATH"].split(os.pathsep)
    backend_root = str(Path(codex_mcp.__file__).resolve().parents[3])

    assert str(tmp_path) in roots
    assert backend_root in roots
    assert "existing-python-path" in roots

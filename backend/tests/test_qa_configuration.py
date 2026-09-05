from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _package_scripts(relative_path: str) -> dict[str, str]:
    package = json.loads((ROOT / relative_path / "package.json").read_text(encoding="utf-8"))
    return package["scripts"]


def test_frontend_unit_and_e2e_commands_fail_when_no_tests_are_collected() -> None:
    scripts = _package_scripts("frontend")

    assert "passWithNoTests" not in scripts["unit"]
    assert "pass-with-no-tests" not in scripts["e2e"]


def test_new_backend_test_modules_are_not_hidden_by_the_repository_ignore_rules() -> None:
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")

    assert "!backend/tests/" in gitignore
    assert "!backend/tests/test_*.py" in gitignore


def test_integration_test_configuration_is_tracked_by_the_project() -> None:
    assert (ROOT / "frontend" / "playwright.integration.config.ts").is_file()
    assert (ROOT / "frontend" / "e2e-integration" / "project-flow.spec.ts").is_file()


def test_vitest_does_not_collect_browser_integration_specs() -> None:
    vite_config = (ROOT / "frontend" / "vite.config.ts").read_text(encoding="utf-8")

    assert '"e2e-integration/**"' in vite_config

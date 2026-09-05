from __future__ import annotations

from pathlib import Path


def test_api_fixture_uses_an_isolated_persistent_store(api_client, isolated_data_root: Path) -> None:
    response = api_client.post("/api/projects", json={"title": "QA foundation"})

    assert response.status_code == 201
    project_id = response.json()["id"]
    project_file = isolated_data_root / "projects" / project_id / "project.json"
    assert project_file.is_file()
    assert isolated_data_root.name.startswith("data-")
    assert api_client.app.state.job_runner is None

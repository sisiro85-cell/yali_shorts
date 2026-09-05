from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from yali.ai.gateway import AiGateway
from yali.ai.providers.fake import FakeTextProvider
from yali.api.app import create_app
from yali.domain.models import Cut, Project, Scene
from yali.storage.project_store import ProjectStore


def _app_with_cut(tmp_path: Path):
    cut = Cut(
        id=uuid4(),
        order=1,
        title="작업 상태 확인",
        duration_ms=1500,
        visual_prompt="작업 큐를 확인하는 화면",
        narration_text="작업 상태를 확인합니다.",
    )
    project = Project(title="작업 조회 테스트", scenes=[Scene(order=1, title="씬 1", cuts=[cut])])
    ProjectStore(tmp_path).save(project)
    app = create_app(
        data_root=tmp_path,
        provider_factory=lambda: AiGateway(primary=FakeTextProvider()),
        enable_worker=False,
    )
    return app, project, cut


def test_get_job_returns_the_current_persisted_state(tmp_path: Path) -> None:
    app, project, cut = _app_with_cut(tmp_path)

    with TestClient(app) as client:
        accepted = client.post(
            f"/api/projects/{project.id}/cuts/{cut.id}/regenerate",
            json={"image_only": True},
            headers={"Idempotency-Key": "job-status-1"},
        )
        assert accepted.status_code == 202

        response = client.get(f"/api/jobs/{accepted.json()['job_id']}")

    assert response.status_code == 200
    assert response.json() == {
        "id": accepted.json()["job_id"],
        "project_id": str(project.id),
        "cut_id": str(cut.id),
        "kind": "cut.regenerate",
        "status": "queued",
        "progress": 0,
        "error": None,
        "retry_count": 0,
    }


def test_get_job_returns_a_stable_not_found_error(tmp_path: Path) -> None:
    app, _, _ = _app_with_cut(tmp_path)

    with TestClient(app) as client:
        response = client.get(f"/api/jobs/{uuid4()}")

    assert response.status_code == 404
    assert response.json() == {
        "code": "JOB_NOT_FOUND",
        "message": "작업을 찾을 수 없습니다.",
        "details": {},
    }

from __future__ import annotations

import json
from pathlib import Path
from time import monotonic, sleep
from uuid import UUID

from fastapi.testclient import TestClient

from yali.ai.gateway import AiGateway
from yali.ai.protocols import Operation
from yali.ai.providers.fake import FakeTextProvider
from yali.api.app import create_app
from yali.domain.models import MediaAsset, Project
from yali.storage.project_store import ProjectStore


def _client(tmp_path: Path) -> tuple[TestClient, Project]:
    project = Project(title="MVP 콘텐츠")
    ProjectStore(tmp_path).save(project)
    gateway = AiGateway(
        primary=FakeTextProvider(
            responses={
                Operation.GENERATE_SCRIPT: json.dumps(
                    {
                        "hook": "반복 업무를 줄이는 첫 단계",
                        "body": "작은 업무부터 자동화합니다.",
                        "cta": "오늘 하나를 골라 보세요.",
                        "lines": [
                            {"order": 9, "text": "먼저 반복 업무를 찾습니다.", "duration_ms": 1400},
                            {"order": 7, "text": "작은 자동화부터 시작합니다.", "duration_ms": 1500},
                        ],
                    },
                    ensure_ascii=False,
                ),
                Operation.GENERATE_CUT_PLAN: json.dumps(
                    {
                        "scenes": [
                            {
                                "order": 8,
                                "title": "도입",
                                "cuts": [
                                    {
                                        "order": 4,
                                        "title": "반복 업무 찾기",
                                        "duration_ms": 1400,
                                        "visual_prompt": "체크리스트를 정리하는 책상",
                                        "narration_text": "먼저 반복 업무를 찾습니다.",
                                        "subtitle": "반복 업무를 찾습니다",
                                        "motion_preset": "slow-zoom",
                                    },
                                    {
                                        "order": 2,
                                        "title": "작은 자동화",
                                        "duration_ms": 1500,
                                        "visual_prompt": "자동화 버튼을 누르는 손",
                                        "narration_text": "작은 자동화부터 시작합니다.",
                                        "subtitle": "작은 자동화부터 시작합니다",
                                        "motion_preset": "pan-left",
                                    },
                                ],
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
            }
        )
    )
    return TestClient(create_app(data_root=tmp_path, provider_factory=lambda: gateway)), project


def _complete_idea(client: TestClient, project: Project) -> None:
    queued = client.post(
        f"/api/projects/{project.id}/ideas/generate",
        json={"topic": "업무 자동화", "source_text": "반복 업무를 줄이는 방법", "formats": ["shorts"]},
    )
    assert queued.status_code == 202
    completed = client.post(
        f"/api/projects/{project.id}/ideas/complete",
        json={
            "job_id": queued.json()["job_id"],
            "headline": "반복 업무를 줄이는 첫 단계",
            "summary": "작은 업무부터 자동화합니다.",
            "key_points": ["반복 업무를 찾기", "작은 자동화"],
        },
    )
    assert completed.status_code == 200


def test_mvp_script_and_cut_plan_are_generated_and_restored(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    _complete_idea(client, project)
    idea_page = client.get(f"/api/projects/{project.id}/ideas")
    idea_source_id = idea_page.json()["active_version"]["id"]

    script = client.post(f"/api/projects/{project.id}/script/generate", json={})
    assert script.status_code == 200
    assert script.json()["active_version"]["hook"] == "반복 업무를 줄이는 첫 단계"
    assert script.json()["active_version"]["lines"][0]["order"] == 1
    assert script.json()["active_version"]["source_idea_version_id"] == idea_source_id

    cuts = client.post(f"/api/projects/{project.id}/cuts/generate", json={})
    assert cuts.status_code == 200
    assert cuts.json()["scenes"][0]["cuts"][1]["order"] == 2
    assert cuts.json()["scenes"][0]["cuts"][0]["versions"]
    assert cuts.json()["scenes"][0]["source_script_version_id"] == script.json()["active_version"]["id"]

    restored_script = client.get(f"/api/projects/{project.id}/script")
    assert restored_script.status_code == 200
    assert restored_script.json()["source_idea_id"] == idea_source_id

    restored = TestClient(create_app(data_root=tmp_path)).get(f"/api/projects/{project.id}/cuts")
    assert restored.status_code == 200
    assert restored.json()["script_version_id"] == script.json()["active_version"]["id"]
    assert restored.json()["scenes"][0]["cuts"][0]["title"] == "반복 업무 찾기"


def test_script_edit_creates_immutable_version_and_activation_restores_previous(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    _complete_idea(client, project)
    generated = client.post(f"/api/projects/{project.id}/script/generate", json={})
    assert generated.status_code == 200
    first = generated.json()["active_version"]

    edited_payload = {
        "hook": first["hook"],
        "body": first["body"],
        "cta": first["cta"],
        "lines": [
            {**first["lines"][0], "text": "수정된 내레이션으로 저장합니다."},
            {**first["lines"][1], "text": "두 번째 라인도 순서를 유지합니다."},
        ],
    }
    edited = client.patch(
        f"/api/projects/{project.id}/script/versions/{first['id']}",
        json=edited_payload,
    )

    assert edited.status_code == 200
    edited_page = edited.json()
    assert edited_page["active_version"]["id"] != first["id"]
    assert edited_page["active_version"]["lines"][0]["text"] == "수정된 내레이션으로 저장합니다."
    assert [line["order"] for line in edited_page["active_version"]["lines"]] == [1, 2]
    assert edited_page["versions"][0]["id"] == first["id"]
    assert edited_page["versions"][0]["lines"][0]["text"] == first["lines"][0]["text"]

    restored = client.post(
        f"/api/projects/{project.id}/script/versions/{first['id']}/activate",
    )

    assert restored.status_code == 200
    restored_page = restored.json()
    assert restored_page["active_version"]["id"] == first["id"]
    assert restored_page["active_version"]["lines"][0]["text"] == first["lines"][0]["text"]
    assert len(restored_page["versions"]) == 2


def test_invalid_script_edit_keeps_previous_active_version(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    _complete_idea(client, project)
    generated = client.post(f"/api/projects/{project.id}/script/generate", json={})
    assert generated.status_code == 200
    before = generated.json()
    first = before["active_version"]

    rejected = client.patch(
        f"/api/projects/{project.id}/script/versions/{first['id']}",
        json={
            "hook": first["hook"],
            "body": first["body"],
            "cta": first["cta"],
            "lines": [
                {**first["lines"][0], "order": 2, "text": "저장되지 않아야 합니다."},
                {**first["lines"][1], "order": 1},
            ],
        },
    )

    assert rejected.status_code == 422
    assert rejected.json()["details"]["errors"] == [
        {
            "loc": ["body", "lines"],
            "msg": "대본 라인 순서는 1부터 차례대로 이어져야 합니다.",
            "type": "value_error.script_lines_order",
        }
    ]
    after = client.get(f"/api/projects/{project.id}/script")
    assert after.status_code == 200
    after_page = after.json()
    assert after_page["active_version"]["id"] == first["id"]
    assert after_page["active_version"] == first
    assert len(after_page["versions"]) == 1


def test_script_edit_rejects_duplicate_line_ids_without_changing_active_version(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    _complete_idea(client, project)
    generated = client.post(f"/api/projects/{project.id}/script/generate", json={})
    assert generated.status_code == 200
    before = generated.json()
    first = before["active_version"]

    rejected = client.patch(
        f"/api/projects/{project.id}/script/versions/{first['id']}",
        json={
            "hook": first["hook"],
            "body": first["body"],
            "cta": first["cta"],
            "lines": [
                first["lines"][0],
                {**first["lines"][1], "id": first["lines"][0]["id"]},
            ],
        },
    )

    assert rejected.status_code == 422
    assert rejected.json()["details"]["errors"] == [
        {
            "loc": ["body", "lines"],
            "msg": "대본 라인 ID는 서로 달라야 합니다.",
            "type": "value_error.script_lines_duplicate_id",
        }
    ]
    after = client.get(f"/api/projects/{project.id}/script")
    assert after.status_code == 200
    after_page = after.json()
    assert after_page["active_version"]["id"] == first["id"]
    assert after_page["active_version"] == first
    assert len(after_page["versions"]) == 1


def test_script_edit_keeps_field_range_validation_on_request_model(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    _complete_idea(client, project)
    generated = client.post(f"/api/projects/{project.id}/script/generate", json={})
    assert generated.status_code == 200
    first = generated.json()["active_version"]

    rejected = client.patch(
        f"/api/projects/{project.id}/script/versions/{first['id']}",
        json={
            "hook": first["hook"],
            "body": first["body"],
            "cta": first["cta"],
            "lines": [
                {**first["lines"][0], "order": 0},
                first["lines"][1],
            ],
        },
    )

    assert rejected.status_code == 422
    errors = rejected.json()["details"]["errors"]
    assert errors[0]["loc"] == ["body", "lines", 0, "order"]
    assert "greater than or equal to 1" in errors[0]["msg"]
    after = client.get(f"/api/projects/{project.id}/script")
    assert after.status_code == 200
    assert after.json()["active_version"]["id"] == first["id"]


def test_cut_generation_keeps_reference_assets_separate_and_defers_image_generation(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    stored = ProjectStore(tmp_path).get(project.id)
    asset = MediaAsset(
        filename="reference.png",
        relative_path="assets/reference.png",
        media_type="image",
        width=1080,
        height=1920,
    )
    stored.assets.append(asset)
    ProjectStore(tmp_path).update(stored)

    _complete_idea(client, project)
    assert client.post(f"/api/projects/{project.id}/script/generate", json={}).status_code == 200
    cuts = client.post(f"/api/projects/{project.id}/cuts/generate", json={})

    assert cuts.status_code == 200
    cut_ids = [
        cut["media_asset_id"]
        for scene in cuts.json()["scenes"]
        for cut in scene["cuts"]
    ]
    assert cut_ids == [None, None]
    stored = ProjectStore(tmp_path).get(project.id)
    assert [item.id for item in stored.assets] == [asset.id]
    assert not list((tmp_path / "projects" / str(project.id) / "assets" / "generated").glob("*.svg"))


def test_cut_regeneration_creates_a_new_version_and_lock_still_wins(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    _complete_idea(client, project)
    client.post(f"/api/projects/{project.id}/script/generate", json={})
    generated = client.post(f"/api/projects/{project.id}/cuts/generate", json={}).json()
    cut_id = generated["scenes"][0]["cuts"][0]["id"]
    before = generated["scenes"][0]["cuts"][0]["active_version_id"]

    regenerated = client.post(
        f"/api/projects/{project.id}/cuts/{cut_id}/regenerate/apply",
        json={"subtitle": "새 자막", "motion_preset": "hyper-frame"},
    )
    assert regenerated.status_code == 200
    after = regenerated.json()
    assert after["active_version_id"] != before
    assert after["versions"][-1]["subtitle"] == "새 자막"

    restored = client.post(
        f"/api/projects/{project.id}/cuts/{cut_id}/versions/{before}/activate",
    )
    assert restored.status_code == 200
    assert restored.json()["active_version_id"] == before
    assert len(restored.json()["versions"]) == 2

    client.post(f"/api/projects/{project.id}/cuts/{cut_id}/lock")
    rejected = client.post(
        f"/api/projects/{project.id}/cuts/{cut_id}/regenerate",
        json={"subtitle": "잠긴 컷"},
    )
    assert rejected.status_code == 409
    assert rejected.json()["code"] == "CUT_LOCKED"


def test_cut_board_marks_existing_plan_stale_after_script_changes(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    _complete_idea(client, project)
    first_script = client.post(f"/api/projects/{project.id}/script/generate", json={})
    assert first_script.status_code == 200
    generated = client.post(f"/api/projects/{project.id}/cuts/generate", json={})
    assert generated.status_code == 200

    second_script = client.post(f"/api/projects/{project.id}/script/generate", json={})
    assert second_script.status_code == 200
    board = client.get(f"/api/projects/{project.id}/cuts")

    assert board.status_code == 200
    assert board.json()["stale"] is True
    assert board.json()["scenes"][0]["source_script_version_id"] == first_script.json()["active_version"]["id"]

    output = client.post(
        f"/api/projects/{project.id}/output/manifest",
        json={"format": "shorts"},
    )
    assert output.status_code == 422
    assert output.json()["details"]["errors"][0]["type"] == "value_error.stale_cut_plan"


def test_output_manifest_preserves_original_media_and_format_dimensions(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    _complete_idea(client, project)
    client.post(f"/api/projects/{project.id}/script/generate", json={})
    client.post(f"/api/projects/{project.id}/cuts/generate", json={})

    manifest = client.post(
        f"/api/projects/{project.id}/output/manifest",
        json={
            "format": "card_news",
            "preset_id": "editorial-clean",
            "subtitle_style": {"position": "top", "font_size": 72},
        },
    )

    assert manifest.status_code == 200
    payload = manifest.json()
    assert payload["renderer"] == "hyperframes"
    assert payload["settings"] == {"width": 1080, "height": 1080, "fps": 30, "pixel_format": "yuv420p", "video_codec": "h264", "audio_codec": "aac"}
    assert len(payload["cut_version_ids"]) == 2
    assert payload["cuts"][0]["subtitle_style"]["position"] == "top"

    repeated = client.post(
        f"/api/projects/{project.id}/output/manifest",
        json={
            "format": "card_news",
            "preset_id": "editorial-clean",
            "subtitle_style": {"position": "top", "font_size": 72},
        },
    )
    assert repeated.status_code == 200
    assert repeated.json()["manifest_hash"] == payload["manifest_hash"]


def test_output_manifest_requires_current_nonempty_cuts(tmp_path: Path) -> None:
    client, project = _client(tmp_path)

    empty = client.post(
        f"/api/projects/{project.id}/output/manifest",
        json={"format": "shorts"},
    )

    assert empty.status_code == 422
    assert empty.json()["code"] == "VALIDATION_ERROR"


def test_project_can_be_deleted_with_its_persisted_files(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    project_dir = tmp_path / "projects" / str(project.id)
    (project_dir / "assets" / "source.txt").write_text("project data", encoding="utf-8")

    deleted = client.delete(f"/api/projects/{project.id}")

    assert deleted.status_code == 200
    assert deleted.json() == {"id": str(project.id), "deleted": True}
    assert not project_dir.exists()
    assert client.get(f"/api/projects/{project.id}").status_code == 404
    assert client.get("/api/projects").json()["projects"] == []


def test_llm_settings_are_redacted_and_health_does_not_generate(tmp_path: Path) -> None:
    client, _ = _client(tmp_path)

    settings = client.get("/api/settings/llm")
    tested = client.post("/api/settings/llm/test", json={})

    assert settings.status_code == 200
    assert settings.json()["provider"] == "fake"
    assert settings.json()["primary"]["available"] is True
    assert '"api_key":' not in settings.text
    assert tested.status_code == 200
    assert tested.json() == {"provider": "fake", "ok": True, "message": "Deterministic fake provider is available"}


def test_enabled_worker_processes_idea_job_and_updates_project(tmp_path: Path) -> None:
    _, project = _client(tmp_path)
    gateway = AiGateway(
        primary=FakeTextProvider(
            responses={
                Operation.GENERATE_IDEA: json.dumps(
                    {
                        "title": "워커가 만든 아이디어",
                        "summary": "백그라운드 생성 결과",
                        "key_points": ["첫째"],
                    },
                    ensure_ascii=False,
                )
            }
        )
    )
    app = create_app(data_root=tmp_path, provider_factory=lambda: gateway, enable_worker=True)
    with TestClient(app) as client:
        queued = client.post(
            f"/api/projects/{project.id}/ideas/generate",
            json={"topic": "워커 아이디어", "formats": ["shorts"]},
        )
        assert queued.status_code == 202
        deadline = monotonic() + 2
        while monotonic() < deadline:
            page = client.get(f"/api/projects/{project.id}/ideas").json()
            if page.get("generation_job", {}).get("status") == "completed":
                break
            sleep(0.02)
        page = client.get(f"/api/projects/{project.id}/ideas").json()
        assert page["generation_job"]["status"] == "completed"
        assert page["active_version"]["headline"] == "워커가 만든 아이디어"

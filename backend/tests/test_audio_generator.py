from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from yali.ai.gateway import AiGateway
from yali.ai.providers.fake import FakeTextProvider
from yali.api.app import create_app
from yali.domain.models import Cut, CutVersion, Project, Scene
from yali.media.audio import attach_generated_cut_audio
from yali.storage.project_store import ProjectStore


def _project_with_cut() -> tuple[Project, Cut]:
    version = CutVersion(
        visual_prompt="작업 화면",
        narration_text="자동화하면 시간이 줄어듭니다.",
        subtitle="시간을 줄입니다.",
    )
    cut = Cut(
        id=uuid4(),
        order=1,
        title="음성 컷",
        duration_ms=1500,
        versions=[version],
        active_version_id=version.id,
        narration_text=version.narration_text,
    )
    return Project(title="오디오 asset 테스트", scenes=[Scene(order=1, title="씬 1", cuts=[cut])]), cut


def test_attach_generated_cut_audio_is_content_addressed_and_updates_active_version(tmp_path: Path) -> None:
    project, cut = _project_with_cut()
    content = b"ID3-audio-result"

    first = attach_generated_cut_audio(
        project,
        cut,
        tmp_path / "projects" / str(project.id) / "assets",
        content=content,
    )
    second = attach_generated_cut_audio(
        project,
        cut,
        tmp_path / "projects" / str(project.id) / "assets",
        content=content,
    )

    assert first.created is True
    assert second.created is False
    assert first.asset.id == second.asset.id
    assert first.asset.media_type == "audio"
    assert first.asset.filename.endswith(".mp3")
    assert first.asset.content_hash is not None
    assert first.path.read_bytes() == content
    assert cut.audio_asset_id == first.asset.id
    assert cut.versions[0].audio_asset_id == first.asset.id
    assert [asset.id for asset in project.assets] == [first.asset.id]


def test_audio_asset_preview_returns_the_stored_file(tmp_path: Path) -> None:
    project, cut = _project_with_cut()
    store = ProjectStore(tmp_path)
    store.save(project)
    generated = attach_generated_cut_audio(
        project,
        cut,
        tmp_path / "projects" / str(project.id) / "assets",
        content=b"ID3-preview",
    )
    store.update(project)
    app = create_app(
        data_root=tmp_path,
        provider_factory=lambda: AiGateway(primary=FakeTextProvider()),
        enable_worker=False,
    )

    with TestClient(app) as client:
        response = client.get(f"/api/projects/{project.id}/assets/{generated.asset.id}/preview")

    assert response.status_code == 200
    assert response.content == b"ID3-preview"
    assert response.headers["content-type"] == "audio/mpeg"

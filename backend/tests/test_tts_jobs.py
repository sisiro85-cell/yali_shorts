from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic, sleep
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from yali.ai.gateway import AiGateway
from yali.ai.providers.fake import FakeTextProvider
from yali.ai.protocols import (
    GenerationMetadata,
    ProviderHealth,
    TTSGenerationRequest,
    TTSGenerationResponse,
)
from yali.api.app import create_app
from yali.domain.models import Cut, CutVersion, Project, Scene
from yali.storage.project_store import ProjectStore


@dataclass
class RecordingTTSProvider:
    name: str = "edge_tts"
    content: bytes = b"ID3-generated-voice"
    requests: list[TTSGenerationRequest] = field(default_factory=list)

    def generate(self, request: TTSGenerationRequest) -> TTSGenerationResponse:
        self.requests.append(request)
        return TTSGenerationResponse(
            content=self.content,
            media_type="audio/mpeg",
            provider=self.name,
            voice_id=request.voice_id,
        )

    def health(self) -> ProviderHealth:
        return ProviderHealth(provider=self.name, available=True, message="fake TTS is available")


def _project_with_cut(tmp_path: Path) -> tuple[Project, Cut]:
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
    project = Project(title="TTS 작업 테스트", scenes=[Scene(order=1, title="씬 1", cuts=[cut])])
    ProjectStore(tmp_path).save(project)
    return project, cut


def _app(tmp_path: Path, provider: RecordingTTSProvider, *, enable_worker: bool):
    return create_app(
        data_root=tmp_path,
        provider_factory=lambda: AiGateway(primary=FakeTextProvider()),
        tts_provider_factory=lambda: provider,
        enable_worker=enable_worker,
    )


def test_tts_preview_snapshots_cut_text_and_resolved_audio_settings(tmp_path: Path) -> None:
    project, cut = _project_with_cut(tmp_path)
    provider = RecordingTTSProvider()
    app = _app(tmp_path, provider, enable_worker=False)

    with TestClient(app) as client:
        first = client.post(
            f"/api/projects/{project.id}/tts/preview",
            json={"cut_id": str(cut.id)},
            headers={"Idempotency-Key": "tts-preview-1"},
        )
        second = client.post(
            f"/api/projects/{project.id}/tts/preview",
            json={"cut_id": str(cut.id)},
            headers={"Idempotency-Key": "tts-preview-2"},
        )

    assert first.status_code == 202
    assert second.status_code == 202
    assert first.json()["job_id"] == second.json()["job_id"]
    job = app.state.job_queue.get(UUID(first.json()["job_id"]))
    assert job.kind == "tts.preview"
    assert job.payload["narration_text"] == "자동화하면 시간이 줄어듭니다."
    assert job.payload["active_version_id"] == str(cut.active_version_id)
    assert job.payload["audio_settings"]["provider"] == "edge_tts"
    assert job.payload["audio_settings"]["voice_id"] == "ko-KR-SunHiNeural"


def test_tts_worker_attaches_audio_asset_and_can_preview_it(tmp_path: Path) -> None:
    project, cut = _project_with_cut(tmp_path)
    provider = RecordingTTSProvider()
    app = _app(tmp_path, provider, enable_worker=True)

    with TestClient(app) as client:
        accepted = client.post(
            f"/api/projects/{project.id}/tts/generate",
            json={"cut_id": str(cut.id)},
        )
        assert accepted.status_code == 202
        deadline = monotonic() + 3
        job = None
        while monotonic() < deadline:
            job = client.get(f"/api/jobs/{accepted.json()['job_id']}").json()
            if job["status"] not in {"queued", "running"}:
                break
            sleep(0.02)

        assert job is not None
        assert job["status"] == "completed", job

        stored = ProjectStore(tmp_path).get(project.id)
        stored_cut = stored.scenes[0].cuts[0]
        assert stored_cut.audio_asset_id is not None
        audio_asset = next(asset for asset in stored.assets if asset.id == stored_cut.audio_asset_id)
        preview = client.get(f"/api/projects/{project.id}/assets/{audio_asset.id}/preview")

    assert len(provider.requests) == 1
    assert provider.requests[0].text == "자동화하면 시간이 줄어듭니다."
    assert audio_asset.media_type == "audio"
    assert preview.status_code == 200
    assert preview.content == provider.content

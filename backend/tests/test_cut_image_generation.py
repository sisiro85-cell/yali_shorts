from __future__ import annotations

from pathlib import Path
from uuid import UUID

import json
import struct
from time import monotonic, sleep

import pytest
from fastapi.testclient import TestClient

from yali.ai.gateway import AiGateway
from yali.ai.protocols import (
    GenerationMetadata,
    ImageGenerationRequest,
    ImageGenerationResponse,
    Operation,
    ProviderHealth,
)
from yali.ai.providers.fake import FakeTextProvider
from yali.api.app import create_app
from yali.domain.models import Cut, CutVersion, Project, Scene
from yali.jobs.models import QueuedJob
from yali.jobs.processor import JobProcessingError, JobProcessor
from yali.media.generator import attach_generated_cut_visual
from yali.storage.project_store import ProjectStore


_PNG_1X1 = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89png"


def _png(width: int, height: int) -> bytes:
    return _PNG_1X1[:16] + struct.pack(">II", width, height) + _PNG_1X1[24:]


_PNG_9X16 = _png(9, 16)


def _cut() -> Cut:
    version = CutVersion(
        visual_prompt="스마트폰 화면에 AI 채팅창이 표시된 장면",
        narration_text="답변의 차이를 확인합니다.",
        subtitle="답변의 차이",
    )
    return Cut(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        order=1,
        title="AI 답변의 차이",
        duration_ms=3500,
        visual_prompt=version.visual_prompt,
        narration_text=version.narration_text,
        subtitle=version.subtitle,
        versions=[version],
        active_version_id=version.id,
    )


class RecordingImageProvider:
    name = "fake_codex_image"

    def __init__(self, content: bytes = _PNG_9X16) -> None:
        self.requests: list[ImageGenerationRequest] = []
        self.content = content

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        self.requests.append(request)
        return ImageGenerationResponse(
            content=self.content,
            media_type="image/png",
            provider=self.name,
            model=request.model_name,
        )

    def health(self) -> ProviderHealth:
        return ProviderHealth(provider=self.name, available=True, message="fake")


class FailingImageProvider(RecordingImageProvider):
    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        self.requests.append(request)
        raise RuntimeError("provider unavailable")


def test_attach_generated_cut_visual_persists_provider_png_without_svg(tmp_path: Path) -> None:
    project = Project(title="이미지 생성 테스트")
    cut = _cut()
    project.scenes = [Scene(order=1, title="씬 1", cuts=[cut])]

    generated = attach_generated_cut_visual(
        project,
        cut,
        tmp_path / "assets",
        content=_PNG_1X1,
        media_type="image/png",
    )

    assert generated.path.suffix == ".png"
    assert generated.path.read_bytes() == _PNG_1X1
    assert generated.asset.width == 1
    assert generated.asset.height == 1
    assert cut.status == "ready"
    assert cut.media_asset_id == generated.asset.id
    assert not list((tmp_path / "assets" / "generated").glob("*.svg"))


def test_attach_generated_cut_visual_rejects_the_wrong_output_aspect_ratio(tmp_path: Path) -> None:
    project = Project(title="비율 검증 테스트")
    cut = _cut()
    project.scenes = [Scene(order=1, title="씬 1", cuts=[cut])]

    with pytest.raises(ValueError, match="9:16"):
        attach_generated_cut_visual(
            project,
            cut,
            tmp_path / "assets",
            content=_png(1536, 1024),
            media_type="image/png",
            expected_aspect_ratio="9:16",
        )


def test_cut_regeneration_uses_image_provider_and_stores_png(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    project = Project(title="워커 이미지 테스트")
    cut = _cut()
    project.scenes = [Scene(order=1, title="씬 1", cuts=[cut])]
    store.save(project)
    image_provider = RecordingImageProvider()
    gateway = AiGateway(primary=FakeTextProvider())
    job = QueuedJob(
        project_id=project.id,
        cut_id=cut.id,
        kind="cut.regenerate",
        idempotency_key="image-job-1",
        payload={
            "project_updated_at": project.updated_at.isoformat(),
            "active_version_id": str(cut.active_version_id),
            "options": {"image_only": True},
        },
    )

    JobProcessor(store, gateway, image_provider=image_provider)(job)

    stored = store.get(project.id)
    stored_cut = stored.scenes[0].cuts[0]
    assert len(image_provider.requests) == 1
    assert image_provider.requests[0].prompt == cut.visual_prompt
    assert image_provider.requests[0].metadata.operation is Operation.REGENERATE_CUT
    assert stored_cut.status == "ready"
    assert stored_cut.media_asset_id is not None
    asset = next(item for item in stored.assets if item.id == stored_cut.media_asset_id)
    assert asset.filename.endswith(".png")
    assert (tmp_path / "projects" / str(project.id) / asset.relative_path).read_bytes() == _PNG_9X16
    assert not list((tmp_path / "projects" / str(project.id) / "assets" / "generated").glob("*.svg"))


def test_cut_regeneration_passes_the_project_output_aspect_ratio_to_the_provider(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    project = Project(title="카드뉴스 비율 테스트")
    project.idea.draft.formats = ["card_news"]
    cut = _cut()
    project.scenes = [Scene(order=1, title="씬 1", cuts=[cut])]
    store.save(project)
    image_provider = RecordingImageProvider(content=_PNG_1X1)
    job = QueuedJob(
        project_id=project.id,
        cut_id=cut.id,
        kind="cut.regenerate",
        idempotency_key="image-ratio-job-1",
        payload={
            "project_updated_at": project.updated_at.isoformat(),
            "active_version_id": str(cut.active_version_id),
            "options": {"image_only": True},
        },
    )

    JobProcessor(store, AiGateway(primary=FakeTextProvider()), image_provider=image_provider)(job)

    assert image_provider.requests[0].aspect_ratio == "1:1"


def test_cut_regeneration_failure_is_persisted_on_the_cut(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    project = Project(title="실패 상태 테스트")
    cut = _cut()
    project.scenes = [Scene(order=1, title="씬 1", cuts=[cut])]
    store.save(project)
    job = QueuedJob(
        project_id=project.id,
        cut_id=cut.id,
        kind="cut.regenerate",
        idempotency_key="image-job-failure",
        payload={
            "project_updated_at": project.updated_at.isoformat(),
            "active_version_id": str(cut.active_version_id),
            "options": {"image_only": True},
        },
    )

    with pytest.raises(JobProcessingError, match="Cut image generation failed") as raised:
        JobProcessor(
            store,
            AiGateway(primary=FakeTextProvider()),
            image_provider=FailingImageProvider(),
        )(job)

    assert raised.value.public_message == "이미지 생성에 실패했습니다. Codex ImageGen 결과를 확인해 주세요."
    failed = store.get(project.id).scenes[0].cuts[0]
    assert failed.status == "failed"
    assert failed.error == raised.value.public_message


def test_image_only_flag_is_preserved_in_queued_request(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    project = Project(title="MCP 이미지 큐 테스트")
    cut = _cut()
    project.scenes = [Scene(order=1, title="씬 1", cuts=[cut])]
    store.save(project)
    app = create_app(
        data_root=tmp_path,
        provider_factory=lambda: AiGateway(primary=FakeTextProvider()),
        enable_worker=False,
    )

    with TestClient(app) as client:
        response = client.post(
            f"/api/projects/{project.id}/cuts/{cut.id}/regenerate",
            json={"image_only": True},
            headers={"Idempotency-Key": "mcp-image-1"},
        )

    assert response.status_code == 202
    jobs = app.state.job_queue.list(project.id)
    assert len(jobs) == 1
    assert json.loads(json.dumps(jobs[0].payload))["options"]["image_only"] is True


def test_enabled_worker_connects_the_queued_job_to_the_image_provider(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    project = Project(title="연결된 이미지 워커 테스트")
    cut = _cut()
    project.scenes = [Scene(order=1, title="씬 1", cuts=[cut])]
    store.save(project)
    image_provider = RecordingImageProvider()
    app = create_app(
        data_root=tmp_path,
        provider_factory=lambda: AiGateway(primary=FakeTextProvider()),
        image_provider_factory=lambda: image_provider,
        enable_worker=True,
    )

    with TestClient(app) as client:
        accepted = client.post(
            f"/api/projects/{project.id}/cuts/{cut.id}/regenerate",
            json={"image_only": True},
        )
        assert accepted.status_code == 202
        deadline = monotonic() + 2
        job = None
        while monotonic() < deadline:
            jobs = client.get(f"/api/jobs?project_id={project.id}").json()["jobs"]
            job = next(item for item in jobs if item["id"] == accepted.json()["job_id"])
            if job["status"] not in {"queued", "running"}:
                break
            sleep(0.02)

        assert job is not None
        assert job["status"] == "completed", job

    stored_cut = store.get(project.id).scenes[0].cuts[0]
    assert len(image_provider.requests) == 1
    assert stored_cut.status == "ready"
    assert stored_cut.media_asset_id is not None

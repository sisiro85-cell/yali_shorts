from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel

from yali.ai.protocols import TTSProvider
from yali.api.dependencies import get_job_queue, get_project_store, get_tts_provider
from yali.api.errors import ApiValidationError
from yali.domain.video_settings import merge_video_settings
from yali.jobs.models import JobAccepted
from yali.jobs.queue import PersistentJobQueue, TTSInputError
from yali.storage.project_store import ProjectStore


router = APIRouter(prefix="/projects/{project_id}/tts", tags=["tts"])


class TTSJobRequest(BaseModel):
    cut_id: UUID


@router.post("/preview", response_model=JobAccepted, status_code=status.HTTP_202_ACCEPTED)
def preview_tts(
    project_id: UUID,
    request: TTSJobRequest,
    http_request: Request,
    idempotency_key_header: str | None = Header(default=None, alias="Idempotency-Key"),
    store: ProjectStore = Depends(get_project_store),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
    tts_provider: TTSProvider = Depends(get_tts_provider),
) -> JobAccepted:
    return _enqueue_tts(
        project_id,
        request.cut_id,
        kind="tts.preview",
        http_request=http_request,
        idempotency_key=idempotency_key_header or str(uuid4()),
        store=store,
        job_queue=job_queue,
        tts_provider=tts_provider,
    )


@router.post("/generate", response_model=JobAccepted, status_code=status.HTTP_202_ACCEPTED)
def generate_tts(
    project_id: UUID,
    request: TTSJobRequest,
    http_request: Request,
    idempotency_key_header: str | None = Header(default=None, alias="Idempotency-Key"),
    store: ProjectStore = Depends(get_project_store),
    job_queue: PersistentJobQueue = Depends(get_job_queue),
    tts_provider: TTSProvider = Depends(get_tts_provider),
) -> JobAccepted:
    return _enqueue_tts(
        project_id,
        request.cut_id,
        kind="tts.generate",
        http_request=http_request,
        idempotency_key=idempotency_key_header or str(uuid4()),
        store=store,
        job_queue=job_queue,
        tts_provider=tts_provider,
    )


def _enqueue_tts(
    project_id: UUID,
    cut_id: UUID,
    *,
    kind: str,
    http_request: Request,
    idempotency_key: str,
    store: ProjectStore,
    job_queue: PersistentJobQueue,
    tts_provider: TTSProvider,
) -> JobAccepted:
    project = store.get(project_id)
    cut = store.get_cut(project_id, cut_id)
    audio_settings = merge_video_settings(project.video_settings, cut.video_settings_overrides).audio
    if not audio_settings.enabled:
        raise ApiValidationError(
            [{"loc": ["body", "cut_id"], "msg": "현재 컷의 TTS가 꺼져 있습니다.", "type": "value_error.tts_disabled"}]
        )
    if audio_settings.provider != tts_provider.name:
        raise ApiValidationError(
            [
                {
                    "loc": ["body", "cut_id"],
                    "msg": f"현재 연결된 음성 엔진({tts_provider.name})과 컷 설정({audio_settings.provider})이 다릅니다.",
                    "type": "value_error.tts_provider",
                }
            ]
        )
    try:
        job = job_queue.enqueue_tts(
            project_id,
            cut_id,
            kind=kind,
            idempotency_key=idempotency_key,
        )
    except TTSInputError as error:
        raise ApiValidationError(
            [{"loc": ["body", "cut_id"], "msg": "내레이션 텍스트를 먼저 입력해 주세요.", "type": "value_error.tts_text"}]
        ) from error
    runner = getattr(http_request.app.state, "job_runner", None)
    if runner is not None:
        runner.submit(job)
    return JobAccepted(job_id=job.id, cut_id=cut_id, status=job.status)

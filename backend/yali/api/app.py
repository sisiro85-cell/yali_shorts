from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from yali.ai.config import AiSettings
from yali.ai.gateway import GatewayFactory
from yali.ai.providers.codex_image import CodexImageProvider
from yali.api.errors import ApiValidationError, IdeaJobStateError
from yali.api.dependencies import ImageProviderFactory, ProviderFactory
from yali.api.routes.cuts import router as cuts_router
from yali.api.routes.health import router as health_router
from yali.api.routes.ideas import router as ideas_router
from yali.api.routes.jobs import router as jobs_router
from yali.api.routes.media import router as media_router
from yali.api.routes.outputs import router as outputs_router
from yali.api.routes.projects import router as projects_router
from yali.api.routes.scripts import router as scripts_router
from yali.api.routes.settings import router as settings_router
from yali.jobs.queue import JobIdempotencyConflict, JobNotFoundError, JobQueueDataError, JobQueueStorageError, PersistentJobQueue
from yali.jobs.processor import JobProcessor
from yali.jobs.runner import JobRunner
from yali.media.render_client import RenderWorkerClient
from yali.storage.project_store import (
    CutLockedError,
    CutNotFoundError,
    DuplicateProjectError,
    MediaAssetNotFoundError,
    OutputVariantNotFoundError,
    ProjectDataError,
    ProjectNotFoundError,
    ProjectStore,
)
from yali.storage.atomic_json import StorageUnavailableError


def create_app(
    data_root: Path | None = None,
    provider_factory: ProviderFactory | None = None,
    image_provider_factory: ImageProviderFactory | None = None,
    enable_worker: bool | None = None,
) -> FastAPI:
    """Create the Yali Short-form Studio API application."""
    worker_enabled = data_root is None if enable_worker is None else enable_worker

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        runner: JobRunner | None = None
        if worker_enabled:
            runner = JobRunner(
                application.state.job_queue,
                JobProcessor(
                    application.state.project_store,
                    application.state.ai_gateway,
                    image_provider=application.state.image_provider,
                    queue=application.state.job_queue,
                    render_client=application.state.render_client,
                ),
            )
            application.state.job_runner = runner
            runner.recover()
        try:
            yield
        finally:
            if runner is not None:
                runner.close()
            application.state.job_runner = None

    app = FastAPI(title="Yali Short-form Studio", lifespan=lifespan)
    app.state.data_root = Path(data_root) if data_root is not None else Path("storage")
    app.state.project_store = ProjectStore(app.state.data_root)
    app.state.job_queue = PersistentJobQueue(app.state.data_root, app.state.project_store)
    app.state.ai_settings = AiSettings.from_env()
    app.state.ai_gateway = (
        provider_factory()
        if provider_factory is not None
        else GatewayFactory(settings=app.state.ai_settings).create()
    )
    app.state.render_client = RenderWorkerClient.from_env()
    app.state.provider_factory = provider_factory
    app.state.image_provider_factory = image_provider_factory
    app.state.image_provider = (
        image_provider_factory()
        if image_provider_factory is not None
        else CodexImageProvider(model=app.state.ai_settings.codex_model)
    )
    app.state.job_runner = None
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    _register_error_handlers(app)
    app.include_router(health_router, prefix="/api")
    app.include_router(projects_router, prefix="/api")
    app.include_router(media_router, prefix="/api")
    app.include_router(ideas_router, prefix="/api")
    app.include_router(scripts_router, prefix="/api")
    app.include_router(cuts_router, prefix="/api")
    app.include_router(outputs_router, prefix="/api")
    app.include_router(settings_router, prefix="/api")
    app.include_router(jobs_router, prefix="/api")
    return app


def _register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, error: StarletteHTTPException) -> JSONResponse:
        if error.status_code == 404:
            return _error_response(404, "API_NOT_FOUND", "요청한 API 경로를 찾을 수 없습니다.")
        return _error_response(error.status_code, "HTTP_ERROR", "요청을 처리할 수 없습니다.")

    @app.exception_handler(ProjectNotFoundError)
    async def project_not_found(_: Request, __: ProjectNotFoundError) -> JSONResponse:
        return _error_response(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.")

    @app.exception_handler(CutNotFoundError)
    async def cut_not_found(_: Request, __: CutNotFoundError) -> JSONResponse:
        return _error_response(404, "CUT_NOT_FOUND", "컷을 찾을 수 없습니다.")

    @app.exception_handler(MediaAssetNotFoundError)
    async def media_asset_not_found(_: Request, __: MediaAssetNotFoundError) -> JSONResponse:
        return _error_response(404, "MEDIA_ASSET_NOT_FOUND", "원본 미디어를 찾을 수 없습니다.")

    @app.exception_handler(OutputVariantNotFoundError)
    async def output_variant_not_found(_: Request, __: OutputVariantNotFoundError) -> JSONResponse:
        return _error_response(404, "OUTPUT_NOT_READY", "아직 다운로드할 출력 파일이 없습니다.")

    @app.exception_handler(CutLockedError)
    async def cut_locked(_: Request, __: CutLockedError) -> JSONResponse:
        return _error_response(409, "CUT_LOCKED", "잠긴 컷은 다시 만들 수 없습니다.")

    @app.exception_handler(DuplicateProjectError)
    async def duplicate_project(_: Request, __: DuplicateProjectError) -> JSONResponse:
        return _error_response(409, "PROJECT_EXISTS", "이미 존재하는 프로젝트입니다.")

    @app.exception_handler(ProjectDataError)
    async def project_data_error(_: Request, __: ProjectDataError) -> JSONResponse:
        return _error_response(500, "PROJECT_DATA_ERROR", "프로젝트 저장 데이터를 읽을 수 없습니다.")

    @app.exception_handler(JobQueueDataError)
    async def job_queue_data_error(_: Request, __: JobQueueDataError) -> JSONResponse:
        return _error_response(500, "JOB_QUEUE_DATA_ERROR", "작업 큐 저장 데이터를 읽을 수 없습니다.")

    @app.exception_handler(JobQueueStorageError)
    async def job_queue_storage_error(_: Request, __: JobQueueStorageError) -> JSONResponse:
        return _error_response(503, "JOB_QUEUE_STORAGE_UNAVAILABLE", "작업 큐 저장소를 사용할 수 없습니다.")

    @app.exception_handler(JobNotFoundError)
    async def job_not_found(_: Request, __: JobNotFoundError) -> JSONResponse:
        return _error_response(404, "JOB_NOT_FOUND", "작업을 찾을 수 없습니다.")

    @app.exception_handler(JobIdempotencyConflict)
    async def job_idempotency_conflict(_: Request, __: JobIdempotencyConflict) -> JSONResponse:
        return _error_response(409, "IDEMPOTENCY_CONFLICT", "같은 재시도 키에 다른 요청 값을 사용할 수 없습니다.")

    @app.exception_handler(StorageUnavailableError)
    async def storage_unavailable(_: Request, __: StorageUnavailableError) -> JSONResponse:
        return _error_response(503, "STORAGE_UNAVAILABLE", "저장소를 사용할 수 없습니다.")

    @app.exception_handler(ApiValidationError)
    async def api_validation_error(_: Request, error: ApiValidationError) -> JSONResponse:
        return _error_response(422, "VALIDATION_ERROR", "요청 값을 확인해 주세요.", {"errors": error.errors})

    @app.exception_handler(IdeaJobStateError)
    async def idea_job_state_error(_: Request, error: IdeaJobStateError) -> JSONResponse:
        return _error_response(409, "IDEA_JOB_NOT_COMPLETABLE", "현재 상태의 생성 작업은 완료 처리할 수 없습니다.", {"job_id": str(error.job_id), "state": error.state})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        return _error_response(
            422, "VALIDATION_ERROR", "요청 값을 확인해 주세요.", {"errors": jsonable_encoder(error.errors())}
        )


def _error_response(status_code: int, code: str, message: str, details: dict[str, object] | None = None) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "message": message, "details": details or {}})

from __future__ import annotations

from typing import Protocol

from fastapi import Request

from yali.ai.gateway import AiGateway
from yali.ai.protocols import ImageProvider, TTSProvider
from yali.jobs.queue import PersistentJobQueue
from yali.storage.project_store import ProjectStore


class ProviderFactory(Protocol):
    """Application-factory boundary for an injectable AI gateway."""

    def __call__(self) -> AiGateway: ...


class ImageProviderFactory(Protocol):
    """Application-factory boundary for an injectable image provider."""

    def __call__(self) -> ImageProvider: ...


class TTSProviderFactory(Protocol):
    """Application-factory boundary for an injectable TTS provider."""

    def __call__(self) -> TTSProvider: ...


def get_project_store(request: Request) -> ProjectStore:
    return request.app.state.project_store


def get_job_queue(request: Request) -> PersistentJobQueue:
    return request.app.state.job_queue


def get_ai_gateway(request: Request) -> AiGateway:
    return request.app.state.ai_gateway


def get_image_provider(request: Request) -> ImageProvider:
    return request.app.state.image_provider


def get_tts_provider(request: Request) -> TTSProvider:
    return request.app.state.tts_provider

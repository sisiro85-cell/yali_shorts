from __future__ import annotations

from typing import Protocol

from fastapi import Request

from yali.ai.gateway import AiGateway
from yali.jobs.queue import PersistentJobQueue
from yali.storage.project_store import ProjectStore


class ProviderFactory(Protocol):
    """Application-factory boundary for an injectable AI gateway."""

    def __call__(self) -> AiGateway: ...


def get_project_store(request: Request) -> ProjectStore:
    return request.app.state.project_store


def get_job_queue(request: Request) -> PersistentJobQueue:
    return request.app.state.job_queue


def get_ai_gateway(request: Request) -> AiGateway:
    return request.app.state.ai_gateway

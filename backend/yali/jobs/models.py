from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from yali.domain.models import utc_now


JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class QueuedJob(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    project_id: UUID
    cut_id: UUID | None = None
    kind: str
    payload: dict[str, object] = Field(default_factory=dict)
    payload_hash: str | None = None
    idempotency_key: str
    status: JobStatus = "queued"
    progress: int = Field(default=0, ge=0, le=100)
    error: str | None = None
    retry_count: int = Field(default=0, ge=0)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class JobAccepted(BaseModel):
    job_id: UUID
    cut_id: UUID | None = None
    status: JobStatus


class JobStatusResponse(BaseModel):
    id: UUID
    project_id: UUID
    cut_id: UUID | None = None
    kind: str
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    error: str | None = None
    retry_count: int = Field(ge=0)

    @classmethod
    def from_job(cls, job: QueuedJob) -> JobStatusResponse:
        return cls(**job.model_dump(exclude={"payload", "payload_hash", "idempotency_key", "created_at", "updated_at"}))

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from yali.api.dependencies import get_job_queue
from yali.jobs.models import JobStatusResponse
from yali.jobs.queue import PersistentJobQueue

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobListResponse(BaseModel):
    jobs: list[JobStatusResponse]


@router.get("", response_model=JobListResponse)
def list_jobs(
    project_id: UUID | None = None, job_queue: PersistentJobQueue = Depends(get_job_queue)
) -> JobListResponse:
    return JobListResponse(jobs=[JobStatusResponse.from_job(job) for job in job_queue.list(project_id)])


@router.get("/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: UUID, job_queue: PersistentJobQueue = Depends(get_job_queue)) -> JobStatusResponse:
    return JobStatusResponse.from_job(job_queue.get(job_id))

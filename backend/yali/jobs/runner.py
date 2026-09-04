from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from threading import RLock
from typing import Callable
from uuid import UUID

from yali.jobs.models import QueuedJob
from yali.jobs.queue import JobNotFoundError, JobStateConflict, PersistentJobQueue


JobHandler = Callable[[QueuedJob], None]


class JobRunner:
    """Run persisted jobs without letting worker state escape the queue."""

    def __init__(
        self,
        queue: PersistentJobQueue,
        handler: JobHandler,
        *,
        max_workers: int = 1,
    ) -> None:
        self.queue = queue
        self.handler = handler
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="yali-job")
        self._active_ids: set[UUID] = set()
        self._lock = RLock()

    def submit(self, job: QueuedJob) -> Future[None] | None:
        """Submit a queued job once; non-queued or duplicate jobs are ignored."""
        with self._lock:
            if job.status != "queued" or job.id in self._active_ids:
                return None
            self._active_ids.add(job.id)
            return self._executor.submit(self._run, job.id)

    def recover(self) -> list[Future[None]]:
        """Resubmit queued records after an application restart."""
        futures: list[Future[None]] = []
        for job in self.queue.list():
            if job.status == "running":
                job = self.queue.set_status(job.id, status="queued", progress=0, error=None)
            future = self.submit(job)
            if future is not None:
                futures.append(future)
        return futures

    def close(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=False)

    def _run(self, job_id: UUID) -> None:
        try:
            job = self.queue.get(job_id)
            if job.status != "queued":
                return
            try:
                self.queue.set_status(
                    job_id,
                    status="running",
                    progress=1,
                    error=None,
                    expected_status="queued",
                )
            except JobStateConflict:
                # Another runner won the claim after our initial read.
                return
            self.handler(job)
            current = self.queue.get(job_id)
            if current.status in {"queued", "running"}:
                try:
                    self.queue.set_status(
                        job_id,
                        status="completed",
                        progress=100,
                        error=None,
                        expected_status=("queued", "running"),
                    )
                except JobStateConflict:
                    # Cancellation or another terminal transition wins.
                    return
        except JobNotFoundError:
            return
        except Exception as error:
            self._mark_failed(job_id, error)
        finally:
            with self._lock:
                self._active_ids.discard(job_id)

    def _mark_failed(self, job_id: UUID, error: Exception) -> None:
        """Persist a bounded, non-sensitive error without echoing job payloads."""
        try:
            current = self.queue.get(job_id)
            if current.status in {"completed", "cancelled", "failed"}:
                return
            safe_error = f"{error.__class__.__name__}: 작업을 처리하지 못했습니다."
            self.queue.set_status(
                job_id,
                status="failed",
                error=safe_error[:500],
                expected_status=("queued", "running"),
            )
        except Exception:
            # A queue/storage failure is already represented by the persisted
            # queue state where possible; a background worker must not crash
            # the API process while trying to report it.
            return

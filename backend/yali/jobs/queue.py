from __future__ import annotations

import json
import hashlib
import os
from contextlib import AbstractContextManager
from pathlib import Path
from threading import RLock
from uuid import UUID

from pydantic import ValidationError

from yali.domain.commands import RegenerateOptions
from yali.domain.models import utc_now
from yali.domain.video_settings import merge_video_settings
from yali.jobs.models import JobStatus, QueuedJob
from yali.storage.atomic_json import StorageUnavailableError, write_json_atomic
from yali.storage.project_store import CutLockedError, CutNotFoundError, ProjectStore


class JobQueueDataError(Exception):
    """Raised when the persistent queue cannot be decoded safely."""


class JobQueueStorageError(StorageUnavailableError):
    """Raised only when the persistent queue cannot safely access its files."""


class JobNotFoundError(Exception):
    """Raised when a persisted job record does not exist."""


class JobStateConflict(Exception):
    """Raised when an atomic job transition sees an unexpected state."""


class JobIdempotencyConflict(Exception):
    """Raised when a retry key is reused for a different request payload."""


class TTSInputError(Exception):
    """Raised when a cut cannot provide text for a TTS job."""


_JOB_QUEUE_THREAD_LOCK = RLock()


class _JobFileLock(AbstractContextManager[None]):
    """Cross-process lock for the small local jobs.json critical section."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._file: object | None = None

    def __enter__(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_file = self.path.open("a+b")
        if lock_file.tell() == 0:
            lock_file.write(b"\0")
            lock_file.flush()
        lock_file.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        self._file = lock_file
        return None

    def __exit__(self, *_: object) -> None:
        if self._file is None:
            return None
        lock_file = self._file
        try:
            lock_file.seek(0)  # type: ignore[union-attr]
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)  # type: ignore[union-attr]
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)  # type: ignore[union-attr]
        finally:
            lock_file.close()  # type: ignore[union-attr]
        return None


class PersistentJobQueue:
    """A small JSON-backed queue that preserves queued work across app restarts."""

    def __init__(self, data_root: Path, project_store: ProjectStore) -> None:
        self.path = Path(data_root) / "jobs.json"
        self.project_store = project_store
        # Construction must remain side-effect free for the app factory; the
        # lock is acquired for every subsequent read/write operation.
        self._jobs = self._load_unlocked()

    def enqueue_cut_regeneration(
        self, project_id: UUID, cut_id: UUID, options: RegenerateOptions, idempotency_key: str
    ) -> QueuedJob:
        project = self.project_store.get(project_id)
        cut = next(
            (item for scene in project.scenes for item in scene.cuts if item.id == cut_id),
            None,
        )
        if cut is None:
            raise CutNotFoundError(f"Cut not found in project {project_id}: {cut_id}")
        if cut.locked:
            raise CutLockedError(f"Cut is locked: {cut_id}")
        payload = {
            "project_id": str(project_id),
            "cut_id": str(cut_id),
            "project_updated_at": project.updated_at.isoformat(),
            "active_version_id": str(cut.active_version_id) if cut.active_version_id else None,
            "options": options.model_dump(mode="json", exclude_none=True, exclude={"idempotency_key"}),
        }
        payload_hash = _payload_fingerprint(payload)
        try:
            with _JOB_QUEUE_THREAD_LOCK, _JobFileLock(Path(f"{self.path}.lock")):
                current_jobs = self._load_unlocked()
                self._jobs = current_jobs
                existing = next(
                    (
                        job
                        for job in current_jobs
                        if job.project_id == project_id and job.cut_id == cut_id and job.idempotency_key == idempotency_key
                    ),
                    None,
                )
                if existing is not None:
                    if _stored_payload_hash(existing) != payload_hash:
                        raise JobIdempotencyConflict("Idempotency key was reused for another payload")
                    return existing
                job = QueuedJob(
                    project_id=project_id,
                    cut_id=cut_id,
                    kind="cut.regenerate",
                    idempotency_key=idempotency_key,
                    payload=payload,
                    payload_hash=payload_hash,
                )
                updated_jobs = [*current_jobs, job]
                self._save(updated_jobs)
                self._jobs = updated_jobs
                return job
        except OSError as error:
            raise JobQueueStorageError(f"Unable to persist jobs queue: {error}") from error

    def enqueue(
        self,
        *,
        project_id: UUID,
        kind: str,
        payload: dict[str, object],
        idempotency_key: str,
        cut_id: UUID | None = None,
    ) -> QueuedJob:
        payload_hash = _payload_fingerprint(payload)
        try:
            with _JOB_QUEUE_THREAD_LOCK, _JobFileLock(Path(f"{self.path}.lock")):
                current_jobs = self._load_unlocked()
                self._jobs = current_jobs
                existing = next(
                    (
                        job
                        for job in current_jobs
                        if job.project_id == project_id
                        and job.cut_id == cut_id
                        and job.kind == kind
                        and job.idempotency_key == idempotency_key
                    ),
                    None,
                )
                if existing is not None:
                    if _stored_payload_hash(existing) != payload_hash:
                        raise JobIdempotencyConflict("Idempotency key was reused for another payload")
                    return existing
                job = QueuedJob(
                    project_id=project_id,
                    cut_id=cut_id,
                    kind=kind,
                    idempotency_key=idempotency_key,
                    payload=payload,
                    payload_hash=payload_hash,
                )
                updated_jobs = [*current_jobs, job]
                self._save(updated_jobs)
                self._jobs = updated_jobs
                return job
        except OSError as error:
                raise JobQueueStorageError(f"Unable to persist jobs queue: {error}") from error

    def enqueue_tts(
        self,
        project_id: UUID,
        cut_id: UUID,
        *,
        kind: str,
        idempotency_key: str,
    ) -> QueuedJob:
        """Queue one TTS request with the cut text/settings captured atomically."""
        project = self.project_store.get(project_id)
        cut = next(
            (item for scene in project.scenes for item in scene.cuts if item.id == cut_id),
            None,
        )
        if cut is None:
            raise CutNotFoundError(f"Cut not found in project {project_id}: {cut_id}")
        if cut.locked:
            raise CutLockedError(f"Cut is locked: {cut_id}")
        version = _active_cut_version(cut)
        narration_text = version.narration_text if version is not None else cut.narration_text
        if not narration_text.strip():
            raise TTSInputError(f"Cut has no narration text: {cut_id}")
        audio_settings = merge_video_settings(project.video_settings, cut.video_settings_overrides).audio
        payload = {
            "project_id": str(project_id),
            "cut_id": str(cut_id),
            "project_updated_at": project.updated_at.isoformat(),
            "active_version_id": str(cut.active_version_id) if cut.active_version_id else None,
            "narration_text": narration_text,
            "audio_settings": audio_settings.model_dump(mode="json"),
        }
        payload_hash = _payload_fingerprint(payload)
        try:
            with _JOB_QUEUE_THREAD_LOCK, _JobFileLock(Path(f"{self.path}.lock")):
                current_jobs = self._load_unlocked()
                self._jobs = current_jobs
                existing = next(
                    (
                        job
                        for job in current_jobs
                        if job.project_id == project_id
                        and job.cut_id == cut_id
                        and job.kind == kind
                        and job.idempotency_key == idempotency_key
                    ),
                    None,
                )
                if existing is not None:
                    if _stored_payload_hash(existing) != payload_hash:
                        raise JobIdempotencyConflict("Idempotency key was reused for another payload")
                    return existing
                active = next(
                    (
                        job
                        for job in current_jobs
                        if job.project_id == project_id
                        and job.cut_id == cut_id
                        and job.kind in {"tts.preview", "tts.generate"}
                        and job.status in {"queued", "running"}
                    ),
                    None,
                )
                if active is not None:
                    return active
                job = QueuedJob(
                    project_id=project_id,
                    cut_id=cut_id,
                    kind=kind,
                    idempotency_key=idempotency_key,
                    payload=payload,
                    payload_hash=payload_hash,
                )
                updated_jobs = [*current_jobs, job]
                self._save(updated_jobs)
                self._jobs = updated_jobs
                return job
        except OSError as error:
            raise JobQueueStorageError(f"Unable to persist jobs queue: {error}") from error

    def get(self, job_id: UUID) -> QueuedJob:
        self._jobs = self._read_locked()
        job = next((item for item in self._jobs if item.id == job_id), None)
        if job is None:
            raise JobNotFoundError(f"Job not found: {job_id}")
        return job

    def set_status(
        self,
        job_id: UUID,
        *,
        status: JobStatus,
        progress: int | None = None,
        error: str | None = None,
        expected_status: JobStatus | tuple[JobStatus, ...] | None = None,
    ) -> QueuedJob:
        try:
            with _JOB_QUEUE_THREAD_LOCK, _JobFileLock(Path(f"{self.path}.lock")):
                current_jobs = self._load_unlocked()
                target = next((job for job in current_jobs if job.id == job_id), None)
                if target is None:
                    raise JobNotFoundError(f"Job not found: {job_id}")
                if expected_status is not None and not _status_matches(target.status, expected_status):
                    raise JobStateConflict(f"Job {job_id} is not in the expected state")
                target.status = status
                if progress is not None:
                    target.progress = progress
                target.error = error
                target.updated_at = utc_now()
                self._save(current_jobs)
                self._jobs = current_jobs
                return target
        except OSError as error:
            raise JobQueueStorageError(f"Unable to persist jobs queue: {error}") from error

    def cancel(self, job_id: UUID) -> QueuedJob:
        job = self.get(job_id)
        if job.status in {"completed", "failed", "cancelled"}:
            return job
        try:
            return self.set_status(
                job_id,
                status="cancelled",
                error=None,
                expected_status=("queued", "running"),
            )
        except JobStateConflict:
            # Another actor completed/failed/cancelled the job while this
            # request was waiting for the file lock. The terminal state wins.
            return self.get(job_id)

    def discard(self, job_id: UUID) -> None:
        """Remove a newly enqueued job when its owning project cannot be persisted."""
        try:
            with _JOB_QUEUE_THREAD_LOCK, _JobFileLock(Path(f"{self.path}.lock")):
                current_jobs = self._load_unlocked()
                updated_jobs = [job for job in current_jobs if job.id != job_id]
                if len(updated_jobs) == len(current_jobs):
                    self._jobs = current_jobs
                    return
                self._save(updated_jobs)
                self._jobs = updated_jobs
        except OSError as error:
            raise JobQueueStorageError(f"Unable to roll back jobs queue: {error}") from error

    def list(self, project_id: UUID | None = None) -> list[QueuedJob]:
        self._jobs = self._read_locked()
        return [job for job in self._jobs if project_id is None or job.project_id == project_id]

    def _read_locked(self) -> list[QueuedJob]:
        try:
            with _JOB_QUEUE_THREAD_LOCK, _JobFileLock(Path(f"{self.path}.lock")):
                return self._load_unlocked()
        except OSError as error:
            raise JobQueueStorageError(f"Unable to read jobs queue: {error}") from error

    def _load_unlocked(self) -> list[QueuedJob]:
        if not self.path.exists():
            return []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            return [QueuedJob.model_validate(job) for job in payload["jobs"]]
        except (OSError, KeyError, TypeError, json.JSONDecodeError, ValidationError) as error:
            raise JobQueueDataError(f"Invalid jobs JSON: {error}") from error

    def _save(self, jobs: list[QueuedJob]) -> None:
        write_json_atomic(self.path, {"jobs": [job.model_dump(mode="json") for job in jobs]})


def _status_matches(
    current: JobStatus,
    expected: JobStatus | tuple[JobStatus, ...],
) -> bool:
    if isinstance(expected, str):
        return current == expected
    return current in expected


def _payload_fingerprint(payload: dict[str, object]) -> str:
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _stored_payload_hash(job: QueuedJob) -> str:
    return job.payload_hash or _payload_fingerprint(job.payload)


def _active_cut_version(cut):
    if not cut.versions:
        return None
    if cut.active_version_id is None:
        return cut.versions[-1]
    return next((version for version in cut.versions if version.id == cut.active_version_id), None)

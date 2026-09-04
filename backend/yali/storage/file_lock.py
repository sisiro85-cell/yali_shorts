from __future__ import annotations

import os
from contextlib import AbstractContextManager
from pathlib import Path


class CrossProcessFileLock(AbstractContextManager[None]):
    """Small advisory lock for JSON read-modify-write critical sections."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._file: object | None = None

    def __enter__(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_file = self.path.open("a+b")
        if self.path.stat().st_size == 0:
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

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        finally:
            lock_file.close()  # type: ignore[union-attr]
            self._file = None
        return None

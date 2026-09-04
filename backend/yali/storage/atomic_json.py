from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


class StorageUnavailableError(Exception):
    """Raised when an expected local storage operation is unavailable."""


def write_json_atomic(path: Path, payload: Any) -> None:
    """Replace JSON only after a complete same-directory temporary file is durable."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(payload, temporary_file, ensure_ascii=False, indent=2)
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
        _sync_directory(path.parent)
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass


def _sync_directory(directory: Path) -> None:
    """Best-effort metadata sync; Windows does not reliably open directories."""
    try:
        descriptor = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)

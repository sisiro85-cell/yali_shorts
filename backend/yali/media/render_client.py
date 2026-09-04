from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from yali.rendering.manifest import OutputManifest


RenderQuality = Literal["draft", "standard", "high"]


class RenderWorkerError(RuntimeError):
    """Raised when the local HyperFrames worker cannot complete a request."""


@dataclass(frozen=True, slots=True)
class RenderWorkerResult:
    status: str
    output_path: str


class RenderWorkerClient:
    """Small stdlib-only client for the local HyperFrames render worker."""

    def __init__(self, base_url: str = "http://127.0.0.1:8010", timeout_seconds: float = 30.0) -> None:
        normalized = base_url.strip().rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Render worker URL must be an http(s) URL")
        self.base_url = normalized
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_env(cls) -> "RenderWorkerClient":
        raw_timeout = os.environ.get("YALI_RENDER_TIMEOUT_SECONDS", "30").strip()
        try:
            timeout = max(1.0, min(300.0, float(raw_timeout)))
        except ValueError:
            timeout = 30.0
        return cls(os.environ.get("YALI_RENDER_URL", "http://127.0.0.1:8010"), timeout)

    def health(self) -> dict[str, Any]:
        payload = self._request("GET", "/health")
        return payload

    def render(
        self,
        manifest: OutputManifest,
        *,
        project_root: Path,
        output_path: str,
        quality: RenderQuality = "draft",
    ) -> RenderWorkerResult:
        payload = self._request(
            "POST",
            "/render",
            {
                "manifest": manifest.model_dump(mode="json"),
                "options": {
                    "projectRoot": str(Path(project_root).resolve()),
                    "outputPath": output_path,
                    "quality": quality,
                    "format": "mp4",
                },
            },
        )
        status = payload.get("status")
        returned_path = payload.get("output_path")
        if not isinstance(status, str) or not isinstance(returned_path, str):
            raise RenderWorkerError("Render worker returned an invalid response")
        return RenderWorkerResult(status=status, output_path=returned_path)

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read()
        except HTTPError as error:
            raise RenderWorkerError(f"Render worker rejected the request ({error.code})") from None
        except (URLError, TimeoutError, OSError):
            raise RenderWorkerError("Render worker is unavailable") from None
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise RenderWorkerError("Render worker returned invalid JSON") from None
        if not isinstance(payload, dict):
            raise RenderWorkerError("Render worker returned an invalid response")
        if not 200 <= response.status < 300:
            raise RenderWorkerError("Render worker could not complete the request")
        return payload

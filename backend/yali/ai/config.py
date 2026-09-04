from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True, slots=True)
class AiSettings:
    provider: str = "codex_mcp"
    codex_model: str = ""
    api_base_url: str = ""
    api_model: str = ""
    api_key: str = ""

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "AiSettings":
        source = os.environ if environ is None else environ
        provider = source.get("YALI_LLM_PROVIDER", "codex_mcp").strip().lower()
        if provider not in {"codex_mcp", "api", "fake"}:
            raise ValueError("Unsupported YALI_LLM_PROVIDER")
        return cls(
            provider=provider,
            codex_model=source.get("YALI_CODEX_MODEL", "").strip(),
            api_base_url=source.get("YALI_API_BASE_URL", "").strip(),
            api_model=source.get("YALI_API_MODEL", "").strip(),
            api_key=source.get("YALI_API_KEY", "").strip(),
        )

    def public_settings(self) -> dict[str, str | bool]:
        return {
            "provider": self.provider,
            "codex_model": self.codex_model,
            "api_base_url": self.api_base_url,
            "api_model": self.api_model,
            "api_key_configured": bool(self.api_key),
        }

    @property
    def api_configured(self) -> bool:
        return bool(self.api_base_url and self.api_model and self.api_key)

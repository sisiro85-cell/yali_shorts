from __future__ import annotations

import json
import urllib.error
import urllib.request

from yali.ai.protocols import ProviderHealth, TextGenerationRequest, TextGenerationResponse


class ApiProviderError(RuntimeError):
    pass


class OpenAiCompatibleProvider:
    name = "api"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float = 120.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse:
        model = (request.model_name or self.model).strip()
        payload = json.dumps(
            {
                "model": model,
                "messages": [{"role": "user", "content": request.prompt}],
            },
            ensure_ascii=False,
        ).encode("utf-8")
        http_request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=payload,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(http_request, timeout=self.timeout_seconds) as response:
                decoded = json.loads(response.read().decode("utf-8"))
            text = decoded["choices"][0]["message"]["content"]
            if not isinstance(text, str) or not text.strip():
                raise ValueError("empty content")
        except (OSError, ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError):
            raise ApiProviderError("API text generation failed") from None
        return TextGenerationResponse(text=text.strip(), provider=self.name, model=model or None)

    def health(self) -> ProviderHealth:
        configured = bool(self.base_url and self.model and self._api_key)
        return ProviderHealth(
            provider=self.name,
            available=configured,
            message="API provider is configured" if configured else "API provider is not configured",
            requires_api_key=True,
        )

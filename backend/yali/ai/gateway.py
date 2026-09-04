from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping
from uuid import uuid4

from yali.ai.config import AiSettings
from yali.ai.protocols import (
    GenerationMetadata,
    Operation,
    ProviderHealth,
    TextGenerationRequest,
    TextProvider,
)
from yali.ai.providers.api_provider import OpenAiCompatibleProvider
from yali.ai.providers.codex_mcp import CodexMcpProvider
from yali.ai.providers.fake import FakeTextProvider


class AiGatewayError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class GenerationResult:
    operation: Operation
    data: dict[str, Any]
    provider: str
    used_fallback: bool
    metadata: dict[str, str | None]


_INSTRUCTIONS: dict[Operation, str] = {
    Operation.ANALYZE_SOURCE: (
        'Analyze the source for a short-form video. Return JSON only with '
        'summary, key_points (array), audience, tone.'
    ),
    Operation.GENERATE_IDEA: (
        'Create one short-form content idea. Return JSON only with title, hook, angle, summary.'
    ),
    Operation.GENERATE_SCRIPT: (
        'Write a concise short-form script. Return JSON only with hook, body, '
        'cta, and lines. Each line must contain order, speaker, text, '
        'duration_ms, and optional scene_intent.'
    ),
    Operation.GENERATE_CUT_PLAN: (
        'Split the script into visual scenes and cuts. Return JSON only with '
        'scenes. Each scene must contain order, title, and cuts. Each cut must '
        'contain order, title, duration_ms, visual_prompt, narration_text, '
        'subtitle, and motion_preset.'
    ),
    Operation.REGENERATE_CUT: (
        'Regenerate one short-form video cut while preserving its duration and identity. '
        'Return JSON only with cut containing visual_prompt, narration_text, subtitle, '
        'and motion_preset. Prefer concise, production-ready text.'
    ),
    Operation.GENERATE_SUBTITLES: (
        'Create timed subtitles. Return JSON only with subtitles (array of start_ms, end_ms, text).'
    ),
}


def _prompt(operation: Operation, context: Mapping[str, Any]) -> str:
    compact_context = json.dumps(
        dict(context), ensure_ascii=False, separators=(",", ":"), default=str
    )
    return f"{_INSTRUCTIONS[operation]}\nINPUT_JSON:{compact_context}"


def _json_object(text: str) -> dict[str, Any] | None:
    candidate = text.strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3:
            candidate = "\n".join(lines[1:-1]).strip()
            if candidate.lower().startswith("json"):
                candidate = candidate[4:].lstrip()
    try:
        decoded = json.loads(candidate)
    except json.JSONDecodeError:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            decoded = json.loads(candidate[start : end + 1])
        except json.JSONDecodeError:
            return None
    return decoded if isinstance(decoded, dict) else None


def _fallback_shape(operation: Operation, text: str) -> dict[str, Any]:
    clean = text.strip()
    if operation is Operation.ANALYZE_SOURCE:
        return {"summary": clean, "key_points": [], "audience": "", "tone": ""}
    if operation is Operation.GENERATE_IDEA:
        return {"title": "", "hook": "", "angle": "", "summary": clean}
    if operation is Operation.GENERATE_SCRIPT:
        return {
            "hook": "",
            "body": clean,
            "cta": "",
            "lines": [],
        }
    if operation is Operation.GENERATE_CUT_PLAN:
        return {"scenes": []}
    if operation is Operation.REGENERATE_CUT:
        return {"cut": {}}
    return {"subtitles": []}


def _normalize(operation: Operation, text: str) -> dict[str, Any]:
    value = _json_object(text)
    if value is None:
        return _fallback_shape(operation, text)
    defaults = _fallback_shape(operation, "")
    return {**defaults, **value}


class AiGateway:
    def __init__(
        self,
        *,
        primary: TextProvider,
        fallback: TextProvider | None = None,
        default_model: str = "",
    ) -> None:
        self.primary = primary
        self.fallback = fallback
        self.default_model = default_model

    def generate(
        self,
        operation: Operation | str,
        context: Mapping[str, Any],
        model_name: str | None = None,
        *,
        project_id: str | None = None,
        cut_id: str | None = None,
        request_id: str | None = None,
    ) -> GenerationResult:
        typed_operation = Operation(operation)
        model = (model_name or self.default_model).strip() or None
        metadata = GenerationMetadata(
            request_id=request_id or str(uuid4()),
            project_id=project_id,
            cut_id=cut_id,
            operation=typed_operation,
            model=model,
        )
        request = TextGenerationRequest(
            operation=typed_operation,
            prompt=_prompt(typed_operation, context),
            model_name=model,
            metadata=metadata,
        )
        provider = self.primary
        used_fallback = False
        try:
            response = provider.generate(request)
        except Exception:
            if self.fallback is None:
                raise AiGatewayError("Text generation provider unavailable") from None
            provider = self.fallback
            used_fallback = True
            try:
                response = provider.generate(request)
            except Exception:
                raise AiGatewayError("Text generation providers unavailable") from None
        return GenerationResult(
            operation=typed_operation,
            data=_normalize(typed_operation, response.text),
            provider=response.provider,
            used_fallback=used_fallback,
            metadata=metadata.as_dict(),
        )

    def health(self, provider: str | None = None) -> ProviderHealth:
        if provider is None or provider == self.primary.name:
            return self.primary.health()
        if self.fallback is not None and provider == self.fallback.name:
            return self.fallback.health()
        return ProviderHealth(
            provider=provider or "unknown",
            available=False,
            message="Provider is not configured",
        )

    def test_connection(self, provider: str | None = None) -> ProviderHealth:
        target: TextProvider | None = None
        if provider is None or provider == self.primary.name:
            target = self.primary
        elif self.fallback is not None and provider == self.fallback.name:
            target = self.fallback
        if target is None:
            return ProviderHealth(
                provider=provider or "unknown",
                available=False,
                message="Provider is not configured",
            )
        checker = getattr(target, "test_connection", None)
        if checker is None:
            return target.health()
        try:
            result = checker()
        except Exception:
            return ProviderHealth(
                provider=target.name,
                available=False,
                message="Provider connection test failed",
            )
        return result if isinstance(result, ProviderHealth) else target.health()


@dataclass(frozen=True, slots=True)
class GatewayFactory:
    settings: AiSettings

    def create(self) -> AiGateway:
        if self.settings.provider == "fake":
            return AiGateway(primary=FakeTextProvider())
        api_provider = self._api_provider() if self.settings.api_configured else None
        if self.settings.provider == "api":
            if api_provider is None:
                api_provider = OpenAiCompatibleProvider(
                    base_url=self.settings.api_base_url,
                    api_key=self.settings.api_key,
                    model=self.settings.api_model,
                )
            return AiGateway(primary=api_provider, default_model=self.settings.api_model)
        return AiGateway(
            primary=CodexMcpProvider(model=self.settings.codex_model),
            fallback=api_provider,
            default_model=self.settings.codex_model,
        )

    def _api_provider(self) -> OpenAiCompatibleProvider:
        return OpenAiCompatibleProvider(
            base_url=self.settings.api_base_url,
            api_key=self.settings.api_key,
            model=self.settings.api_model,
        )

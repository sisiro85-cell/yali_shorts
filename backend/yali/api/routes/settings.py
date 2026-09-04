from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from yali.ai.gateway import AiGateway
from yali.ai.protocols import ProviderHealth
from yali.api.dependencies import get_ai_gateway


router = APIRouter(prefix="/settings", tags=["settings"])


class ProviderHealthResponse(BaseModel):
    provider: str
    available: bool
    message: str
    requires_api_key: bool

    @classmethod
    def from_health(cls, health: ProviderHealth) -> "ProviderHealthResponse":
        return cls(
            provider=health.provider,
            available=health.available,
            message=health.message,
            requires_api_key=health.requires_api_key,
        )


class LlmSettingsResponse(BaseModel):
    provider: str
    model: str
    codex_model: str
    api_base_url: str
    api_model: str
    api_key_configured: bool
    primary: ProviderHealthResponse
    fallback: ProviderHealthResponse | None = None


class LlmConnectionTestRequest(BaseModel):
    provider: Literal["codex_mcp", "api", "fake"] | None = None


class LlmConnectionTestResponse(BaseModel):
    provider: str
    ok: bool
    message: str


@router.get("/llm", response_model=LlmSettingsResponse)
def get_llm_settings(request: Request, gateway: AiGateway = Depends(get_ai_gateway)) -> LlmSettingsResponse:
    settings = request.app.state.ai_settings
    primary = gateway.health()
    fallback = None
    fallback_provider = getattr(gateway, "fallback", None)
    if fallback_provider is not None:
        fallback = ProviderHealthResponse.from_health(gateway.health(fallback_provider.name))
    return LlmSettingsResponse(
        provider=gateway.primary.name,
        model=settings.codex_model if gateway.primary.name == "codex_mcp" else settings.api_model,
        codex_model=settings.codex_model,
        api_base_url=settings.api_base_url,
        api_model=settings.api_model,
        api_key_configured=bool(settings.api_key),
        primary=ProviderHealthResponse.from_health(primary),
        fallback=fallback,
    )


@router.post("/llm/test", response_model=LlmConnectionTestResponse)
def test_llm_connection(
    request: LlmConnectionTestRequest,
    gateway: AiGateway = Depends(get_ai_gateway),
) -> LlmConnectionTestResponse:
    health = gateway.test_connection(request.provider)
    return LlmConnectionTestResponse(
        provider=health.provider,
        ok=health.available,
        message=health.message,
    )

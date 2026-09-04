from __future__ import annotations

import json
from dataclasses import dataclass, field

from yali.ai.protocols import (
    Operation,
    ProviderHealth,
    TextGenerationRequest,
    TextGenerationResponse,
)


@dataclass(slots=True)
class FakeTextProvider:
    responses: dict[Operation, str] = field(default_factory=dict)
    name: str = "fake"
    requests: list[TextGenerationRequest] = field(default_factory=list, init=False)

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse:
        self.requests.append(request)
        text = self.responses.get(
            request.operation,
            json.dumps({"operation": request.operation.value}, ensure_ascii=False),
        )
        return TextGenerationResponse(
            text=text,
            provider=self.name,
            model=request.model_name,
        )

    def health(self) -> ProviderHealth:
        return ProviderHealth(
            provider=self.name,
            available=True,
            message="Deterministic fake provider is available",
        )

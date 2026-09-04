from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol, runtime_checkable

from yali.media.aspect import ImageAspectRatio

class Operation(StrEnum):
    ANALYZE_SOURCE = "analyze_source"
    GENERATE_IDEA = "generate_idea"
    GENERATE_SCRIPT = "generate_script"
    GENERATE_CUT_PLAN = "generate_cut_plan"
    REGENERATE_CUT = "regenerate_cut"
    GENERATE_SUBTITLES = "generate_subtitles"


@dataclass(frozen=True, slots=True)
class GenerationMetadata:
    """Safe trace data. User input and credentials deliberately have no field here."""

    request_id: str
    project_id: str | None
    cut_id: str | None
    operation: Operation
    model: str | None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "request_id": self.request_id,
            "project_id": self.project_id,
            "cut_id": self.cut_id,
            "operation": self.operation.value,
            "model": self.model,
        }


@dataclass(frozen=True, slots=True)
class TextGenerationRequest:
    operation: Operation
    prompt: str
    model_name: str | None
    metadata: GenerationMetadata


@dataclass(frozen=True, slots=True)
class TextGenerationResponse:
    text: str
    provider: str
    model: str | None = None


@dataclass(frozen=True, slots=True)
class ImageGenerationRequest:
    prompt: str
    model_name: str | None
    metadata: GenerationMetadata
    aspect_ratio: ImageAspectRatio = "9:16"


@dataclass(frozen=True, slots=True)
class ImageGenerationResponse:
    content: bytes
    media_type: str
    provider: str
    model: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderHealth:
    provider: str
    available: bool
    message: str
    requires_api_key: bool = False


@runtime_checkable
class TextProvider(Protocol):
    name: str

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse: ...

    def health(self) -> ProviderHealth: ...


@runtime_checkable
class ImageProvider(Protocol):
    name: str

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse: ...

    def health(self) -> ProviderHealth: ...

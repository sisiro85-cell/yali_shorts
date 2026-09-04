from __future__ import annotations

from yali.ai.protocols import (
    GenerationMetadata,
    ImageGenerationRequest,
    ImageGenerationResponse,
    ImageProvider,
    Operation,
    ProviderHealth,
)


class FakeImageProvider:
    name = "fake_image"

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        return ImageGenerationResponse(
            content=b"png-bytes",
            media_type="image/png",
            provider=self.name,
            model=request.model_name,
        )

    def health(self) -> ProviderHealth:
        return ProviderHealth(
            provider=self.name,
            available=True,
            message="fake image provider is available",
        )


def test_image_generation_contract_requires_png_bytes() -> None:
    request = ImageGenerationRequest(
        prompt="세로형 스마트폰 화면의 AI 채팅창",
        model_name=None,
        metadata=GenerationMetadata(
            request_id="request-1",
            project_id=None,
            cut_id=None,
            operation=Operation.REGENERATE_CUT,
            model=None,
        ),
    )
    response = FakeImageProvider().generate(request)

    assert request.prompt
    assert response.media_type == "image/png"
    assert isinstance(response.content, bytes)
    assert isinstance(response.provider, str)
    assert isinstance(FakeImageProvider(), ImageProvider)

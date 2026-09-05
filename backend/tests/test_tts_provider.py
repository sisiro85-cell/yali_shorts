from dataclasses import dataclass, field

import pytest

from yali.ai.protocols import GenerationMetadata, Operation, TTSGenerationRequest
from yali.ai.providers.edge_tts import EdgeTTSProvider, TTSProviderError


@dataclass
class FakeCommunicate:
    text: str
    voice: str
    rate: str
    volume: str
    pitch: str
    calls: list["FakeCommunicate"] = field(default_factory=list)

    async def stream(self):
        yield {"type": "metadata", "data": b"ignored"}
        yield {"type": "audio", "data": b"ID3-first"}
        yield {"type": "audio", "data": bytearray(b"-second")}


def _request(**overrides: object) -> TTSGenerationRequest:
    values: dict[str, object] = {
        "text": "작업을 자동화하면 시간이 줄어듭니다.",
        "language": "ko-KR",
        "voice_id": "ko-KR-SunHiNeural",
        "speed": 1.2,
        "volume": 0.85,
        "pitch": 2.0,
        "metadata": GenerationMetadata(
            request_id="tts-request-1",
            project_id="project-1",
            cut_id="cut-1",
            operation=Operation.GENERATE_TTS,
            model=None,
        ),
    }
    values.update(overrides)
    return TTSGenerationRequest(**values)


def test_edge_tts_converts_voice_controls_and_collects_audio_chunks() -> None:
    calls: list[FakeCommunicate] = []

    def factory(**kwargs: str) -> FakeCommunicate:
        call = FakeCommunicate(**kwargs)
        calls.append(call)
        return call

    provider = EdgeTTSProvider(communicate_factory=factory)

    response = provider.generate(_request())

    assert response.content == b"ID3-first-second"
    assert response.media_type == "audio/mpeg"
    assert response.provider == "edge_tts"
    assert response.voice_id == "ko-KR-SunHiNeural"
    assert response.duration_ms is None
    assert calls[0].text == "작업을 자동화하면 시간이 줄어듭니다."
    assert calls[0].voice == "ko-KR-SunHiNeural"
    assert calls[0].rate == "+20%"
    assert calls[0].volume == "-15%"
    assert calls[0].pitch == "+100Hz"


def test_edge_tts_rejects_blank_text_without_calling_provider() -> None:
    called = False

    def factory(**_: str) -> FakeCommunicate:
        nonlocal called
        called = True
        raise AssertionError("blank text must not reach Edge TTS")

    with pytest.raises(TTSProviderError, match="text"):
        EdgeTTSProvider(communicate_factory=factory).generate(_request(text="   "))

    assert called is False

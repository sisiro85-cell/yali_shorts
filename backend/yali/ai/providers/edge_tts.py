from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from yali.ai.protocols import ProviderHealth, TTSGenerationRequest, TTSGenerationResponse


class TTSProviderError(RuntimeError):
    """Raised when an audio provider cannot return a usable result."""


CommunicateFactory = Callable[..., Any]


@dataclass(slots=True)
class EdgeTTSProvider:
    """Synchronous adapter around the asynchronous ``edge-tts`` client."""

    name: str = "edge_tts"
    communicate_factory: CommunicateFactory | None = None

    def generate(self, request: TTSGenerationRequest) -> TTSGenerationResponse:
        text = request.text.strip()
        if not text:
            raise TTSProviderError("TTS text must not be blank")
        if not request.voice_id.strip():
            raise TTSProviderError("TTS voice must not be blank")

        try:
            audio = asyncio.run(self._collect_audio(request, text))
        except TTSProviderError:
            raise
        except Exception as error:
            raise TTSProviderError("Edge TTS request failed") from error
        if not audio:
            raise TTSProviderError("Edge TTS returned no audio")
        return TTSGenerationResponse(
            content=audio,
            media_type="audio/mpeg",
            provider=self.name,
            voice_id=request.voice_id,
        )

    def health(self) -> ProviderHealth:
        if self.communicate_factory is not None:
            return ProviderHealth(
                provider=self.name,
                available=True,
                message="Edge TTS adapter is available",
            )
        try:
            self._default_factory()
        except ImportError:
            return ProviderHealth(
                provider=self.name,
                available=False,
                message="edge-tts is not installed",
            )
        except Exception:
            return ProviderHealth(
                provider=self.name,
                available=False,
                message="Edge TTS adapter is unavailable",
            )
        return ProviderHealth(
            provider=self.name,
            available=True,
            message="Edge TTS adapter is available",
        )

    async def _collect_audio(self, request: TTSGenerationRequest, text: str) -> bytes:
        communicate = self._factory()(
            text=text,
            voice=request.voice_id,
            rate=_edge_rate(request.speed),
            volume=_edge_volume(request.volume),
            pitch=_edge_pitch(request.pitch),
        )
        stream = communicate.stream()
        audio_chunks: list[bytes] = []
        async for chunk in _async_chunks(stream):
            if chunk.get("type") != "audio":
                continue
            data = chunk.get("data")
            if isinstance(data, bytes):
                audio_chunks.append(data)
            elif isinstance(data, bytearray):
                audio_chunks.append(bytes(data))
        return b"".join(audio_chunks)

    def _factory(self) -> CommunicateFactory:
        return self.communicate_factory or self._default_factory()

    @staticmethod
    def _default_factory() -> CommunicateFactory:
        try:
            import edge_tts
        except ImportError as error:
            raise ImportError("edge-tts is not installed") from error
        return edge_tts.Communicate


async def _async_chunks(stream: Any) -> AsyncIterator[dict[str, Any]]:
    async for chunk in stream:
        if isinstance(chunk, dict):
            yield chunk


def _edge_rate(speed: float) -> str:
    percent = round((speed - 1.0) * 100)
    return f"{percent:+d}%"


def _edge_volume(volume: float) -> str:
    percent = round((volume - 1.0) * 100)
    return f"{percent:+d}%"


def _edge_pitch(pitch: float) -> str:
    # Edge TTS accepts pitch in Hz while the UI stores musical semitones.
    hertz = round(pitch * 50)
    return f"{hertz:+d}Hz"

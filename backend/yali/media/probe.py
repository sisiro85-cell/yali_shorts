from __future__ import annotations

import struct


def detect_image_dimensions(content: bytes, media_type: str) -> tuple[int, int] | None:
    """Read dimensions from common image headers without decoding the pixels."""
    normalized = media_type.split(";", 1)[0].strip().lower()
    if normalized == "image/png":
        return _png_dimensions(content)
    if normalized in {"image/jpeg", "image/jpg"}:
        return _jpeg_dimensions(content)
    if normalized == "image/gif":
        return _gif_dimensions(content)
    if normalized == "image/webp":
        return _webp_dimensions(content)
    return None


def _png_dimensions(content: bytes) -> tuple[int, int] | None:
    if len(content) < 24 or content[:8] != b"\x89PNG\r\n\x1a\n" or content[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", content[16:24])
    return _positive_dimensions(width, height)


def _gif_dimensions(content: bytes) -> tuple[int, int] | None:
    if len(content) < 10 or content[:6] not in {b"GIF87a", b"GIF89a"}:
        return None
    width, height = struct.unpack("<HH", content[6:10])
    return _positive_dimensions(width, height)


def _jpeg_dimensions(content: bytes) -> tuple[int, int] | None:
    if len(content) < 4 or content[:2] != b"\xff\xd8":
        return None
    index = 2
    while index + 9 < len(content):
        if content[index] != 0xFF:
            index += 1
            continue
        while index < len(content) and content[index] == 0xFF:
            index += 1
        if index >= len(content):
            return None
        marker = content[index]
        index += 1
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > len(content):
            return None
        segment_length = struct.unpack(">H", content[index : index + 2])[0]
        if segment_length < 2 or index + segment_length > len(content):
            return None
        if marker in set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0)):
            if segment_length < 7:
                return None
            height, width = struct.unpack(">HH", content[index + 3 : index + 7])
            return _positive_dimensions(width, height)
        index += segment_length
    return None


def _webp_dimensions(content: bytes) -> tuple[int, int] | None:
    if len(content) < 30 or content[:4] != b"RIFF" or content[8:12] != b"WEBP":
        return None
    chunk = content[12:16]
    if chunk == b"VP8X" and len(content) >= 30:
        width = 1 + int.from_bytes(content[24:27], "little")
        height = 1 + int.from_bytes(content[27:30], "little")
        return _positive_dimensions(width, height)
    return None


def _positive_dimensions(width: int, height: int) -> tuple[int, int] | None:
    if width <= 0 or height <= 0:
        return None
    return width, height

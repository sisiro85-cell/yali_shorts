from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid5

from yali.domain.models import Cut, MediaAsset, Project


_GENERATED_AUDIO_NAMESPACE = UUID("f6da2ed1-0795-4fd7-8bb5-82d3a0ff5e52")
_AUDIO_EXTENSIONS = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
}


@dataclass(frozen=True, slots=True)
class GeneratedCutAudio:
    asset: MediaAsset
    path: Path
    created: bool


def attach_generated_cut_audio(
    project: Project,
    cut: Cut,
    assets_root: Path,
    *,
    content: bytes,
    media_type: str = "audio/mpeg",
) -> GeneratedCutAudio:
    """Persist generated audio and attach it to the cut's active version."""
    version = _active_version(cut)
    if version is None:
        raise ValueError(f"Cut has no active version: {cut.id}")
    normalized_media_type = media_type.split(";", 1)[0].strip().lower()
    extension = _AUDIO_EXTENSIONS.get(normalized_media_type)
    if extension is None:
        raise ValueError(f"Unsupported generated audio type: {normalized_media_type}")
    if not isinstance(content, bytes) or not content:
        raise ValueError("Cut audio provider returned empty content")

    content_hash = hashlib.sha256(content).hexdigest()
    asset_id = uuid5(_GENERATED_AUDIO_NAMESPACE, f"{cut.id}:{version.id}:{content_hash}")
    # Keep both final and temporary paths comfortably below Windows' legacy
    # MAX_PATH limit while retaining stable cut/version/content identity.
    filename = f"tts-{cut.id.hex[:12]}-{version.id.hex[:12]}-{content_hash[:16]}{extension}"
    generated_dir = Path(assets_root) / "generated"
    path = generated_dir / filename
    generated_dir.mkdir(parents=True, exist_ok=True)

    created = True
    if path.is_file():
        try:
            created = path.read_bytes() != content
        except OSError:
            created = True
    if created:
        temporary_path = path.with_name(f".{filename}.{content_hash[:12]}.tmp")
        try:
            temporary_path.write_bytes(content)
            os.replace(temporary_path, path)
        finally:
            temporary_path.unlink(missing_ok=True)

    asset = MediaAsset(
        id=asset_id,
        filename=filename,
        relative_path=f"assets/generated/{filename}",
        media_type="audio",
        content_hash=content_hash,
    )
    cut.audio_asset_id = asset.id
    version.audio_asset_id = asset.id
    existing_index = next(
        (index for index, existing in enumerate(project.assets) if existing.id == asset.id),
        None,
    )
    if existing_index is None:
        project.assets.append(asset)
    else:
        project.assets[existing_index] = asset
    return GeneratedCutAudio(asset=asset, path=path, created=created)


def _active_version(cut: Cut):
    if not cut.versions:
        return None
    if cut.active_version_id is None:
        return cut.versions[-1]
    return next((item for item in cut.versions if item.id == cut.active_version_id), None)

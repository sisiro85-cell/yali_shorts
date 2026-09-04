from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid5

from yali.domain.models import Cut, MediaAsset, Project
from yali.media.probe import detect_image_dimensions


_GENERATED_ASSET_NAMESPACE = UUID("5d8a6f0d-8b12-4ed1-9b77-6c05d38b3373")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@dataclass(frozen=True, slots=True)
class GeneratedCutVisual:
    asset: MediaAsset
    path: Path
    created: bool


def attach_generated_cut_visual(
    project: Project,
    cut: Cut,
    assets_root: Path,
    *,
    content: bytes,
    media_type: str = "image/png",
) -> GeneratedCutVisual:
    """Persist provider-generated image bytes and attach them to the active cut."""
    version = _active_version(cut)
    if version is None:
        raise ValueError(f"Cut has no active version: {cut.id}")
    normalized_media_type = media_type.split(";", 1)[0].strip().lower()
    if normalized_media_type != "image/png":
        raise ValueError("Cut image generation currently requires image/png")
    if not isinstance(content, bytes) or not content.startswith(_PNG_SIGNATURE):
        raise ValueError("Cut image provider returned an invalid PNG")
    dimensions = detect_image_dimensions(content, normalized_media_type)
    if dimensions is None:
        raise ValueError("Cut image provider returned a PNG without dimensions")

    content_hash = hashlib.sha256(content).hexdigest()
    asset_id = uuid5(_GENERATED_ASSET_NAMESPACE, f"{cut.id}:{version.id}")
    filename = f"cut-{cut.id}-{version.id}.png"
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
        media_type="image",
        width=dimensions[0],
        height=dimensions[1],
        media_color_profile="sRGB",
        content_hash=content_hash,
    )
    cut.media_asset_id = asset.id
    version.media_asset_id = asset.id
    cut.status = "ready"
    cut.error = None
    existing_index = next(
        (index for index, existing in enumerate(project.assets) if existing.id == asset.id),
        None,
    )
    if existing_index is None:
        project.assets.append(asset)
    else:
        project.assets[existing_index] = asset
    return GeneratedCutVisual(asset=asset, path=path, created=created)


def _active_version(cut: Cut):
    if cut.active_version_id is None:
        return cut.versions[-1] if cut.versions else None
    return next((version for version in cut.versions if version.id == cut.active_version_id), None)

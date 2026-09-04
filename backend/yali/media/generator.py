from __future__ import annotations

import hashlib
import html
import os
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid5

from yali.domain.models import Cut, MediaAsset, Project


_GENERATED_ASSET_NAMESPACE = UUID("5d8a6f0d-8b12-4ed1-9b77-6c05d38b3373")
_WIDTH = 1080
_HEIGHT = 1920


@dataclass(frozen=True, slots=True)
class GeneratedCutVisual:
    asset: MediaAsset
    path: Path
    created: bool


def attach_generated_cut_visual(
    project: Project,
    cut: Cut,
    assets_root: Path,
) -> GeneratedCutVisual:
    """Create and attach a deterministic visual for a cut version.

    The MVP must be renderable even when no reference image was uploaded. This
    local SVG generator is deliberately provider-neutral: a future image
    provider can replace the file while keeping the same versioned asset
    contract. The generated file contains no subtitle text; captions remain a
    separate render layer.
    """
    version = _active_version(cut)
    if version is None:
        raise ValueError(f"Cut has no active version: {cut.id}")

    content = _visual_svg(cut, version.visual_prompt)
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    asset_id = uuid5(_GENERATED_ASSET_NAMESPACE, f"{cut.id}:{version.id}")
    filename = f"cut-{cut.id}-{version.id}.svg"
    generated_dir = Path(assets_root) / "generated"
    path = generated_dir / filename
    generated_dir.mkdir(parents=True, exist_ok=True)

    created = True
    if path.is_file():
        try:
            created = path.read_text(encoding="utf-8") != content
        except OSError:
            created = True
    if created:
        temporary_path = path.with_name(f".{filename}.{content_hash[:12]}.tmp")
        try:
            temporary_path.write_text(content, encoding="utf-8", newline="\n")
            os.replace(temporary_path, path)
        finally:
            temporary_path.unlink(missing_ok=True)

    asset = MediaAsset(
        id=asset_id,
        filename=filename,
        relative_path=f"assets/generated/{filename}",
        media_type="image",
        width=_WIDTH,
        height=_HEIGHT,
        media_color_profile="sRGB",
        content_hash=content_hash,
    )
    cut.media_asset_id = asset.id
    version.media_asset_id = asset.id
    cut.status = "ready"
    if not any(existing.id == asset.id for existing in project.assets):
        project.assets.append(asset)
    return GeneratedCutVisual(asset=asset, path=path, created=created)


def _active_version(cut: Cut):
    if cut.active_version_id is None:
        return cut.versions[-1] if cut.versions else None
    return next((version for version in cut.versions if version.id == cut.active_version_id), None)


def _visual_svg(cut: Cut, visual_prompt: str) -> str:
    seed = hashlib.sha256(f"{cut.id}:{visual_prompt}".encode("utf-8")).hexdigest()
    first = f"#{seed[0:6]}"
    second = f"#{seed[6:12]}"
    accent = f"#{seed[12:18]}"
    circle_x = 180 + int(seed[18:22], 16) % 720
    circle_y = 240 + int(seed[22:26], 16) % 1240
    circle_radius = 160 + int(seed[26:30], 16) % 300
    offset = int(seed[30:34], 16) % 420 - 210
    safe_prompt = html.escape(visual_prompt[:2_000], quote=True)
    safe_title = html.escape(cut.title[:200], quote=True)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{_WIDTH}" height="{_HEIGHT}" viewBox="0 0 {_WIDTH} {_HEIGHT}" role="img">
  <title>{safe_title}</title>
  <desc>{safe_prompt}</desc>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{first}"/>
      <stop offset="100%" stop-color="{second}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="{accent}" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="{accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{_WIDTH}" height="{_HEIGHT}" fill="url(#background)"/>
  <circle cx="{circle_x}" cy="{circle_y}" r="{circle_radius}" fill="url(#glow)"/>
  <path d="M{-120 + offset} 1510 C 180 1160, 420 1700, 690 1300 S 1030 1050, 1250 720" fill="none" stroke="{accent}" stroke-opacity="0.7" stroke-width="38" stroke-linecap="round"/>
  <rect x="72" y="72" width="936" height="1776" rx="44" fill="none" stroke="#FFFFFF" stroke-opacity="0.24" stroke-width="3"/>
  <circle cx="156" cy="164" r="18" fill="#FFFFFF" fill-opacity="0.8"/>
  <circle cx="216" cy="164" r="18" fill="#FFFFFF" fill-opacity="0.5"/>
  <circle cx="276" cy="164" r="18" fill="#FFFFFF" fill-opacity="0.28"/>
</svg>'''

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import PurePosixPath
from typing import Literal
from uuid import UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, computed_field

from yali.domain.models import Cut, CutVersion, MediaAsset, Project
from yali.domain.video_settings import ProjectVideoSettings, SubtitlePosition, SubtitleStyle


OutputFormat = Literal["shorts", "reels", "card_news"]
_OUTPUT_VARIANT_NAMESPACE = UUID("8fd8a47f-b317-4e17-9cec-c08f897471ba")
_OUTPUT_DIMENSIONS: dict[OutputFormat, tuple[int, int]] = {
    "shorts": (1080, 1920),
    "reels": (1080, 1920),
    "card_news": (1080, 1080),
}
_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:")


class OutputSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: int = Field(default=30, gt=0)
    pixel_format: str = "yuv420p"
    video_codec: str = "h264"
    audio_codec: str = "aac"


class ManifestAsset(BaseModel):
    model_config = ConfigDict(frozen=True)

    asset_id: UUID
    filename: str
    relative_path: str
    media_type: Literal["image", "video", "audio", "other"]
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    color_profile: str | None = None
    content_hash: str | None = None
    preserve_original: bool = True
    filters: list[str] = Field(default_factory=list)


class ManifestCut(BaseModel):
    model_config = ConfigDict(frozen=True)

    scene_id: UUID
    scene_order: int
    cut_id: UUID
    cut_order: int
    cut_version_id: UUID
    title: str
    media_asset_id: UUID | None = None
    audio_asset_id: UUID | None = None
    visual_prompt: str = ""
    narration: str = ""
    subtitle: str = ""
    subtitle_style: SubtitleStyle = Field(default_factory=SubtitleStyle)
    motion_preset: str = "static"
    duration_ms: int = Field(ge=250)


class OutputManifest(BaseModel):
    model_config = ConfigDict(frozen=True)

    schema_version: Literal["1.0"] = "1.0"
    renderer: Literal["hyperframes"] = "hyperframes"
    project_id: UUID
    output_variant_id: UUID
    created_at: datetime
    output_format: OutputFormat
    preset_id: str | None = None
    source_asset_id: UUID | None = None
    source_asset_hash: str | None = None
    source_idea_version_id: UUID | None = None
    source_script_version_id: UUID | None = None
    cut_version_ids: list[UUID]
    assets: list[ManifestAsset]
    cuts: list[ManifestCut]
    settings: OutputSettings

    def to_canonical_json(self) -> str:
        payload = self.model_dump(mode="json", exclude={"manifest_hash"})
        return json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )

    def deterministic_json(self) -> str:
        return self.to_canonical_json()

    @computed_field
    @property
    def manifest_hash(self) -> str:
        return hashlib.sha256(self.to_canonical_json().encode("utf-8")).hexdigest()


def build_manifest(
    project: Project,
    output_format: OutputFormat,
    preset_id: str | None = None,
    subtitle_style: SubtitleStyle | None = None,
) -> OutputManifest:
    width, height = _OUTPUT_DIMENSIONS[output_format]
    resolved_subtitle_style = subtitle_style or SubtitleStyle()
    project_assets = {asset.id: asset for asset in project.assets}
    manifest_cuts: list[ManifestCut] = []
    cut_version_ids: list[UUID] = []
    referenced_asset_ids: list[UUID] = []

    for scene in sorted(project.scenes, key=lambda item: (item.order, str(item.id))):
        for cut in sorted(scene.cuts, key=lambda item: (item.order, str(item.id))):
            version = _active_version(cut)
            cut_version_id = version.id if version is not None else cut.id
            media_asset_id = (
                version.media_asset_id
                if version is not None and version.media_asset_id is not None
                else cut.media_asset_id
            )
            if media_asset_id is not None:
                if media_asset_id not in project_assets:
                    raise ValueError(f"Cut references an unknown media asset: {media_asset_id}")
                _append_unique(referenced_asset_ids, media_asset_id)

            audio_asset_id = (
                version.audio_asset_id
                if version is not None and version.audio_asset_id is not None
                else cut.audio_asset_id
            )
            if audio_asset_id is not None:
                audio_asset = project_assets.get(audio_asset_id)
                if audio_asset is None:
                    raise ValueError(f"Cut references an unknown audio asset: {audio_asset_id}")
                if audio_asset.media_type != "audio":
                    raise ValueError(f"Cut audio reference is not an audio asset: {audio_asset_id}")
                _append_unique(referenced_asset_ids, audio_asset_id)

            manifest_cuts.append(
                ManifestCut(
                    scene_id=scene.id,
                    scene_order=scene.order,
                    cut_id=cut.id,
                    cut_order=cut.order,
                    cut_version_id=cut_version_id,
                    title=cut.title,
                    media_asset_id=media_asset_id,
                    audio_asset_id=audio_asset_id,
                    visual_prompt=version.visual_prompt if version is not None else cut.visual_prompt,
                    narration=version.narration_text if version is not None else cut.narration_text,
                    subtitle=version.subtitle if version is not None else cut.subtitle,
                    subtitle_style=resolved_subtitle_style,
                    motion_preset=version.motion_preset if version is not None else cut.motion_preset,
                    duration_ms=cut.duration_ms,
                )
            )
            cut_version_ids.append(cut_version_id)

    source_asset = _source_asset(project, project_assets, referenced_asset_ids)
    if source_asset is not None:
        referenced_asset_ids.insert(0, source_asset.id)
        referenced_asset_ids = list(dict.fromkeys(referenced_asset_ids))

    assets = [_manifest_asset(project_assets[asset_id]) for asset_id in referenced_asset_ids]
    output_variant_id = _output_variant_id(
        project,
        output_format,
        preset_id,
        cut_version_ids,
        resolved_subtitle_style,
    )
    existing_variant = next(
        (variant for variant in project.output_variants if variant.id == output_variant_id),
        None,
    )

    return OutputManifest(
        project_id=project.id,
        output_variant_id=output_variant_id,
        created_at=existing_variant.created_at if existing_variant is not None else project.updated_at,
        output_format=output_format,
        preset_id=preset_id,
        source_asset_id=source_asset.id if source_asset is not None else None,
        source_asset_hash=_asset_hash(source_asset) if source_asset is not None else None,
        source_idea_version_id=project.idea.active_version_id,
        source_script_version_id=project.script.active_version_id,
        cut_version_ids=cut_version_ids,
        assets=assets,
        cuts=manifest_cuts,
        settings=OutputSettings(width=width, height=height),
    )


def _active_version(cut: Cut) -> CutVersion | None:
    if not cut.versions:
        return None
    if cut.active_version_id is None:
        return cut.versions[-1]
    version = next((item for item in cut.versions if item.id == cut.active_version_id), None)
    if version is None:
        raise ValueError(f"Active cut version was not found: {cut.active_version_id}")
    return version


def _source_asset(
    project: Project,
    project_assets: dict[UUID, MediaAsset],
    referenced_asset_ids: list[UUID],
) -> MediaAsset | None:
    for asset_id in project.idea.draft.reference_asset_ids:
        asset = project_assets.get(asset_id)
        if asset is not None and asset.media_type in {"image", "video"}:
            return asset
    if referenced_asset_ids:
        return next(
            (
                project_assets[asset_id]
                for asset_id in referenced_asset_ids
                if project_assets[asset_id].media_type in {"image", "video"}
            ),
            None,
        )
    return next(
        (asset for asset in project.assets if asset.media_type in {"image", "video"}),
        None,
    )


def _manifest_asset(asset: MediaAsset) -> ManifestAsset:
    return ManifestAsset(
        asset_id=asset.id,
        filename=asset.filename,
        relative_path=_safe_relative_path(asset.relative_path),
        media_type=asset.media_type,
        width=asset.width,
        height=asset.height,
        color_profile=asset.media_color_profile,
        content_hash=_asset_hash(asset),
    )


def _asset_hash(asset: MediaAsset | None) -> str | None:
    if asset is None:
        return None
    value = getattr(asset, "content_hash", None) or getattr(asset, "sha256", None)
    return str(value) if value else None


def _safe_relative_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    if (
        not normalized
        or normalized.startswith("/")
        or _WINDOWS_DRIVE.match(normalized)
    ):
        raise ValueError(f"Expected a safe project-relative path: {value}")

    path = PurePosixPath(normalized)
    parts = path.parts
    if (
        path.is_absolute()
        or len(parts) < 2
        or parts[0] not in {"assets", "outputs"}
        or any(part in {"", ".", ".."} or ":" in part for part in parts)
    ):
        raise ValueError(f"Expected a safe project-relative path: {value}")
    return path.as_posix()


def _output_variant_id(
    project: Project,
    output_format: OutputFormat,
    preset_id: str | None,
    cut_version_ids: list[UUID],
    subtitle_style: SubtitleStyle,
) -> UUID:
    style_payload = subtitle_style.model_dump(mode="json")
    for variant in project.output_variants:
        if (
            variant.format == output_format
            and variant.preset_id == preset_id
            and variant.cut_version_ids == cut_version_ids
            and (variant.subtitle_style or SubtitleStyle().model_dump(mode="json")) == style_payload
        ):
            return variant.id

    provenance = ",".join(str(item) for item in cut_version_ids)
    style_key = json.dumps(style_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    key = f"{project.id}|{output_format}|{preset_id or ''}|{provenance}|{style_key}"
    return uuid5(_OUTPUT_VARIANT_NAMESPACE, key)


def _append_unique(values: list[UUID], value: UUID) -> None:
    if value not in values:
        values.append(value)

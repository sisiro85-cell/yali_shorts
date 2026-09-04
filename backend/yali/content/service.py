from __future__ import annotations

import json
from collections.abc import Awaitable, Mapping
from inspect import isawaitable
from typing import Any, Literal, Protocol
from uuid import UUID, uuid4

from pydantic import ValidationError

from yali.content.models import (
    CutPlanCut,
    CutPlanRequest,
    CutPlanResult,
    CutPlanScene,
    ScriptGenerationRequest,
    ScriptLine,
    ScriptVersion,
)
from yali.domain.commands import RegenerateOptions
from yali.domain.models import Cut, CutVersion, Scene
from yali.storage.project_store import CutLockedError


ContentOperation = Literal["generate_script", "generate_cut_plan"]


class ContentGateway(Protocol):
    def generate(
        self,
        operation: ContentOperation,
        context: dict[str, Any],
        model_name: str | None = None,
    ) -> object | Awaitable[object]: ...


class ContentGenerator(Protocol):
    async def generate_script(
        self,
        request: ScriptGenerationRequest,
        model_name: str | None = None,
    ) -> ScriptVersion: ...

    async def generate_cut_plan(
        self,
        request: CutPlanRequest,
        model_name: str | None = None,
    ) -> CutPlanResult: ...


class CutVersionNotFoundError(ValueError):
    """Raised when a requested historical cut version is not stored."""


class DeterministicContentService:
    """Generate structured content and fall back locally on provider failures."""

    def __init__(self, gateway: ContentGateway | None = None) -> None:
        self._gateway = gateway

    async def generate_script(
        self,
        request: ScriptGenerationRequest,
        model_name: str | None = None,
    ) -> ScriptVersion:
        context = request.model_dump(mode="json")
        raw = await self._safe_generate("generate_script", context, model_name)
        script = _parse_script(raw)
        return script if script is not None else _fallback_script(request)

    async def generate_cut_plan(
        self,
        request: CutPlanRequest,
        model_name: str | None = None,
    ) -> CutPlanResult:
        context = request.model_dump(mode="json")
        raw = await self._safe_generate("generate_cut_plan", context, model_name)
        plan = _parse_cut_plan(raw)
        return plan if plan is not None else _fallback_cut_plan(request.script)

    async def _safe_generate(
        self,
        operation: ContentOperation,
        context: dict[str, Any],
        model_name: str | None,
    ) -> object | None:
        if self._gateway is None:
            return None
        try:
            result = self._gateway.generate(operation, context, model_name)
            return await result if isawaitable(result) else result
        except Exception:
            # Provider exceptions can contain prompts or source text. Do not log or
            # propagate their message; the deterministic fallback remains usable.
            return None


def cut_plan_to_scenes(
    plan: CutPlanResult,
    *,
    source_script_version_id: UUID | None = None,
) -> list[Scene]:
    scenes: list[Scene] = []
    for planned_scene in plan.scenes:
        cuts: list[Cut] = []
        for planned_cut in planned_scene.cuts:
            version = CutVersion(
                visual_prompt=planned_cut.visual_prompt,
                narration_text=planned_cut.narration_text,
                subtitle=planned_cut.subtitle,
                motion_preset=planned_cut.motion_preset,
            )
            cuts.append(
                Cut(
                    id=planned_cut.id,
                    order=planned_cut.order,
                    title=planned_cut.title,
                    duration_ms=planned_cut.duration_ms,
                    visual_prompt=version.visual_prompt,
                    narration_text=version.narration_text,
                    subtitle=version.subtitle,
                    motion_preset=version.motion_preset,
                    versions=[version],
                    active_version_id=version.id,
                )
            )
        scenes.append(
            Scene(
                id=planned_scene.id,
                order=planned_scene.order,
                title=planned_scene.title,
                source_script_version_id=source_script_version_id,
                cuts=cuts,
            )
        )
    return scenes


def apply_cut_regeneration(cut: Cut, options: RegenerateOptions) -> Cut:
    if cut.locked:
        raise CutLockedError(f"Cut is locked: {cut.id}")

    base = next((version for version in cut.versions if version.id == cut.active_version_id), None)
    visual_prompt = _selected(options.visual_prompt, base.visual_prompt if base else cut.visual_prompt)
    narration_text = _selected(
        options.narration_text,
        base.narration_text if base else cut.narration_text,
    )
    subtitle = _selected(options.subtitle, base.subtitle if base else cut.subtitle)
    motion_preset = _selected(
        options.motion_preset,
        base.motion_preset if base else cut.motion_preset,
    )
    media_asset_id = (
        base.media_asset_id
        if base is not None and base.media_asset_id is not None
        else cut.media_asset_id
    )
    audio_asset_id = (
        base.audio_asset_id
        if base is not None and base.audio_asset_id is not None
        else cut.audio_asset_id
    )
    version = CutVersion(
        id=uuid4(),
        visual_prompt=visual_prompt,
        narration_text=narration_text,
        subtitle=subtitle,
        motion_preset=motion_preset,
        media_asset_id=media_asset_id,
        audio_asset_id=audio_asset_id,
    )
    cut.versions.append(version)
    cut.active_version_id = version.id
    cut.visual_prompt = version.visual_prompt
    cut.narration_text = version.narration_text
    cut.subtitle = version.subtitle
    cut.motion_preset = version.motion_preset
    cut.media_asset_id = version.media_asset_id
    cut.audio_asset_id = version.audio_asset_id
    cut.status = "draft"
    cut.error = None
    return cut


def activate_cut_version(cut: Cut, version_id: UUID) -> Cut:
    if cut.locked:
        raise CutLockedError(f"Cut is locked: {cut.id}")
    version = next((item for item in cut.versions if item.id == version_id), None)
    if version is None:
        raise CutVersionNotFoundError(f"Cut version not found: {version_id}")
    cut.active_version_id = version.id
    cut.visual_prompt = version.visual_prompt
    cut.narration_text = version.narration_text
    cut.subtitle = version.subtitle
    cut.motion_preset = version.motion_preset
    cut.media_asset_id = version.media_asset_id
    cut.audio_asset_id = version.audio_asset_id
    cut.status = "draft"
    cut.error = None
    return cut


def _selected(candidate: str | None, fallback: str) -> str:
    return candidate if candidate is not None else fallback


def _parse_script(raw: object) -> ScriptVersion | None:
    payload = _object_payload(raw)
    if payload is None:
        return None
    nested = payload.get("script")
    if isinstance(nested, Mapping):
        payload = dict(nested)
    normalized = dict(payload)
    lines = normalized.get("lines")
    if isinstance(lines, list):
        normalized["lines"] = [
            {**dict(line), "order": index}
            for index, line in enumerate(lines, start=1)
            if isinstance(line, Mapping)
        ]
    try:
        return ScriptVersion.model_validate(normalized)
    except (ValidationError, TypeError, ValueError):
        return None


def _parse_cut_plan(raw: object) -> CutPlanResult | None:
    payload = _object_payload(raw)
    if payload is None:
        return None
    nested = payload.get("cut_plan")
    if isinstance(nested, Mapping):
        payload = dict(nested)
    raw_scenes = payload.get("scenes")
    if not isinstance(raw_scenes, list):
        return None
    scenes: list[dict[str, Any]] = []
    for scene_index, raw_scene in enumerate(raw_scenes, start=1):
        if not isinstance(raw_scene, Mapping):
            continue
        scene = dict(raw_scene)
        scene["order"] = scene_index
        raw_cuts = scene.get("cuts")
        if isinstance(raw_cuts, list):
            scene["cuts"] = [
                {**dict(cut), "order": cut_index}
                for cut_index, cut in enumerate(raw_cuts, start=1)
                if isinstance(cut, Mapping)
            ]
        scenes.append(scene)
    try:
        return CutPlanResult.model_validate({"scenes": scenes})
    except (ValidationError, TypeError, ValueError):
        return None


def _object_payload(raw: object) -> dict[str, Any] | None:
    if isinstance(raw, Mapping):
        return dict(raw)
    if hasattr(raw, "data") and isinstance(getattr(raw, "data"), Mapping):
        return dict(getattr(raw, "data"))
    if hasattr(raw, "text"):
        raw = getattr(raw, "text")
    if not isinstance(raw, str):
        return None
    candidate = raw.strip()
    if candidate.startswith("```") and candidate.endswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3:
            candidate = "\n".join(lines[1:-1]).strip()
    try:
        payload = json.loads(candidate)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    return dict(payload) if isinstance(payload, Mapping) else None


def _fallback_script(request: ScriptGenerationRequest) -> ScriptVersion:
    body = request.summary
    cta = "저장하고 오늘 한 가지부터 적용해 보세요."
    texts = [request.headline, *request.key_points]
    if not request.key_points:
        texts.append(body)
    texts.append(cta)
    lines = [
        ScriptLine(
            order=index,
            text=text,
            duration_ms=_duration_for(text),
            scene_intent=f"{index}번째 핵심 메시지 전달",
        )
        for index, text in enumerate(texts, start=1)
    ]
    return ScriptVersion(
        hook=request.headline,
        body=body,
        cta=cta,
        lines=lines,
    )


def _fallback_cut_plan(script: ScriptVersion) -> CutPlanResult:
    scenes: list[CutPlanScene] = []
    for scene_index, offset in enumerate(range(0, len(script.lines), 2), start=1):
        grouped_lines = script.lines[offset : offset + 2]
        scene_title = f"씬 {scene_index}"
        cuts = [
            CutPlanCut(
                order=cut_index,
                title=_short_title(line.text),
                duration_ms=line.duration_ms,
                visual_prompt=f"{scene_title}, {line.text}",
                narration_text=line.text,
                subtitle=line.text,
                motion_preset="static",
            )
            for cut_index, line in enumerate(grouped_lines, start=1)
        ]
        scenes.append(CutPlanScene(order=scene_index, title=scene_title, cuts=cuts))
    return CutPlanResult(scenes=scenes)


def _duration_for(text: str) -> int:
    return max(800, min(5_000, len(text) * 90))


def _short_title(text: str) -> str:
    normalized = " ".join(text.split())
    return normalized[:80]

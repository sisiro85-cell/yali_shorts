import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompositionWorkspace, normalizeRenderTimeoutMs, renderManifest } from "./renderer.js";
import type { RenderManifest } from "./types.js";

const manifest: RenderManifest = {
  schema_version: "1.0",
  renderer: "hyperframes",
  project_id: "project-1",
  output_variant_id: "variant-1",
  created_at: "2026-09-03T00:00:00Z",
  output_format: "shorts",
  preset_id: null,
  source_asset_id: null,
  source_asset_hash: null,
  source_idea_version_id: null,
  source_script_version_id: null,
  cut_version_ids: ["cut-version-1"],
  assets: [
    {
      asset_id: "asset-1",
      filename: "source.png",
      relative_path: "assets/source.png",
      media_type: "image",
      width: 100,
      height: 100,
      color_profile: null,
      content_hash: null,
      preserve_original: true,
      filters: [],
    },
  ],
  cuts: [
    {
      scene_id: "scene-1",
      scene_order: 1,
      cut_id: "cut-1",
      cut_order: 1,
      cut_version_id: "cut-version-1",
      title: "미디어 대기",
      media_asset_id: "asset-1",
      audio_asset_id: null,
      visual_prompt: "",
      narration: "",
      subtitle: "",
      subtitle_style: {
        position: "bottom",
        font_family: "Pretendard",
        font_size: 60,
        color: "#FFFFFF",
        outline_color: "#111111",
        outline_width: 2,
        background_color: null,
        custom_x: 50,
        custom_y: 82,
      },
      motion_preset: "static",
      duration_ms: 1_000,
    },
  ],
  settings: {
    width: 1080,
    height: 1920,
    fps: 30,
    pixel_format: "yuv420p",
    video_codec: "h264",
    audio_codec: "aac",
  },
};

test("renderer rejects output paths outside the project outputs directory", async () => {
  await assert.rejects(
    renderManifest(manifest, { projectRoot: process.cwd(), outputPath: "../outside.mp4", format: "mp4" }),
    /outputs directory/,
  );
});

test("renderer rejects source assets outside the project assets directory", async () => {
  const invalid = {
    ...manifest,
    assets: [
      {
        asset_id: "asset-1",
        filename: "secret.png",
        relative_path: "../secret.png",
        media_type: "image" as const,
        width: 100,
        height: 100,
        color_profile: null,
        content_hash: null,
        preserve_original: true,
        filters: [],
      },
    ],
  };

  await assert.rejects(
    renderManifest(invalid, { projectRoot: process.cwd(), outputPath: "outputs/result.mp4", format: "mp4" }),
    /assets directory/,
  );
});

test("concurrent renders receive isolated composition workspaces", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "yali-render-worker-"));
  try {
    const [first, second] = await Promise.all([
      createCompositionWorkspace(projectRoot, manifest.output_variant_id),
      createCompositionWorkspace(projectRoot, manifest.output_variant_id),
    ]);
    assert.notEqual(first, second);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("render timeout is bounded and has a ten minute default", () => {
  assert.equal(normalizeRenderTimeoutMs(undefined), 600_000);
  assert.equal(normalizeRenderTimeoutMs("100"), 1_000);
  assert.equal(normalizeRenderTimeoutMs("99999999"), 1_800_000);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertRenderManifest, createCompositionHtml } from "./composition.js";
import type { RenderManifest } from "./types.js";

export const manifest: RenderManifest = {
  schema_version: "1.0",
  renderer: "hyperframes",
  project_id: "project-1",
  output_variant_id: "variant-1",
  created_at: "2026-09-03T00:00:00Z",
  output_format: "shorts",
  preset_id: "warm-editorial",
  source_asset_id: "asset-1",
  source_asset_hash: "sha256:source",
  source_idea_version_id: null,
  source_script_version_id: "script-1",
  cut_version_ids: ["cut-version-1", "cut-version-2"],
  assets: [
    {
      asset_id: "asset-1",
      filename: "도시 원본.png",
      relative_path: "assets/source.png",
      media_type: "image",
      width: 1080,
      height: 1920,
      color_profile: "Display P3",
      content_hash: "sha256:source",
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
      title: "도입",
      media_asset_id: "asset-1",
      audio_asset_id: null,
      visual_prompt: "도시의 아침",
      narration: "오늘의 핵심입니다.",
      subtitle: "오늘의 핵심",
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
      motion_preset: "slow_zoom",
      duration_ms: 1_000,
    },
    {
      scene_id: "scene-1",
      scene_order: 1,
      cut_id: "cut-2",
      cut_order: 2,
      cut_version_id: "cut-version-2",
      title: "전환",
      media_asset_id: "asset-1",
      audio_asset_id: null,
      visual_prompt: "도시의 변화",
      narration: "다음 장면입니다.",
      subtitle: "다음 장면",
      subtitle_style: {
        position: "top",
        font_family: "Pretendard",
        font_size: 56,
        color: "#FFFFFF",
        outline_color: "#111111",
        outline_width: 2,
        background_color: null,
        custom_x: 50,
        custom_y: 82,
      },
      motion_preset: "static",
      duration_ms: 250,
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

test("composition keeps original media color and cut timing explicit", () => {
  const html = createCompositionHtml(manifest, { assetPrefix: "../../" });

  assert.match(html, /data-composition-id="yali-main"/);
  assert.match(html, /src="\.\.\/\.\.\/assets\/source\.png"/);
  assert.match(html, /filter: none/);
  assert.doesNotMatch(html, /grayscale|sepia/);
  assert.match(html, /data-start="0\.000" data-duration="1\.000" data-track-index="0"/);
  assert.match(html, /class="cut-scrim clip" data-start="0\.000" data-duration="1\.000" data-track-index="1"/);
  assert.match(html, /data-start="1\.000" data-duration="0\.250" data-track-index="0"/);
  assert.match(html, /fromTo\("#cut-cut-2 \.source-media"/);
  assert.match(html, /id="transition-0"/);
  assert.match(html, /timeline\.duration\(\"?1\.250/);
});

test("composition rejects a cut shorter than the renderer minimum", () => {
  const invalid = {
    ...manifest,
    cuts: [{ ...manifest.cuts[0], duration_ms: 100 }],
  };

  assert.throws(() => assertRenderManifest(invalid), /duration is invalid/);
});

test("composition schedules cut audio as a timed leaf without applying media filters", () => {
  const audioManifest: RenderManifest = {
    ...manifest,
    assets: [
      ...manifest.assets,
      {
        asset_id: "audio-1",
        filename: "narration.mp3",
        relative_path: "assets/narration.mp3",
        media_type: "audio",
        width: null,
        height: null,
        color_profile: null,
        content_hash: null,
        preserve_original: true,
        filters: [],
      },
    ],
    cuts: [{ ...manifest.cuts[0], audio_asset_id: "audio-1" }],
  };

  const html = createCompositionHtml(audioManifest, { assetPrefix: "../../" });

  assert.match(html, /class="source-audio clip" data-start="0\.000" data-duration="1\.000" data-track-index="3"/);
  assert.match(html, /src="\.\.\/\.\.\/assets\/narration\.mp3"/);
});

test("composition rejects a cut that references a non-audio asset as audio", () => {
  const invalid = {
    ...manifest,
    cuts: [{ ...manifest.cuts[0], audio_asset_id: "asset-1" }],
  };

  assert.throws(() => assertRenderManifest(invalid), /audio asset/);
});

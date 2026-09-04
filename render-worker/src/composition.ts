import type { RenderAsset, RenderCut, RenderManifest, SubtitleStyle } from "./types.js";

export type CompositionOptions = {
  assetPrefix?: string;
};

const BACKGROUND = "#F4F1EB";
const SURFACE = "#FFFEFB";
const TEXT = "#252421";
const SECONDARY = "#5A554E";
const ACCENT = "#817568";

export function assertRenderManifest(value: unknown): asserts value is RenderManifest {
  if (!value || typeof value !== "object") throw new Error("Render manifest must be an object");
  const manifest = value as Partial<RenderManifest>;
  if (manifest.schema_version !== "1.0" || manifest.renderer !== "hyperframes") {
    throw new Error("Unsupported render manifest");
  }
  if (!manifest.settings || !Array.isArray(manifest.cuts) || manifest.cuts.length === 0) {
    throw new Error("Render manifest must contain settings and at least one cut");
  }
  if (!Array.isArray(manifest.assets)) throw new Error("Render manifest assets are invalid");
  const assetsById = new Map(manifest.assets.map((asset) => [asset.asset_id, asset]));
  if (manifest.cuts.some((cut) => {
    const asset = cut.media_asset_id ? assetsById.get(cut.media_asset_id) : undefined;
    return !asset || !["image", "video"].includes(asset.media_type);
  })) {
    throw new Error("Every render cut must reference an image or video asset");
  }
  if (manifest.cuts.some((cut) => {
    const asset = cut.audio_asset_id ? assetsById.get(cut.audio_asset_id) : undefined;
    return cut.audio_asset_id !== null && (!asset || asset.media_type !== "audio");
  })) {
    throw new Error("Every render cut audio reference must reference an audio asset");
  }
  if (manifest.cuts.some((cut) => !Number.isInteger(cut.duration_ms) || cut.duration_ms < 250)) {
    throw new Error("Render cut duration is invalid");
  }
}

export function createCompositionHtml(manifest: RenderManifest, options: CompositionOptions = {}): string {
  assertRenderManifest(manifest);
  const assetPrefix = options.assetPrefix ?? "";
  const assetById = new Map(manifest.assets.map((asset) => [asset.asset_id, asset]));
  let startMs = 0;
  const clips = manifest.cuts.map((cut, index) => {
    const start = startMs;
    startMs += cut.duration_ms;
    return renderCut(
      cut,
      index,
      start,
      assetById.get(cut.media_asset_id ?? ""),
      assetById.get(cut.audio_asset_id ?? ""),
      assetPrefix,
    );
  });
  const transitions = manifest.cuts.slice(0, -1).map((cut, index) => {
    const transitionStart = manifest.cuts
      .slice(0, index + 1)
      .reduce((total, item) => total + item.duration_ms, 0);
    return renderTransition(index, transitionStart);
  });
  const durationSeconds = (startMs / 1000).toFixed(3);

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=${manifest.settings.width}, height=${manifest.settings.height}" />
    <title>Yali Short-form Studio render</title>
  </head>
  <body>
    <div id="yali-root" data-composition-id="yali-main" data-width="${manifest.settings.width}" data-height="${manifest.settings.height}" data-duration="${durationSeconds}">
      <div class="composition-background"></div>
      ${clips.join("\n")}
      ${transitions.join("\n")}
    </div>
    <style>${styles(manifest)}</style>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const timeline = gsap.timeline({ paused: true });
      ${timelineCode(manifest)}
      window.__timelines["yali-main"] = timeline;
    </script>
  </body>
</html>`;
}

function renderCut(
  cut: RenderCut,
  index: number,
  startMs: number,
  asset: RenderAsset | undefined,
  audioAsset: RenderAsset | undefined,
  assetPrefix: string,
): string {
  const start = (startMs / 1000).toFixed(3);
  const duration = (cut.duration_ms / 1000).toFixed(3);
  const timing = `data-start="${start}" data-duration="${duration}"`;
  const media = asset
    ? renderMedia(asset, assetPrefix, start, duration, cut.cut_id)
    : `<div class="media-missing" data-start="${start}" data-duration="${duration}" data-track-index="0">원본 미디어를 선택해 주세요.</div>`;
  const audio = audioAsset ? renderAudio(audioAsset, assetPrefix, start, duration, cut.cut_id) : "";
  const subtitle = cut.subtitle ? `<p id="subtitle-${index}" class="subtitle" style="${subtitleStyle(cut.subtitle_style)}">${escapeHtml(cut.subtitle)}</p>` : "";
  return `<section id="cut-${escapeHtml(cut.cut_id)}" class="cut">
    <div class="cut-media">${media}</div>
    <div id="scrim-${escapeHtml(cut.cut_id)}" class="cut-scrim clip" ${timing} data-track-index="1"></div>
    <div id="content-${escapeHtml(cut.cut_id)}" class="cut-content clip" data-start="${start}" data-duration="${duration}" data-track-index="2" data-layout-allow-overflow="true">
      <p class="cut-kicker">${escapeHtml(cut.title)}</p>
      ${subtitle}
    </div>
    ${audio}
  </section>`;
}

function renderMedia(asset: RenderAsset, assetPrefix: string, start: string, duration: string, cutId: string): string {
  const source = escapeHtml(`${assetPrefix}${asset.relative_path.replaceAll("\\", "/")}`);
  const timing = `data-start="${start}" data-duration="${duration}" data-track-index="0"`;
  if (asset.media_type === "video") {
    return `<video id="media-${escapeHtml(cutId)}" class="source-media clip" ${timing} data-layout-allow-overflow="true" src="${source}" muted playsinline crossorigin="anonymous"></video>`;
  }
  if (asset.media_type === "image") {
    return `<img id="media-${escapeHtml(cutId)}" class="source-media clip" ${timing} data-layout-allow-overflow="true" src="${source}" alt="${escapeHtml(asset.filename)}" crossorigin="anonymous" />`;
  }
  return `<div class="media-missing">${escapeHtml(asset.filename)}는 영상 미디어가 아닙니다.</div>`;
}

function renderAudio(asset: RenderAsset, assetPrefix: string, start: string, duration: string, cutId: string): string {
  const source = escapeHtml(`${assetPrefix}${asset.relative_path.replaceAll("\\", "/")}`);
  return `<audio id="audio-${escapeHtml(cutId)}" class="source-audio clip" data-start="${start}" data-duration="${duration}" data-track-index="3" src="${source}" preload="auto"></audio>`;
}

function renderTransition(index: number, startMs: number): string {
  const start = (startMs / 1000).toFixed(3);
  return `<div id="transition-${index}" class="transition-layer clip" data-start="${start}" data-duration="0.520" data-track-index="4" aria-hidden="true"></div>`;
}

function timelineCode(manifest: RenderManifest): string {
  let startMs = 0;
  const entries: string[] = [];
  manifest.cuts.forEach((cut, index) => {
    const start = (startMs / 1000).toFixed(3);
    entries.push(`timeline.from("#cut-${escapeJs(cut.cut_id)} .cut-content", { y: 28, opacity: 0, duration: 0.48, ease: "power3.out" }, ${start});`);
    const motion = motionValues(cut.motion_preset);
    entries.push(`timeline.fromTo("#cut-${escapeJs(cut.cut_id)} .source-media", ${JSON.stringify(motion.from)}, ${JSON.stringify(motion.to)}, ${start});`);
    if (cut.subtitle) entries.push(`timeline.from("#subtitle-${index}", { y: 20, opacity: 0, duration: 0.36, ease: "power2.out" }, ${(startMs / 1000 + 0.14).toFixed(3)});`);
    if (index < manifest.cuts.length - 1) {
      const transitionAt = Math.max(startMs / 1000, startMs / 1000 + cut.duration_ms / 1000 - 0.26);
      entries.push(`timeline.fromTo("#transition-${index}", { xPercent: -100 }, { xPercent: 0, duration: 0.52, ease: "power2.inOut" }, ${transitionAt.toFixed(3)});`);
    }
    startMs += cut.duration_ms;
  });
  return `timeline.duration(${(startMs / 1000).toFixed(3)});\n${entries.join("\n")}`;
}

type MotionValues = {
  from: Record<string, number>;
  to: Record<string, number>;
};

function motionValues(preset: string): MotionValues {
  const normalized = preset.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  const base = { opacity: 0, duration: 0.56 };
  switch (normalized) {
    case "slow_zoom":
      return { from: { ...base, scale: 1.02 }, to: { opacity: 1, scale: 1.08, duration: 0.56 } };
    case "pan_left":
      return { from: { ...base, x: 28, scale: 1.04 }, to: { opacity: 1, x: -18, scale: 1.04, duration: 0.56 } };
    case "pan_right":
      return { from: { ...base, x: -28, scale: 1.04 }, to: { opacity: 1, x: 18, scale: 1.04, duration: 0.56 } };
    case "slide_up":
      return { from: { ...base, y: 32, scale: 1.02 }, to: { opacity: 1, y: -8, scale: 1.02, duration: 0.56 } };
    case "slide_down":
      return { from: { ...base, y: -32, scale: 1.02 }, to: { opacity: 1, y: 8, scale: 1.02, duration: 0.56 } };
    case "hyper_frame":
    case "hyperframe":
      return { from: { ...base, scale: 1.06 }, to: { opacity: 1, scale: 1.01, duration: 0.56 } };
    default:
      return { from: { ...base, scale: 1 }, to: { opacity: 1, scale: 1, duration: 0.56 } };
  }
}

function subtitleStyle(style: SubtitleStyle): string {
  const position = style.position === "top" ? "top: 8%;" : style.position === "center" ? "top: 50%;" : style.position === "custom" ? `left: ${style.custom_x}%; top: ${style.custom_y}%;` : "bottom: 8%;";
  const transform = style.position === "center" || style.position === "custom" ? "transform: translate(-50%, -50%);" : "transform: translateX(-50%);";
  const background = style.background_color ? `background: ${escapeHtml(style.background_color)};` : "";
  return `left: 50%; ${position} ${transform} font-family: ${escapeHtml(style.font_family)}; font-size: ${style.font_size}px; color: ${escapeHtml(style.color)}; -webkit-text-stroke: ${style.outline_width}px ${escapeHtml(style.outline_color)}; ${background}`;
}

function styles(manifest: RenderManifest): string {
  const { width, height } = manifest.settings;
  const fontFaces = [
    "Pretendard",
    ...manifest.cuts.map((cut) => cut.subtitle_style.font_family),
  ]
    .filter((font, index, fonts) => font.trim() && fonts.indexOf(font) === index)
    .map((font) => `@font-face { font-family: "${escapeCssString(font)}"; src: local("${escapeCssString(font)}"); }`)
    .join("\n");
  return `
    * { box-sizing: border-box; }
    ${fontFaces}
    html, body { width: ${width}px; height: ${height}px; margin: 0; overflow: hidden; background: ${BACKGROUND}; }
    body { font-family: Pretendard, sans-serif; color: ${TEXT}; }
    [data-composition-id="yali-main"] { position: relative; width: 100%; height: 100%; background: ${BACKGROUND}; overflow: hidden; }
    .composition-background { position: absolute; inset: 0; background: ${SURFACE}; }
    .cut { position: absolute; inset: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
    .cut-media, .cut-scrim { position: absolute; inset: 0; width: 100%; height: 100%; }
    .source-media { display: block; width: 100%; height: 100%; object-fit: contain; filter: none; opacity: 1; }
    .source-audio { display: none; }
    .cut-scrim { background: linear-gradient(180deg, rgba(37,36,33,0.04), rgba(37,36,33,0.40)); pointer-events: none; }
    .cut-content { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 96px 72px 180px; gap: 24px; }
    .cut-kicker { margin: 0; color: ${SECONDARY}; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
    .subtitle { position: absolute; max-width: 88%; margin: 0; padding: 12px 22px; font-weight: 700; line-height: 1.35; text-align: center; white-space: pre-wrap; }
    .transition-layer { position: absolute; inset: 0; background: ${ACCENT}; transform: translateX(-100%); pointer-events: none; }
    .media-missing { display: grid; place-items: center; width: 100%; height: 100%; padding: 72px; color: ${SECONDARY}; background: ${BACKGROUND}; font-size: 26px; text-align: center; }
  `;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeJs(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeCssString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\'", "\\\'").replace(/[\r\n]/g, " ");
}

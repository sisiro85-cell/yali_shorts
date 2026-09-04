export type OutputFormat = "shorts" | "reels" | "card_news";

export type SubtitleStyle = {
  position: "top" | "center" | "bottom" | "custom";
  font_family: string;
  font_size: number;
  color: string;
  outline_color: string;
  outline_width: number;
  background_color: string | null;
  custom_x: number;
  custom_y: number;
};

export type RenderSettings = {
  width: number;
  height: number;
  fps: number;
  pixel_format: string;
  video_codec: string;
  audio_codec: string;
};

export type RenderAsset = {
  asset_id: string;
  filename: string;
  relative_path: string;
  media_type: "image" | "video" | "audio" | "other";
  width: number | null;
  height: number | null;
  color_profile: string | null;
  content_hash: string | null;
  preserve_original: boolean;
  filters: string[];
};

export type RenderCut = {
  scene_id: string;
  scene_order: number;
  cut_id: string;
  cut_order: number;
  cut_version_id: string;
  title: string;
  media_asset_id: string | null;
  audio_asset_id: string | null;
  visual_prompt: string;
  narration: string;
  subtitle: string;
  subtitle_style: SubtitleStyle;
  motion_preset: string;
  duration_ms: number;
};

export type RenderManifest = {
  schema_version: "1.0";
  renderer: "hyperframes";
  project_id: string;
  output_variant_id: string;
  created_at: string;
  output_format: OutputFormat;
  preset_id: string | null;
  source_asset_id: string | null;
  source_asset_hash: string | null;
  source_idea_version_id: string | null;
  source_script_version_id: string | null;
  cut_version_ids: string[];
  assets: RenderAsset[];
  cuts: RenderCut[];
  settings: RenderSettings;
};

export type RenderOptions = {
  projectRoot: string;
  outputPath: string;
  quality?: "draft" | "standard" | "high";
  format?: "mp4" | "webm";
};

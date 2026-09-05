export type WorkflowStage = "idea" | "script" | "cuts" | "design" | "output" | "completed" | "failed";
export type IdeaFormat = "shorts" | "reels" | "card_news";
export type ImageAspectRatio = "9:16" | "1:1";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type IdeaGenerationStatus = JobStatus | "idle";

export interface ProjectPreviewMedia {
  url: string;
  media_type: "image" | "video";
  width: number;
  height: number;
  alt?: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: WorkflowStage;
  stage: WorkflowStage;
  scene_count: number;
  cut_count: number;
  progress: number;
  updated_at: string;
  preview_media?: ProjectPreviewMedia | null;
}

export interface JobSummary {
  id: string;
  project_id: string;
  cut_id: string | null;
  kind: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  retry_count: number;
}

export interface JobAccepted {
  job_id: string;
  cut_id?: string | null;
  status: JobStatus;
}

export interface IdeaDraft {
  topic: string;
  source_text: string;
  formats: IdeaFormat[];
  reference_asset_ids: string[];
  updated_at: string;
}

export interface IdeaReferenceAsset {
  id: string;
  filename: string;
  media_type: "image" | "video" | "audio" | "other";
  created_at: string;
  preview_media?: ProjectPreviewMedia | null;
}

export interface IdeaVersion {
  id: string;
  headline: string;
  summary: string;
  key_points: string[];
  created_at: string;
}

export interface IdeaPageData {
  project_id: string;
  project_title: string;
  stage: WorkflowStage;
  draft: IdeaDraft;
  reference_assets: IdeaReferenceAsset[];
  generation_status?: IdeaGenerationStatus;
  generation_error?: string | null;
  generation_job?: JobSummary | null;
  active_version?: IdeaVersion | null;
}

export interface ScriptLine {
  id: string;
  order: number;
  speaker: string;
  text: string;
  duration_ms: number;
  scene_intent?: string | null;
}

export interface ScriptVersion {
  id: string;
  created_at: string;
  source_idea_version_id?: string | null;
  hook: string;
  body: string;
  cta: string;
  lines: ScriptLine[];
}

export type ScriptVersionDraft = Pick<ScriptVersion, "hook" | "body" | "cta" | "lines">;

export interface ScriptPageData {
  project_id: string;
  project_title: string;
  stage: WorkflowStage;
  source_idea_id?: string | null;
  active_version?: ScriptVersion | null;
  versions: ScriptVersion[];
}

export interface CutVersion {
  id: string;
  created_at: string;
  visual_prompt: string;
  narration_text: string;
  subtitle: string;
  motion_preset: string;
  media_asset_id: string | null;
  audio_asset_id: string | null;
}

export type CutStatus = "draft" | "generating" | "ready" | "failed";

export interface CutBoardCut {
  id: string;
  order: number;
  title: string;
  duration_ms: number;
  visual_prompt: string;
  media_asset_id: string | null;
  media_width?: number | null;
  media_height?: number | null;
  audio_asset_id: string | null;
  narration_text: string;
  subtitle: string;
  motion_preset: string;
  locked: boolean;
  status: CutStatus;
  error: string | null;
  active_version_id: string | null;
  video_settings_overrides?: VideoSettingsPatch;
  versions: CutVersion[];
}

export type CutRegenerationOptions = Partial<Pick<CutBoardCut, "visual_prompt" | "narration_text" | "subtitle" | "motion_preset">> & {
  image_only?: boolean;
};

export interface CutLockResponse {
  cut_id: string;
  locked: boolean;
}

export interface CutBoardScene {
  id: string;
  order: number;
  title: string;
  source_script_version_id: string | null;
  cuts: CutBoardCut[];
}

export interface CutBoardData {
  project_id: string;
  project_title: string;
  stage: WorkflowStage;
  script_version_id: string | null;
  target_aspect_ratio?: ImageAspectRatio;
  stale: boolean;
  scenes: CutBoardScene[];
}

export type TTSProvider = "edge_tts" | "azure_speech" | "elevenlabs" | "upload";
export type SubtitlePosition = "top" | "center" | "bottom" | "custom";
export type SubtitleAlignment = "left" | "center" | "right";

export interface TTSSettings {
  enabled: boolean;
  provider: TTSProvider;
  language: string;
  voice_id: string;
  speed: number;
  volume: number;
  pitch: number;
}

export interface SubtitleStyle {
  position: SubtitlePosition;
  font_family: string;
  font_size: number;
  color: string;
  outline_color: string;
  outline_width: number;
  background_color: string | null;
  custom_x: number;
  custom_y: number;
  alignment: SubtitleAlignment;
  max_lines: number;
  safe_area: boolean;
}

export interface SubtitleSettings {
  enabled: boolean;
  style: SubtitleStyle;
}

export interface ProjectVideoSettings {
  audio: TTSSettings;
  subtitle: SubtitleSettings;
}

export interface VideoSettingsPatch {
  audio?: Partial<TTSSettings>;
  subtitle?: {
    enabled?: boolean;
    style?: Partial<SubtitleStyle>;
  };
}

export interface ApiErrorDetails {
  errors?: Array<{ loc: Array<string | number>; msg: string; type: string; input?: unknown }>;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = "HTTP_ERROR",
    public readonly details: ApiErrorDetails = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api";

export function resolveMediaUrl(url: string): string {
  try {
    new URL(url);
    return url;
  } catch {
    const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const apiUrl = new URL(apiBaseUrl, origin);
    return new URL(url, url.startsWith("/") ? apiUrl.origin : `${apiUrl.toString().replace(/\/?$/, "/")}`).toString();
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }
  return response.json() as Promise<T>;
}

async function requestFile<T>(path: string, file: File): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response.json() as Promise<T>;
}

async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let payload: { code?: string; message?: string; details?: ApiErrorDetails } | null = null;
  try {
    payload = (await response.json()) as { code?: string; message?: string; details?: ApiErrorDetails };
  } catch {
    payload = null;
  }
  return new ApiError(
    response.status,
    payload?.message ?? "요청을 처리하지 못했습니다.",
    payload?.code ?? "HTTP_ERROR",
    payload?.details ?? {},
  );
}

export const apiClient = {
  async listProjects(): Promise<ProjectSummary[]> {
    return (await requestJson<{ projects: ProjectSummary[] }>("/projects")).projects;
  },
  async createProject(title: string): Promise<{ id: string; title: string; stage: WorkflowStage }> {
    return requestJson("/projects", { method: "POST", body: JSON.stringify({ title }) });
  },
  async deleteProject(projectId: string): Promise<{ id: string; deleted: boolean }> {
    return requestJson(`/projects/${projectId}`, { method: "DELETE" });
  },
  async updateProject(projectId: string, patch: Partial<Pick<ProjectSummary, "title" | "stage" | "status">>) {
    return requestJson<ProjectSummary>(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async listJobs(projectId?: string): Promise<JobSummary[]> {
    const query = projectId ? `?project_id=${projectId}` : "";
    return (await requestJson<{ jobs: JobSummary[] }>(`/jobs${query}`)).jobs;
  },
  async getJob(jobId: string): Promise<JobSummary> {
    return requestJson<JobSummary>(`/jobs/${jobId}`);
  },
  async getIdeaPage(projectId: string): Promise<IdeaPageData> {
    return requestJson(`/projects/${projectId}/ideas`);
  },
  async getScriptPage(projectId: string): Promise<ScriptPageData> {
    return requestJson(`/projects/${projectId}/script`);
  },
  async generateScript(projectId: string, modelName?: string): Promise<ScriptPageData> {
    return requestJson(`/projects/${projectId}/script/generate`, {
      method: "POST",
      body: JSON.stringify(modelName ? { model_name: modelName } : {}),
    });
  },
  async updateScriptVersion(projectId: string, versionId: string, draft: ScriptVersionDraft): Promise<ScriptPageData> {
    return requestJson(`/projects/${projectId}/script/versions/${versionId}`, {
      method: "PATCH",
      body: JSON.stringify(draft),
    });
  },
  async activateScriptVersion(projectId: string, versionId: string): Promise<ScriptPageData> {
    return requestJson(`/projects/${projectId}/script/versions/${versionId}/activate`, {
      method: "POST",
    });
  },
  async getCutBoard(projectId: string): Promise<CutBoardData> {
    return requestJson(`/projects/${projectId}/cuts`);
  },
  async getVideoSettings(projectId: string): Promise<ProjectVideoSettings> {
    return requestJson(`/projects/${projectId}/video-settings`);
  },
  async updateVideoSettings(projectId: string, patch: VideoSettingsPatch): Promise<ProjectVideoSettings> {
    return requestJson(`/projects/${projectId}/video-settings`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  async updateCutVideoSettings(projectId: string, cutId: string, patch: VideoSettingsPatch): Promise<CutBoardCut> {
    return requestJson(`/projects/${projectId}/cuts/${cutId}/video-settings`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },
  async generateCuts(projectId: string, modelName?: string): Promise<CutBoardData> {
    return requestJson(`/projects/${projectId}/cuts/generate`, {
      method: "POST",
      body: JSON.stringify(modelName ? { model_name: modelName } : {}),
    });
  },
  async regenerateCut(projectId: string, cutId: string, options: CutRegenerationOptions = {}): Promise<JobAccepted> {
    return requestJson(`/projects/${projectId}/cuts/${cutId}/regenerate`, {
      method: "POST",
      headers: { "Idempotency-Key": createIdempotencyKey("cut") },
      body: JSON.stringify(options),
    });
  },
  async previewTTS(projectId: string, cutId: string): Promise<JobAccepted> {
    return requestJson(`/projects/${projectId}/tts/preview`, {
      method: "POST",
      headers: { "Idempotency-Key": createIdempotencyKey("tts-preview") },
      body: JSON.stringify({ cut_id: cutId }),
    });
  },
  async generateTTS(projectId: string, cutId: string): Promise<JobAccepted> {
    return requestJson(`/projects/${projectId}/tts/generate`, {
      method: "POST",
      headers: { "Idempotency-Key": createIdempotencyKey("tts") },
      body: JSON.stringify({ cut_id: cutId }),
    });
  },
  async lockCut(projectId: string, cutId: string): Promise<CutLockResponse> {
    return requestJson(`/projects/${projectId}/cuts/${cutId}/lock`, { method: "POST" });
  },
  async unlockCut(projectId: string, cutId: string): Promise<CutLockResponse> {
    return requestJson(`/projects/${projectId}/cuts/${cutId}/unlock`, { method: "POST" });
  },
  async activateCutVersion(projectId: string, cutId: string, versionId: string): Promise<CutBoardCut> {
    return requestJson(`/projects/${projectId}/cuts/${cutId}/versions/${versionId}/activate`, { method: "POST" });
  },
  async saveIdeaDraft(projectId: string, draft: Pick<IdeaDraft, "topic" | "source_text" | "formats" | "reference_asset_ids">) {
    return requestJson<IdeaPageData>(`/projects/${projectId}/ideas/draft`, {
      method: "PATCH",
      body: JSON.stringify(draft),
    });
  },
  async uploadIdeaReferenceAsset(projectId: string, file: File) {
    const filename = encodeURIComponent(file.name);
    return requestFile<IdeaPageData>(`/projects/${projectId}/ideas/assets?filename=${filename}`, file);
  },
  async generateIdea(
    projectId: string,
    draft: Pick<IdeaDraft, "topic" | "source_text" | "formats" | "reference_asset_ids">,
    idempotencyKey = createIdempotencyKey(),
  ) {
    return requestJson<{ job_id: string; status: JobStatus }>(`/projects/${projectId}/ideas/generate`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(draft),
    });
  },
  async cancelIdeaGeneration(projectId: string, jobId: string) {
    return requestJson<JobSummary>(`/projects/${projectId}/ideas/jobs/${jobId}/cancel`, {
      method: "POST",
    });
  },
};

function createIdempotencyKey(prefix = "idea"): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, FloppyDisk, Image as ImageIcon, Sparkle } from "@phosphor-icons/react";
import {
  apiClient,
  resolveMediaUrl,
  type CutBoardCut,
  type CutBoardData,
  type ProjectVideoSettings,
  type SubtitlePosition,
  type SubtitleStyle,
  type TTSProvider,
  type TTSSettings,
  type VideoSettingsPatch,
  type WorkflowStage,
} from "../app/api";
import { navigateTo, projectStagePath } from "../app/navigation";
import { AppShell } from "../components/layout/AppShell";
import "../features/video-settings/video-settings.css";

const TTS_PROVIDER_LABELS: Record<TTSProvider, string> = {
  edge_tts: "Edge TTS · 무료",
  azure_speech: "Azure Speech · 연결 예정",
  elevenlabs: "ElevenLabs · 연결 예정",
  upload: "오디오 파일 직접 사용",
};

const VOICE_OPTIONS = [
  { value: "ko-KR-SunHiNeural", label: "ko-KR-SunHiNeural · 여성" },
  { value: "ko-KR-InJoonNeural", label: "ko-KR-InJoonNeural · 남성" },
  { value: "en-US-AriaNeural", label: "en-US-AriaNeural · 여성" },
];

const FONT_OPTIONS = ["Pretendard", "Noto Sans KR", "나눔고딕", "Arial"];
const POSITION_OPTIONS: Array<{ value: SubtitlePosition; label: string }> = [
  { value: "top", label: "상단" },
  { value: "center", label: "중앙" },
  { value: "bottom", label: "하단" },
  { value: "custom", label: "사용자 지정" },
];

const AUDIO_SETTING_FIELDS: Array<keyof TTSSettings> = [
  "enabled",
  "provider",
  "language",
  "voice_id",
  "speed",
  "volume",
  "pitch",
];

const SUBTITLE_STYLE_FIELDS: Array<keyof SubtitleStyle> = [
  "position",
  "font_family",
  "font_size",
  "color",
  "outline_color",
  "outline_width",
  "background_color",
  "custom_x",
  "custom_y",
  "alignment",
  "max_lines",
  "safe_area",
];

function flattenCuts(data: CutBoardData | null) {
  return data?.scenes.flatMap((scene) => scene.cuts) ?? [];
}

function formatRatioLabel(ratio: CutBoardData["target_aspect_ratio"]) {
  return ratio === "1:1" ? "1:1" : "9:16";
}

function previewUrl(projectId: string, cut: CutBoardCut | undefined) {
  return cut?.media_asset_id
    ? resolveMediaUrl(`/api/projects/${projectId}/assets/${cut.media_asset_id}/preview`)
    : null;
}

function mergeVideoSettings(base: ProjectVideoSettings, overrides: VideoSettingsPatch): ProjectVideoSettings {
  return {
    ...base,
    audio: { ...base.audio, ...(overrides.audio ?? {}) },
    subtitle: {
      ...base.subtitle,
      ...(overrides.subtitle ?? {}),
      style: { ...base.subtitle.style, ...(overrides.subtitle?.style ?? {}) },
    },
  };
}

function buildCutVideoSettingsPatch(
  base: ProjectVideoSettings,
  settings: ProjectVideoSettings,
): VideoSettingsPatch {
  const audio = Object.fromEntries(
    AUDIO_SETTING_FIELDS
      .filter((field) => settings.audio[field] !== base.audio[field])
      .map((field) => [field, settings.audio[field]]),
  ) as Partial<TTSSettings>;
  const style = Object.fromEntries(
    SUBTITLE_STYLE_FIELDS
      .filter((field) => settings.subtitle.style[field] !== base.subtitle.style[field])
      .map((field) => [field, settings.subtitle.style[field]]),
  ) as Partial<SubtitleStyle>;
  const subtitle: NonNullable<VideoSettingsPatch["subtitle"]> = {};
  if (settings.subtitle.enabled !== base.subtitle.enabled) subtitle.enabled = settings.subtitle.enabled;
  if (Object.keys(style).length) subtitle.style = style;

  const patch: VideoSettingsPatch = {};
  if (Object.keys(audio).length) patch.audio = audio;
  if (Object.keys(subtitle).length) patch.subtitle = subtitle;
  return patch;
}

function replaceCutInBoard(board: CutBoardData, updatedCut: CutBoardCut): CutBoardData {
  return {
    ...board,
    scenes: board.scenes.map((scene) => ({
      ...scene,
      cuts: scene.cuts.map((cut) => cut.id === updatedCut.id ? updatedCut : cut),
    })),
  };
}

function settingsOutline(style: SubtitleStyle) {
  const width = Math.max(0, style.outline_width);
  if (!width) return undefined;
  return [
    `${width}px 0 0 ${style.outline_color}`,
    `-${width}px 0 0 ${style.outline_color}`,
    `0 ${width}px 0 ${style.outline_color}`,
    `0 -${width}px 0 ${style.outline_color}`,
  ].join(", ");
}

function VideoSettingsGuide() {
  return (
    <section className="video-settings-guide" aria-labelledby="video-settings-guide-title">
      <div className="video-settings-guide__heading">
        <Sparkle size={22} aria-hidden="true" />
        <h2 id="video-settings-guide-title">영상 설정 안내</h2>
      </div>
      <ol>
        <li><span>1</span><p>프로젝트 기본값은 전체 컷에 적용됩니다.</p></li>
        <li><span>2</span><p>미리보기에서 원본 이미지와 자막 위치를 확인합니다.</p></li>
        <li><span>3</span><p>저장한 값은 다음 출력 매니페스트에도 반영됩니다.</p></li>
      </ol>
      <div className="video-settings-guide__callout">
        <strong>원본 이미지 비율 유지</strong>
        <p>미리보기와 출력에서 이미지를 임의로 잘라내지 않습니다.</p>
      </div>
    </section>
  );
}

export function VideoSettingsPage({ projectId }: { projectId: string }) {
  const [board, setBoard] = useState<CutBoardData | null>(null);
  const [savedSettings, setSavedSettings] = useState<ProjectVideoSettings | null>(null);
  const [draft, setDraft] = useState<ProjectVideoSettings | null>(null);
  const [cutDrafts, setCutDrafts] = useState<Record<string, ProjectVideoSettings>>({});
  const [selectedCutId, setSelectedCutId] = useState("");
  const [settingsScope, setSettingsScope] = useState<"project" | "cut">("project");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isContinuingToOutput, setIsContinuingToOutput] = useState(false);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setPageError("");
    void Promise.all([apiClient.getCutBoard(projectId), apiClient.getVideoSettings(projectId)])
      .then(([nextBoard, nextSettings]) => {
        if (!active) return;
        setBoard(nextBoard);
        setSavedSettings(nextSettings);
        setDraft(nextSettings);
        setCutDrafts({});
        setSettingsScope("project");
        setNotice("");
      })
      .catch((reason: unknown) => {
        if (active) setPageError(reason instanceof Error ? reason.message : "영상 설정을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const cuts = flattenCuts(board);
  const activeCutId = cuts.some((cut) => cut.id === selectedCutId) ? selectedCutId : cuts[0]?.id ?? "";
  const activeCut = cuts.find((cut) => cut.id === activeCutId);
  const activePreviewUrl = previewUrl(projectId, activeCut);
  const targetAspectRatio = formatRatioLabel(board?.target_aspect_ratio);
  const activeCutOverrides = activeCut?.video_settings_overrides ?? {};
  const resolvedCutSettings = savedSettings && activeCut
    ? mergeVideoSettings(savedSettings, activeCutOverrides)
    : null;
  const editingSettings = settingsScope === "cut"
    ? (activeCut ? cutDrafts[activeCut.id] ?? resolvedCutSettings : null)
    : draft;
  const projectIsDirty = Boolean(draft && savedSettings && JSON.stringify(draft) !== JSON.stringify(savedSettings));
  const cutIsDirty = Boolean(editingSettings && resolvedCutSettings && JSON.stringify(editingSettings) !== JSON.stringify(resolvedCutSettings));
  const isDirty = settingsScope === "cut" ? cutIsDirty : projectIsDirty;
  const scopeLabel = settingsScope === "cut" && activeCut ? `컷 ${activeCut.order} 예외 설정` : "프로젝트 기본값";
  const hasActiveCutOverride = Object.keys(activeCutOverrides).length > 0;

  function updateEditor(update: (current: ProjectVideoSettings) => ProjectVideoSettings) {
    if (settingsScope === "cut" && activeCut && savedSettings) {
      setCutDrafts((current) => {
        const base = current[activeCut.id] ?? mergeVideoSettings(savedSettings, activeCutOverrides);
        return { ...current, [activeCut.id]: update(base) };
      });
    } else {
      setDraft((current) => current ? update(current) : current);
    }
    setNotice("");
  }

  function updateAudio<K extends keyof TTSSettings>(field: K, value: TTSSettings[K]) {
    updateEditor((current) => ({ ...current, audio: { ...current.audio, [field]: value } }));
  }

  function updateSubtitle<K extends keyof SubtitleStyle>(field: K, value: SubtitleStyle[K]) {
    updateEditor((current) => ({
      ...current,
      subtitle: { ...current.subtitle, style: { ...current.subtitle.style, [field]: value } },
    }));
  }

  function updateSubtitleEnabled(enabled: boolean) {
    updateEditor((current) => ({ ...current, subtitle: { ...current.subtitle, enabled } }));
  }

  function changeSettingsScope(nextScope: "project" | "cut") {
    if (nextScope === "cut" && !activeCut) return;
    setSettingsScope(nextScope);
    setNotice("");
  }

  async function saveSettings(showNotice = true): Promise<boolean> {
    if (!editingSettings || !isDirty) return true;
    setIsSaving(true);
    setPageError("");
    setNotice("");
    try {
      if (settingsScope === "cut" && activeCut && savedSettings) {
        const savedCut = await apiClient.updateCutVideoSettings(
          projectId,
          activeCut.id,
          buildCutVideoSettingsPatch(savedSettings, editingSettings),
        );
        setBoard((current) => current ? replaceCutInBoard(current, savedCut) : current);
        setCutDrafts((current) => {
          const next = { ...current };
          delete next[activeCut.id];
          return next;
        });
        if (showNotice) setNotice("컷별 예외 설정을 저장했습니다.");
      } else {
        const saved = await apiClient.updateVideoSettings(projectId, editingSettings);
        setSavedSettings(saved);
        setDraft(saved);
        if (showNotice) setNotice("설정을 저장했습니다.");
      }
      return true;
    } catch (reason: unknown) {
      setPageError(reason instanceof Error ? reason.message : "영상 설정 저장에 실패했습니다.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSave() {
    await saveSettings();
  }

  async function handleContinueToOutput() {
    if (isContinuingToOutput) return;
    setIsContinuingToOutput(true);
    setPageError("");
    setNotice("");
    try {
      const saved = await saveSettings(false);
      if (!saved) return;
      await apiClient.updateProject(projectId, { stage: "output", status: "output" });
      navigateTo(projectStagePath(projectId, "output"));
    } catch (reason: unknown) {
      setPageError(reason instanceof Error ? reason.message : "출력 단계로 이동하지 못했습니다.");
    } finally {
      setIsContinuingToOutput(false);
    }
  }

  async function handleResetCut() {
    if (!activeCut || !savedSettings) return;
    setIsSaving(true);
    setPageError("");
    setNotice("");
    try {
      if (hasActiveCutOverride) {
        const resetCut = await apiClient.updateCutVideoSettings(projectId, activeCut.id, {});
        setBoard((current) => current ? replaceCutInBoard(current, resetCut) : current);
      }
      setCutDrafts((current) => {
        const next = { ...current };
        delete next[activeCut.id];
        return next;
      });
      setNotice("프로젝트 기본값으로 되돌렸습니다.");
    } catch (reason: unknown) {
      setPageError(reason instanceof Error ? reason.message : "컷별 예외 설정을 초기화하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  const projectTitle = board?.project_title ?? "프로젝트";
  const stage: WorkflowStage = "video_settings";
  const style = editingSettings?.subtitle.style;
  const previewStyle: CSSProperties | undefined = style ? {
    color: style.color,
    backgroundColor: style.background_color ?? "transparent",
    textShadow: settingsOutline(style),
    fontFamily: style.font_family,
    fontSize: `${Math.max(12, Math.min(30, style.font_size / 3.5))}px`,
    textAlign: style.alignment,
    maxHeight: `${style.max_lines * 1.35}em`,
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: style.max_lines,
    overflow: "hidden",
    ...(style.position === "custom" ? { left: `${style.custom_x}%`, top: `${style.custom_y}%` } : {}),
  } : undefined;

  return (
    <AppShell
      projectName={projectTitle}
      stage={stage}
      panelOpen
      onPanelOpenChange={() => undefined}
      currentView="video_settings"
      projectId={projectId}
      ideaProjectId={projectId}
      scriptProjectId={projectId}
      contextPanel={<VideoSettingsGuide />}
      quickStart={null}
      showQuickStart={false}
    >
      <div className="video-settings-page" aria-labelledby="video-settings-title">
        <header className="video-settings-page__heading">
          <div>
            <span className="video-settings-page__step">영상 설정 단계 · 음성·자막 설정</span>
            <h1 id="video-settings-title">음성·자막 설정</h1>
            <p>최종 영상에 사용할 음성과 자막 스타일을 확인하고 저장합니다.</p>
          </div>
          <div className="video-settings-page__scope">
            <strong>{scopeLabel}</strong>
            <span>{settingsScope === "cut" && activeCut ? "변경한 값만 이 컷에 적용" : `전체 ${cuts.length}컷에 적용`}</span>
          </div>
        </header>

        <div className="video-settings-scope-switcher" role="group" aria-label="설정 적용 범위">
          <button
            className={settingsScope === "project" ? "is-selected" : ""}
            type="button"
            aria-pressed={settingsScope === "project"}
            onClick={() => changeSettingsScope("project")}
          >
            프로젝트 기본값
          </button>
          <button
            className={settingsScope === "cut" ? "is-selected" : ""}
            type="button"
            aria-label={activeCut ? `컷 ${activeCut.order} 예외 설정` : "컷 예외 설정"}
            aria-pressed={settingsScope === "cut"}
            onClick={() => changeSettingsScope("cut")}
            disabled={!activeCut}
          >
            {activeCut ? `컷 ${activeCut.order} 예외` : "컷 예외"}
          </button>
        </div>
        {settingsScope === "cut" && activeCut ? <p className="video-settings-scope-note">프로젝트 기본값을 상속한 상태입니다. 변경한 항목만 이 컷의 예외로 저장됩니다.</p> : null}

        <nav className="video-settings-tabs" aria-label="영상 설정 섹션">
          <a href="#video-settings-audio">음성 설정</a>
          <a href="#video-settings-subtitle">자막 설정</a>
        </nav>

        {isLoading ? <p className="video-settings-state" role="status">영상 설정을 불러오는 중입니다.</p> : null}
        {pageError ? <p className="video-settings-state video-settings-state--error" role="alert">{pageError}</p> : null}

        {!isLoading && editingSettings ? (
          <>
            <div className="video-settings-layout">
              <section className="video-settings-preview-card" aria-labelledby="video-settings-preview-title">
                <div className="video-settings-section-heading">
                  <div>
                    <span>출력 미리보기</span>
                    <h2 id="video-settings-preview-title">원본 비율 그대로 확인</h2>
                  </div>
                  <label className="video-settings-cut-select">
                    <span>미리보기 컷</span>
                    <select value={activeCutId} onChange={(event) => setSelectedCutId(event.target.value)} aria-label="미리보기 컷" disabled={!cuts.length}>
                      {cuts.length ? cuts.map((cut) => <option value={cut.id} key={cut.id}>컷 {cut.order} · {cut.title}</option>) : <option value="">컷 없음</option>}
                    </select>
                  </label>
                </div>
                <div className={`video-settings-preview__canvas video-settings-preview__canvas--${targetAspectRatio === "1:1" ? "square" : "portrait"}`}>
                  {activePreviewUrl ? <img className="video-settings-preview__media" src={activePreviewUrl} alt={`컷 ${activeCut?.order ?? 0} 미리보기`} /> : <div className="video-settings-preview__empty" role="status"><ImageIcon size={28} aria-hidden="true" /><strong>미리보기 이미지 없음</strong><span>디자인 단계에서 컷 이미지를 생성하면 여기에 표시됩니다.</span></div>}
                  {style?.safe_area ? <div className="video-settings-preview__safe-area" aria-hidden="true" /> : null}
                  {editingSettings.subtitle.enabled && activeCut?.subtitle ? <span className={`video-settings-preview__subtitle video-settings-preview__subtitle--${style?.position ?? "bottom"}`} style={previewStyle}>{activeCut.subtitle}</span> : null}
                </div>
                <div className="video-settings-preview__meta"><span>{targetAspectRatio} 출력</span><span>{activeCut ? `컷 ${activeCut.order} · ${activeCut.duration_ms / 1000}초` : "선택된 컷 없음"}</span></div>
              </section>

              <div className="video-settings-form">
                <section className="video-settings-panel" id="video-settings-audio" aria-labelledby="video-settings-audio-title">
                  <div className="video-settings-panel__heading"><div><span>{scopeLabel}</span><h2 id="video-settings-audio-title">음성 설정</h2></div><span className="video-settings-panel__badge">TTS</span></div>
                  <label className="video-settings-toggle"><input type="checkbox" checked={editingSettings.audio.enabled} onChange={(event) => updateAudio("enabled", event.target.checked)} /><span><strong>TTS 사용</strong><small>내레이션 텍스트를 음성으로 변환합니다.</small></span></label>
                  <div className="video-settings-field-grid">
                    <label className="video-settings-field"><span>음성 엔진</span><select aria-label="음성 엔진" value={editingSettings.audio.provider} onChange={(event) => updateAudio("provider", event.target.value as TTSProvider)}><option value="edge_tts">{TTS_PROVIDER_LABELS.edge_tts}</option><option value="upload">{TTS_PROVIDER_LABELS.upload}</option><option value="azure_speech" disabled>{TTS_PROVIDER_LABELS.azure_speech}</option><option value="elevenlabs" disabled>{TTS_PROVIDER_LABELS.elevenlabs}</option></select></label>
                    <label className="video-settings-field"><span>언어</span><select aria-label="음성 언어" value={editingSettings.audio.language} onChange={(event) => updateAudio("language", event.target.value)}><option value="ko-KR">한국어 · ko-KR</option><option value="en-US">영어 · en-US</option><option value="ja-JP">일본어 · ja-JP</option></select></label>
                    <label className="video-settings-field video-settings-field--wide"><span>목소리</span><select aria-label="목소리" value={editingSettings.audio.voice_id} onChange={(event) => updateAudio("voice_id", event.target.value)}>{VOICE_OPTIONS.map((voice) => <option value={voice.value} key={voice.value}>{voice.label}</option>)}{VOICE_OPTIONS.every((voice) => voice.value !== editingSettings.audio.voice_id) ? <option value={editingSettings.audio.voice_id}>{editingSettings.audio.voice_id}</option> : null}</select></label>
                  </div>
                  <div className="video-settings-range-grid">
                    <label className="video-settings-range"><span>말하기 속도 <output>{editingSettings.audio.speed.toFixed(2)}x</output></span><input aria-label="말하기 속도" type="range" min="0.7" max="1.3" step="0.05" value={editingSettings.audio.speed} onChange={(event) => updateAudio("speed", Number(event.target.value))} /></label>
                    <label className="video-settings-range"><span>음성 볼륨 <output>{Math.round(editingSettings.audio.volume * 100)}%</output></span><input aria-label="음성 볼륨" type="range" min="0" max="1" step="0.05" value={editingSettings.audio.volume} onChange={(event) => updateAudio("volume", Number(event.target.value))} /></label>
                    <label className="video-settings-range"><span>피치 <output>{editingSettings.audio.pitch > 0 ? "+" : ""}{editingSettings.audio.pitch} st</output></span><input aria-label="피치" type="range" min="-12" max="12" step="1" value={editingSettings.audio.pitch} onChange={(event) => updateAudio("pitch", Number(event.target.value))} /></label>
                  </div>
                  <button className="button button--secondary video-settings-preview-button" type="button" disabled title="TTS 작업 단계에서 연결됩니다.">선택 컷 음성 미리듣기 <span>다음 단계 연결 예정</span></button>
                </section>

                <section className="video-settings-panel" id="video-settings-subtitle" aria-labelledby="video-settings-subtitle-title">
                  <div className="video-settings-panel__heading"><div><span>{scopeLabel}</span><h2 id="video-settings-subtitle-title">자막 설정</h2></div><span className="video-settings-panel__badge">SUBTITLE</span></div>
                  <label className="video-settings-toggle"><input type="checkbox" checked={editingSettings.subtitle.enabled} onChange={(event) => updateSubtitleEnabled(event.target.checked)} /><span><strong>자막 사용</strong><small>미리보기에서 현재 컷의 자막 위치를 확인합니다.</small></span></label>
                  <fieldset className="video-settings-fieldset"><legend>자막 위치</legend><div className="video-settings-position-grid">{POSITION_OPTIONS.map((option) => <button className={`video-settings-position${editingSettings.subtitle.style.position === option.value ? " is-selected" : ""}`} type="button" aria-label={`자막 위치: ${option.label}`} aria-pressed={editingSettings.subtitle.style.position === option.value} key={option.value} onClick={() => updateSubtitle("position", option.value)}>{option.label}</button>)}</div></fieldset>
                  {editingSettings.subtitle.style.position === "custom" ? <div className="video-settings-field-grid"><label className="video-settings-field"><span>가로 위치 (%)</span><input aria-label="자막 가로 위치" type="number" min="0" max="100" value={editingSettings.subtitle.style.custom_x} onChange={(event) => updateSubtitle("custom_x", Number(event.target.value))} /></label><label className="video-settings-field"><span>세로 위치 (%)</span><input aria-label="자막 세로 위치" type="number" min="0" max="100" value={editingSettings.subtitle.style.custom_y} onChange={(event) => updateSubtitle("custom_y", Number(event.target.value))} /></label></div> : null}
                  <div className="video-settings-field-grid">
                    <label className="video-settings-field"><span>글꼴</span><select aria-label="자막 글꼴" value={editingSettings.subtitle.style.font_family} onChange={(event) => updateSubtitle("font_family", event.target.value)}>{FONT_OPTIONS.map((font) => <option value={font} key={font}>{font}</option>)}{FONT_OPTIONS.every((font) => font !== editingSettings.subtitle.style.font_family) ? <option value={editingSettings.subtitle.style.font_family}>{editingSettings.subtitle.style.font_family}</option> : null}</select></label>
                    <label className="video-settings-range"><span>글자 크기 <output>{editingSettings.subtitle.style.font_size}px</output></span><input aria-label="자막 글자 크기" type="range" min="24" max="120" step="1" value={editingSettings.subtitle.style.font_size} onChange={(event) => updateSubtitle("font_size", Number(event.target.value))} /></label>
                    <label className="video-settings-field"><span>정렬</span><select aria-label="자막 정렬" value={editingSettings.subtitle.style.alignment} onChange={(event) => updateSubtitle("alignment", event.target.value as SubtitleStyle["alignment"])}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label>
                    <label className="video-settings-field"><span>최대 줄 수</span><select aria-label="자막 최대 줄 수" value={editingSettings.subtitle.style.max_lines} onChange={(event) => updateSubtitle("max_lines", Number(event.target.value))}>{[1, 2, 3, 4].map((lines) => <option value={lines} key={lines}>{lines}줄</option>)}</select></label>
                  </div>
                  <div className="video-settings-color-grid">
                    <label className="video-settings-color"><span>글자 색상</span><input aria-label="자막 글자 색상" type="color" value={editingSettings.subtitle.style.color} onChange={(event) => updateSubtitle("color", event.target.value)} /></label>
                    <label className="video-settings-color"><span>외곽선 색상</span><input aria-label="외곽선 색상" type="color" value={editingSettings.subtitle.style.outline_color} onChange={(event) => updateSubtitle("outline_color", event.target.value)} /></label>
                    <label className="video-settings-range"><span>외곽선 두께 <output>{editingSettings.subtitle.style.outline_width.toFixed(1)}px</output></span><input aria-label="자막 외곽선 두께" type="range" min="0" max="8" step="0.5" value={editingSettings.subtitle.style.outline_width} onChange={(event) => updateSubtitle("outline_width", Number(event.target.value))} /></label>
                  </div>
                  <div className="video-settings-inline-options">
                    <label className="video-settings-check"><input type="checkbox" checked={editingSettings.subtitle.style.background_color !== null} onChange={(event) => updateSubtitle("background_color", event.target.checked ? "#111111" : null)} /><span>자막 배경</span></label>
                    <input aria-label="자막 배경 색상" type="color" value={editingSettings.subtitle.style.background_color ?? "#111111"} disabled={editingSettings.subtitle.style.background_color === null} onChange={(event) => updateSubtitle("background_color", event.target.value)} />
                    <label className="video-settings-check"><input type="checkbox" checked={editingSettings.subtitle.style.safe_area} onChange={(event) => updateSubtitle("safe_area", event.target.checked)} /><span>안전 영역 표시</span></label>
                  </div>
                </section>
              </div>
            </div>
            {notice ? <p className="video-settings-notice" role="status">{notice}</p> : null}
            <footer className="video-settings-actions">
              <button className="button button--secondary" type="button" onClick={() => navigateTo(projectStagePath(projectId, "design"))}><ArrowLeft size={16} aria-hidden="true" />디자인으로 돌아가기</button>
              <div className="video-settings-actions__group">
                {settingsScope === "cut" ? <button className="button button--secondary" type="button" onClick={() => void handleResetCut()} disabled={isSaving || (!hasActiveCutOverride && !cutIsDirty)}>프로젝트 기본값으로 되돌리기</button> : null}
                <button className="button button--secondary" type="button" onClick={() => void handleSave()} disabled={!isDirty || isSaving || isContinuingToOutput} aria-busy={isSaving}><FloppyDisk size={16} aria-hidden="true" />{isSaving ? "저장 중…" : settingsScope === "cut" ? "컷 예외 저장" : "설정 저장"}</button>
                <button className="button button--primary" type="button" onClick={() => void handleContinueToOutput()} disabled={isSaving || isContinuingToOutput} aria-busy={isContinuingToOutput}><ArrowRight size={16} aria-hidden="true" />{isContinuingToOutput ? "출력으로 이동 중…" : "다음: 출력으로 이동"}</button>
              </div>
            </footer>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

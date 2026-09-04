import { useEffect, useState } from "react";
import { ArrowClockwise, Clock, FileText, Image, Lock, LockOpen, Sparkle } from "@phosphor-icons/react";
import type { CutBoardCut, CutRegenerationOptions } from "../../app/api";

export type CutAction = "regenerate" | "lock" | "version";

interface CutCardProps {
  cut: CutBoardCut;
  isBusy?: boolean;
  busyAction?: CutAction | null;
  onRegenerate?: (cutId: string, options: CutRegenerationOptions) => void | Promise<void>;
  onToggleLock?: (cutId: string, nextLocked: boolean) => void | Promise<void>;
  onActivateVersion?: (cutId: string, versionId: string) => void | Promise<void>;
}

const CUT_STATUS_LABELS: Record<CutBoardCut["status"], string> = {
  draft: "초안",
  generating: "생성 중",
  ready: "준비됨",
  failed: "생성 실패",
};

function formatDuration(durationMs: number) {
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1).replace(/\.0$/, "")}초`;
}

function activeVersionLabel(cut: CutBoardCut) {
  if (!cut.active_version_id) return "버전 없음";
  const index = cut.versions.findIndex((version) => version.id === cut.active_version_id);
  return index >= 0 ? `버전 ${index + 1} 활성` : "활성 버전";
}

export function CutCard({ cut, isBusy = false, busyAction = null, onRegenerate, onToggleLock, onActivateVersion }: CutCardProps) {
  const [visualPrompt, setVisualPrompt] = useState(cut.visual_prompt);
  const [isPromptEdited, setIsPromptEdited] = useState(false);

  useEffect(() => {
    setVisualPrompt(cut.visual_prompt);
    setIsPromptEdited(false);
  }, [cut.id, cut.visual_prompt]);

  function handleRegenerate() {
    if (!onRegenerate) return;
    const nextPrompt = visualPrompt.trim();
    const options: CutRegenerationOptions = nextPrompt && isPromptEdited
      ? { visual_prompt: nextPrompt }
      : {};
    void onRegenerate(cut.id, options);
  }

  return (
    <article className="cut-card" aria-labelledby={`cut-card-title-${cut.id}`}>
      <div className="cut-card__topline">
        <span className="cut-card__number">컷 {cut.order}</span>
        <span className={`cut-card__status cut-card__status--${cut.status}`}>{CUT_STATUS_LABELS[cut.status]}</span>
      </div>
      <h3 id={`cut-card-title-${cut.id}`}>{cut.title}</h3>
      <p className="cut-card__duration"><Clock size={15} aria-hidden="true" />{formatDuration(cut.duration_ms)}</p>

      <dl className="cut-card__details">
        <div>
          <dt><FileText size={15} aria-hidden="true" />내레이션</dt>
          <dd>{cut.narration_text || "내레이션 없음"}</dd>
        </div>
        <div>
          <dt><FileText size={15} aria-hidden="true" />자막</dt>
          <dd>{cut.subtitle || "자막 없음"}</dd>
        </div>
        <div>
          <dt><Image size={15} aria-hidden="true" />비주얼 프롬프트</dt>
          <dd>{cut.visual_prompt || "이미지 프롬프트 없음"}</dd>
        </div>
      </dl>

      {onRegenerate ? (
        <details className="cut-card__regeneration" open>
          <summary><Sparkle size={15} aria-hidden="true" />재생성 설정</summary>
          <label htmlFor={`cut-prompt-${cut.id}`}>컷 {cut.order} 이미지 생성 프롬프트</label>
          <textarea
            id={`cut-prompt-${cut.id}`}
            value={visualPrompt}
            onChange={(event) => {
              setVisualPrompt(event.target.value);
              setIsPromptEdited(true);
            }}
            rows={3}
            disabled={cut.locked || isBusy}
          />
        </details>
      ) : null}

      <div className="cut-card__footer">
        <span>{activeVersionLabel(cut)}</span>
        <span>{cut.media_asset_id ? "이미지 연결됨" : "이미지 생성 대기"}</span>
      </div>

      {onRegenerate || onToggleLock ? (
        <div className="cut-card__actions" aria-label={`컷 ${cut.order} 작업`}>
          {onRegenerate ? (
            <button className="button button--primary" type="button" onClick={handleRegenerate} disabled={cut.locked || isBusy} aria-busy={busyAction === "regenerate"}>
              <ArrowClockwise size={16} aria-hidden="true" />
              {busyAction === "regenerate" ? "재생성 중…" : `컷 ${cut.order} 재생성`}
            </button>
          ) : null}
          {onToggleLock ? (
            <button className="button button--secondary" type="button" onClick={() => void onToggleLock(cut.id, !cut.locked)} disabled={isBusy} aria-busy={busyAction === "lock"}>
              {cut.locked ? <LockOpen size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}
              {cut.locked ? `컷 ${cut.order} 잠금 해제` : `컷 ${cut.order} 잠금`}
            </button>
          ) : null}
        </div>
      ) : null}

      {onActivateVersion && cut.versions.length > 1 ? (
        <section className="cut-card__versions" aria-label={`컷 ${cut.order} 버전 기록`}>
          <h4>버전 기록</h4>
          <div>
            {cut.versions.map((version, index) => {
              const isActive = version.id === cut.active_version_id;
              return (
                <button
                  className="button button--secondary"
                  key={version.id}
                  type="button"
                  onClick={() => void onActivateVersion(cut.id, version.id)}
                  disabled={isActive || isBusy}
                  aria-current={isActive ? "true" : undefined}
                  aria-busy={busyAction === "version" && !isActive}
                >
                  {isActive ? `컷 ${cut.order} 버전 ${index + 1} 사용 중` : `컷 ${cut.order} 버전 ${index + 1} 사용`}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {cut.error ? <p className="cut-card__error" role="alert">{cut.error}</p> : null}
    </article>
  );
}

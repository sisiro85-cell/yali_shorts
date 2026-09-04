import { useEffect, useState } from "react";
import { ArrowClockwise, Clock, FileText, Image as ImageIcon, Lock, Sparkle } from "@phosphor-icons/react";
import { resolveMediaUrl, type CutBoardData, type CutBoardCut, type CutBoardScene, type CutRegenerationOptions } from "../../app/api";
import type { CutAction } from "../cuts/CutCard";
import "./design.css";

interface DesignBoardProps {
  projectId: string;
  data: CutBoardData | null;
  isLoading?: boolean;
  error: string;
  notice?: string;
  busyCutId?: string | null;
  busyCutAction?: CutAction | null;
  onRegenerate: (cutId: string, options: CutRegenerationOptions) => void | Promise<void>;
  onBackToCuts?: () => void;
  onContinueToOutput?: () => void | Promise<void>;
  isContinuing?: boolean;
}

const CUT_STATUS_LABELS: Record<CutBoardCut["status"], string> = {
  draft: "이미지 생성 대기",
  generating: "생성 중",
  ready: "이미지 준비됨",
  failed: "생성 실패",
};

function formatDuration(durationMs: number) {
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1).replace(/\.0$/, "")}초`;
}

function previewUrl(projectId: string, cut: CutBoardCut) {
  return cut.media_asset_id
    ? resolveMediaUrl(`/api/projects/${projectId}/assets/${cut.media_asset_id}/preview`)
    : null;
}

interface DesignCutCardProps {
  projectId: string;
  scene: Pick<CutBoardScene, "order" | "title">;
  cut: CutBoardCut;
  isBusy: boolean;
  busyAction: CutAction | null;
  onRegenerate: DesignBoardProps["onRegenerate"];
}

function DesignCutCard({ projectId, scene, cut, isBusy, busyAction, onRegenerate }: DesignCutCardProps) {
  const [visualPrompt, setVisualPrompt] = useState(cut.visual_prompt);
  const [isPromptEdited, setIsPromptEdited] = useState(false);
  const imageUrl = previewUrl(projectId, cut);
  const hasImage = Boolean(imageUrl);
  const isGenerating = isBusy && busyAction === "regenerate";

  useEffect(() => {
    setVisualPrompt(cut.visual_prompt);
    setIsPromptEdited(false);
  }, [cut.id, cut.visual_prompt]);

  function handleRegenerate() {
    const nextPrompt = visualPrompt.trim();
    const options: CutRegenerationOptions = nextPrompt && (isPromptEdited || hasImage)
      ? { visual_prompt: nextPrompt }
      : {};
    void onRegenerate(cut.id, options);
  }

  const imageStatus = isGenerating ? "생성 중" : CUT_STATUS_LABELS[cut.status];
  const actionLabel = isGenerating ? "이미지 생성 중…" : hasImage ? `컷 ${cut.order} 이미지 재생성` : `컷 ${cut.order} 이미지 생성`;

  return (
    <article className={`design-cut-card${hasImage ? " design-cut-card--ready" : " design-cut-card--pending"}`} aria-labelledby={`design-cut-title-${cut.id}`}>
      <div className="design-cut-card__preview">
        {imageUrl ? (
          <img src={imageUrl} alt={`컷 ${cut.order} ${cut.title} 이미지`} loading="lazy" />
        ) : (
          <div className="design-cut-card__empty" role="status">
            <ImageIcon size={28} aria-hidden="true" />
            <strong>아직 이미지가 없습니다.</strong>
            <p>{cut.status === "failed" ? "이전 생성에 실패했습니다. 다시 생성해 주세요." : "이 컷의 이미지를 생성해 주세요."}</p>
          </div>
        )}
        <span className={`design-cut-card__image-status design-cut-card__image-status--${cut.status}`} aria-live="polite">
          {imageStatus}
        </span>
      </div>

      <div className="design-cut-card__body">
        <div className="design-cut-card__topline">
          <div className="design-cut-card__identity">
            <span className="design-cut-card__scene">씬 {scene.order} · {scene.title}</span>
            <span className="design-cut-card__number">컷 {cut.order}</span>
          </div>
          <span className="design-cut-card__duration"><Clock size={14} aria-hidden="true" />{formatDuration(cut.duration_ms)}</span>
        </div>
        <h3 id={`design-cut-title-${cut.id}`}>{cut.title}</h3>
        <button
          className="button button--primary design-cut-card__action"
          type="button"
          onClick={handleRegenerate}
          disabled={cut.locked || isBusy}
          aria-busy={isGenerating}
        >
          <ArrowClockwise size={16} aria-hidden="true" />
          {actionLabel}
        </button>

        <dl className="design-cut-card__details">
          <div>
            <dt><FileText size={14} aria-hidden="true" />자막</dt>
            <dd>{cut.subtitle || "자막 없음"}</dd>
          </div>
          <div>
            <dt><FileText size={14} aria-hidden="true" />내레이션</dt>
            <dd>{cut.narration_text || "내레이션 없음"}</dd>
          </div>
        </dl>

        <details className="design-cut-card__settings" open>
          <summary><Sparkle size={15} aria-hidden="true" />이미지 설정</summary>
          <label htmlFor={`design-cut-prompt-${cut.id}`}>컷 {cut.order} 이미지 프롬프트</label>
          <textarea
            id={`design-cut-prompt-${cut.id}`}
            value={visualPrompt}
            onChange={(event) => {
              setVisualPrompt(event.target.value);
              setIsPromptEdited(true);
            }}
            rows={3}
            disabled={cut.locked || isBusy}
          />
        </details>

        <div className="design-cut-card__footer">
          <span>{cut.media_asset_id ? "현재 이미지 연결됨" : "이미지 생성 필요"}</span>
          {cut.locked ? <span><Lock size={14} aria-hidden="true" />컷 잠금</span> : null}
        </div>
        {cut.error ? <p className="design-cut-card__error" role="alert">{cut.error}</p> : null}
      </div>
    </article>
  );
}

function countCuts(data: CutBoardData | null) {
  return data?.scenes.reduce((total, scene) => total + scene.cuts.length, 0) ?? 0;
}

function countReadyImages(data: CutBoardData | null) {
  return data?.scenes.reduce((total, scene) => total + scene.cuts.filter((cut) => Boolean(cut.media_asset_id)).length, 0) ?? 0;
}

export function DesignBoard({ projectId, data, isLoading = false, error, notice, busyCutId = null, busyCutAction = null, onRegenerate, onBackToCuts, onContinueToOutput, isContinuing = false }: DesignBoardProps) {
  const totalCuts = countCuts(data);
  const readyImages = countReadyImages(data);
  const hasCuts = totalCuts > 0;
  const isStale = data?.stale ?? false;
  const allImagesReady = hasCuts && readyImages === totalCuts;
  const isBusy = Boolean(busyCutId) || isLoading;

  return (
    <section className="design-board" aria-labelledby="design-board-title" aria-busy={isBusy}>
      <header className="design-board__heading">
        <div>
          <span className="design-board__step">4 / 5</span>
          <h1 id="design-board-title">디자인</h1>
          <p>컷별 이미지를 확인하고, 마음에 들지 않는 컷만 다시 생성합니다.</p>
        </div>
        {data && !isStale ? (
          <div className="design-board__progress" aria-label="이미지 생성 현황">
            <strong>{readyImages}/{totalCuts}</strong>
            <span>이미지 준비</span>
          </div>
        ) : null}
      </header>

      {isLoading ? <p className="design-state" role="status">컷별 디자인을 불러오는 중입니다.</p> : null}
      {error ? <p className="design-state design-state--error" role="alert">{error}</p> : null}
      {notice ? <p className="design-notice" aria-live="polite">{notice}</p> : null}

      {!isLoading && isStale ? (
        <section className="design-stale" role="status" aria-label="오래된 디자인 자료">
          <span>업데이트 필요</span>
          <h2>현재 대본과 맞지 않는 컷 보드입니다.</h2>
          <p>최신 대본 기준으로 컷을 다시 구성한 뒤 디자인을 이어서 작업해 주세요.</p>
        </section>
      ) : null}

      {!isLoading && !isStale && data && hasCuts ? (
        <div className="design-scenes">
          <div className="design-card-grid">
            {data.scenes.flatMap((scene) => scene.cuts.map((cut) => (
              <DesignCutCard
                key={cut.id}
                projectId={projectId}
                scene={scene}
                cut={cut}
                isBusy={busyCutId === cut.id}
                busyAction={busyCutId === cut.id ? busyCutAction : null}
                onRegenerate={onRegenerate}
              />
            )))}
          </div>
        </div>
      ) : null}

      {!isLoading && !error && !isStale && (!data || !hasCuts) ? (
        <div className="design-empty" role="status">
          <ImageIcon size={28} aria-hidden="true" />
          <h2>표시할 컷 이미지가 없습니다.</h2>
          <p>컷 구성 단계에서 컷 보드를 생성하면 이곳에서 컷별 이미지를 만들 수 있습니다.</p>
        </div>
      ) : null}

      <div className="design-board__bottom-actions">
        {onBackToCuts ? <button className="button button--secondary" type="button" onClick={onBackToCuts}>컷 구성으로 돌아가기</button> : <span />}
        {onContinueToOutput ? (
          <div className="design-board__next-action">
            {!allImagesReady && hasCuts ? <span>모든 컷 이미지를 생성하면 출력 단계로 이동할 수 있습니다.</span> : null}
            <button className="button button--primary" type="button" onClick={() => void onContinueToOutput()} disabled={!allImagesReady || isBusy || isContinuing} aria-busy={isContinuing}>
              {isContinuing ? "출력으로 이동 중…" : "출력으로 이동"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

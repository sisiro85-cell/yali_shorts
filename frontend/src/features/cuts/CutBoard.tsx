import { Sparkle } from "@phosphor-icons/react";
import type { CutBoardData, CutRegenerationOptions } from "../../app/api";
import { CutCard, type CutAction } from "./CutCard";
import "./cuts.css";

interface CutBoardProps {
  data: CutBoardData | null;
  isLoading?: boolean;
  isGenerating: boolean;
  error: string;
  notice?: string;
  onGenerate: () => void | Promise<void>;
  onBackToIdeas?: () => void;
  isContinuing?: boolean;
  onContinueToDesign?: () => void | Promise<void>;
  busyCutId?: string | null;
  busyCutAction?: CutAction | null;
  onRegenerateCut?: (cutId: string, options: CutRegenerationOptions) => void | Promise<void>;
  onToggleCutLock?: (cutId: string, nextLocked: boolean) => void | Promise<void>;
  onActivateCutVersion?: (cutId: string, versionId: string) => void | Promise<void>;
}
export function CutBoard({ data, isLoading = false, isGenerating, error, notice, onGenerate, onBackToIdeas, isContinuing = false, onContinueToDesign, busyCutId = null, busyCutAction = null, onRegenerateCut, onToggleCutLock, onActivateCutVersion }: CutBoardProps) {
  const isStale = data?.stale ?? false;
  const hasCuts = Boolean(data && data.scenes.some((scene) => scene.cuts.length > 0));
  const buttonLabel = isLoading
    ? "컷 보드 불러오는 중…"
    : isGenerating
      ? "컷 보드 생성 중…"
      : isStale
        ? "최신 대본으로 다시 생성"
        : hasCuts
          ? "컷 보드 다시 생성"
          : "컷 보드 생성";

  return (
    <section className="cut-board" aria-labelledby="cut-board-title" aria-busy={isLoading || isGenerating}>
      <header className="cut-board__heading">
        <div>
          <span className="cut-board__step">3 / 5</span>
          <h1 id="cut-board-title">컷 구성</h1>
          <p>대본을 장면과 컷으로 나누고, 컷별 제작 정보를 확인합니다.</p>
        </div>
        <button className="button button--primary" type="button" onClick={onGenerate} disabled={isLoading || isGenerating} aria-busy={isGenerating}>
          <Sparkle size={17} aria-hidden="true" />
          {buttonLabel}
        </button>
      </header>

      {isLoading ? <p className="cut-state" role="status">컷 보드를 불러오는 중입니다.</p> : null}
      {isGenerating ? <p className="cut-state" role="status">컷 보드를 생성하고 있습니다.</p> : null}
      {error ? <p className="cut-state cut-state--error" role="alert">{error}</p> : null}
      {notice ? <p className="cut-notice" aria-live="polite">{notice}</p> : null}

      {!isLoading && isStale ? (
        <section className="cut-stale" aria-label="오래된 컷 보드" role="status">
          <span className="cut-stale__badge">업데이트 필요</span>
          <h2>현재 대본과 맞지 않는 컷 보드입니다.</h2>
          <p>대본 버전이 변경되어 기존 컷을 현재 작업본으로 표시하지 않습니다. 최신 대본 기준으로 컷 보드를 다시 생성해 주세요.</p>
        </section>
      ) : null}

      {!isLoading && !isStale && data && hasCuts ? (
        <div className="cut-scenes">
          {data.scenes.map((scene) => (
            <section className="cut-scene" key={scene.id} aria-labelledby={`cut-scene-title-${scene.id}`}>
              <header className="cut-scene__heading">
                <div>
                  <span>씬 {scene.order}</span>
                  <h2 id={`cut-scene-title-${scene.id}`}>{scene.title}</h2>
                </div>
                <span>{scene.cuts.length}컷</span>
              </header>
              <div className="cut-card-grid">
                {scene.cuts.map((cut) => (
                  <CutCard
                    key={cut.id}
                    cut={cut}
                    isBusy={busyCutId === cut.id}
                    busyAction={busyCutId === cut.id ? busyCutAction : null}
                    onRegenerate={onRegenerateCut}
                    onToggleLock={onToggleCutLock}
                    onActivateVersion={onActivateCutVersion}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {!isLoading && !isGenerating && !error && !isStale && (!data || !hasCuts) ? (
        <div className="cut-empty" role="status">
          <Sparkle size={25} aria-hidden="true" />
          <h2>아직 생성된 컷 보드가 없습니다.</h2>
          <p>활성 대본을 기준으로 컷 보드를 생성하면 장면별 카드가 여기에 표시됩니다.</p>
        </div>
      ) : null}

      {onBackToIdeas || (onContinueToDesign && data && !isStale && hasCuts) ? (
        <div className="cut-board__bottom-actions">
          {onBackToIdeas ? <button className="button button--secondary" type="button" onClick={onBackToIdeas}>아이디어로 돌아가기</button> : null}
          {onContinueToDesign && data && !isStale && hasCuts ? (
            <button className="button button--primary" type="button" onClick={() => void onContinueToDesign()} disabled={isLoading || isGenerating || isContinuing} aria-busy={isContinuing}>
              {isContinuing ? "디자인으로 이동 중…" : "디자인으로 이동"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

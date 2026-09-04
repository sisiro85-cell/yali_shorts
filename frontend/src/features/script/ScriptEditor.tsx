import { Check, Clock, FileText, PencilSimple, Sparkle, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ScriptVersion, ScriptVersionDraft } from "../../app/api";

export interface ScriptEditorProps {
  data: ScriptVersion | null;
  isLoading?: boolean;
  isGenerating: boolean;
  error: string;
  notice?: string;
  onGenerate: () => void | Promise<void>;
  versions?: ScriptVersion[];
  isSaving?: boolean;
  isActivating?: boolean;
  isContinuing?: boolean;
  onSave?: (draft: ScriptVersionDraft) => void | Promise<void>;
  onActivate?: (versionId: string) => void | Promise<void>;
  onContinueToCuts?: () => void | Promise<void>;
}

export function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  return `${seconds.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}초`;
}

function ScriptSection({ label, value }: { label: string; value: string }) {
  return (
    <article className="script-summary__section">
      <h2>{label}</h2>
      <p>{value}</p>
    </article>
  );
}

function formatCreatedAt(value: string): string {
  return new Date(value).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toDraft(version: ScriptVersion): ScriptVersionDraft {
  return {
    hook: version.hook,
    body: version.body,
    cta: version.cta,
    lines: version.lines.map((line) => ({ ...line })),
  };
}

function ScriptEditField({
  label,
  value,
  onChange,
  multiline = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="script-edit-field">
      <span>{label}</span>
      {multiline ? (
        <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
      ) : (
        <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

export function ScriptEditor({
  data,
  versions = [],
  isLoading = false,
  isGenerating,
  isSaving = false,
  isActivating = false,
  isContinuing = false,
  error,
  notice,
  onGenerate,
  onSave,
  onActivate,
  onContinueToCuts,
}: ScriptEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ScriptVersionDraft | null>(data ? toDraft(data) : null);
  const [activatingVersionId, setActivatingVersionId] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) setDraft(data ? toDraft(data) : null);
  }, [data, isEditing]);

  function beginEditing() {
    if (!data || isActivating) return;
    setDraft(toDraft(data));
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(data ? toDraft(data) : null);
    setIsEditing(false);
  }

  function updateSummary(field: "hook" | "body" | "cta", value: string) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  function updateLine(index: number, patch: Partial<ScriptVersion["lines"][number]>) {
    setDraft((current) => current ? {
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    } : current);
  }

  async function saveEditing() {
    if (!draft || !onSave) return;
    try {
      await onSave({ ...draft, lines: draft.lines.map((line) => ({ ...line })) });
      setIsEditing(false);
    } catch {
      // The page keeps the API error visible and the draft remains editable.
    }
  }

  async function activateVersion(versionId: string) {
    if (!onActivate || isEditing) return;
    setActivatingVersionId(versionId);
    try {
      await onActivate(versionId);
    } catch {
      // The page keeps the API error visible.
    } finally {
      setActivatingVersionId(null);
    }
  }

  const actionLabel = isLoading ? "불러오는 중…" : isGenerating ? "대본 생성 중…" : data ? "새 대본 생성" : "대본 생성";
  const displayed = data && draft ? { ...data, ...draft } : data;
  const history = data ? (versions.length > 0 ? versions : [data]) : [];
  const canEdit = Boolean(data && onSave);

  return (
    <div className="script-editor">
      <div className="script-editor__heading">
        <div>
          <span className="script-editor__step">2 / 5</span>
          <h1>대본 만들기</h1>
          <p>확정된 아이디어를 바탕으로 내레이션과 영상 흐름을 구성합니다.</p>
        </div>
        <div className="script-editor__actions">
          {canEdit ? (
            isEditing ? (
              <>
                <button className="button button--secondary" type="button" onClick={cancelEditing} disabled={isSaving}>
                  <X size={17} aria-hidden="true" />
                  편집 취소
                </button>
                <button className="button button--primary" type="button" onClick={() => void saveEditing()} disabled={isSaving} aria-busy={isSaving}>
                  <Check size={17} aria-hidden="true" />
                  {isSaving ? "저장 중…" : "대본 저장"}
                </button>
              </>
            ) : (
              <button className="button button--secondary" type="button" onClick={beginEditing} disabled={isActivating} aria-busy={isActivating}>
                <PencilSimple size={17} aria-hidden="true" />
                {isActivating ? "버전 전환 중…" : "대본 편집"}
              </button>
            )
          ) : null}
          <button className="button button--primary" type="button" onClick={() => void onGenerate()} disabled={isLoading || isGenerating || isEditing} aria-busy={isLoading || isGenerating}>
            <Sparkle size={17} aria-hidden="true" />
            {actionLabel}
          </button>
        </div>
      </div>

      {error ? <p className="script-state script-state--error" role="alert">{error}</p> : null}
      {notice ? <p className="script-notice" role="status" aria-live="polite">{notice}</p> : null}
      {isLoading ? <p className="script-state" role="status">대본 화면을 불러오는 중입니다…</p> : null}
      {isGenerating ? <p className="script-state" role="status">대본을 생성하고 있습니다…</p> : null}

      {!isLoading && displayed ? (
        <>
          <div className="script-version-meta">
            <span><FileText size={16} aria-hidden="true" /> 현재 활성 대본</span>
            <time dateTime={displayed.created_at}>{formatCreatedAt(displayed.created_at)}</time>
          </div>

          <section className="script-summary" aria-labelledby="script-summary-title">
            <div className="script-section-heading">
              <div><span>대본 개요</span><h2 id="script-summary-title">핵심 메시지</h2></div>
              <span>{displayed.lines.length}개 내레이션 라인</span>
            </div>
            <div className="script-summary__grid">
              {isEditing && draft ? (
                <>
                  <ScriptEditField label="후킹 문장" value={draft.hook} onChange={(value) => updateSummary("hook", value)} />
                  <ScriptEditField label="본문" value={draft.body} onChange={(value) => updateSummary("body", value)} />
                  <ScriptEditField label="행동 유도" value={draft.cta} onChange={(value) => updateSummary("cta", value)} />
                </>
              ) : (
                <>
                  <ScriptSection label="후킹 문장" value={displayed.hook} />
                  <ScriptSection label="본문" value={displayed.body} />
                  <ScriptSection label="행동 유도" value={displayed.cta} />
                </>
              )}
            </div>
          </section>

          <section className="script-lines-section" aria-labelledby="script-lines-title">
            <div className="script-section-heading">
              <div><span>음성·자막 기준</span><h2 id="script-lines-title">내레이션 라인</h2></div>
              <span>순서대로 재생됩니다</span>
            </div>
            <ol className="script-lines">
              {displayed.lines.map((line, index) => (
                <li className="script-line" key={line.id}>
                  <span className="script-line__order">{String(line.order).padStart(2, "0")}</span>
                  <div className="script-line__content">
                    {isEditing && draft ? (
                      <div className="script-line__edit-grid">
                        <label className="script-edit-field">
                          <span>화자</span>
                          <input aria-label={`${line.order}번 화자`} value={line.speaker} onChange={(event) => updateLine(index, { speaker: event.target.value })} />
                        </label>
                        <label className="script-edit-field">
                          <span>재생 시간 (밀리초)</span>
                          <input aria-label={`${line.order}번 재생 시간(밀리초)`} type="number" min="250" max="600000" step="50" value={line.duration_ms} onChange={(event) => updateLine(index, { duration_ms: Number(event.target.value) })} />
                        </label>
                        <label className="script-edit-field script-line__edit-field--text">
                          <span>내레이션</span>
                          <textarea aria-label={`${line.order}번 내레이션`} value={line.text} onChange={(event) => updateLine(index, { text: event.target.value })} rows={3} />
                        </label>
                        <label className="script-edit-field script-line__edit-field--intent">
                          <span>장면 의도</span>
                          <input aria-label={`${line.order}번 장면 의도`} value={line.scene_intent ?? ""} onChange={(event) => updateLine(index, { scene_intent: event.target.value || null })} />
                        </label>
                      </div>
                    ) : (
                      <>
                        <div className="script-line__meta">
                          <strong>{line.speaker}</strong>
                          <span><Clock size={15} aria-hidden="true" />{formatDuration(line.duration_ms)}</span>
                        </div>
                        <p>{line.text}</p>
                        {line.scene_intent ? <small>장면 의도 · {line.scene_intent}</small> : null}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {history.length > 1 ? (
            <section className="script-versions" aria-labelledby="script-versions-title">
              <div className="script-section-heading">
                <div><span>저장 기록</span><h2 id="script-versions-title">대본 버전</h2></div>
                <span>{history.length}개 저장본</span>
              </div>
              <ol className="script-version-list">
                {history.map((version, index) => {
                  const isActive = version.id === data?.id;
                  const isVersionActivating = isActivating && activatingVersionId === version.id;
                  return (
                    <li className="script-version-list__item" key={version.id}>
                      <div>
                        <strong>버전 {index + 1}{isActive ? " · 현재 사용 중" : ""}</strong>
                        <time dateTime={version.created_at}>{formatCreatedAt(version.created_at)}</time>
                      </div>
                      <button className="button button--secondary" type="button" onClick={() => void activateVersion(version.id)} disabled={isEditing || isActive || isActivating || isVersionActivating} aria-busy={isVersionActivating}>
                        {isActive ? "사용 중" : isVersionActivating ? "활성화 중…" : "이 버전 사용"}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          <div className="script-editor__next-step">
            <div>
              <span>다음 단계</span>
              <strong>대본을 확인했다면 컷 구성으로 이어가세요.</strong>
              <small>컷 보드에서 장면과 컷별 제작 정보를 구성할 수 있습니다.</small>
            </div>
            {onContinueToCuts ? (
              <button
                className="button button--primary"
                type="button"
                onClick={() => void onContinueToCuts()}
                disabled={isEditing || isSaving || isActivating || isContinuing}
                aria-busy={isContinuing}
              >
                {isContinuing ? "컷 구성으로 이동 중…" : "컷 구성으로 이동"}
              </button>
            ) : null}
          </div>
        </>
      ) : !isLoading ? (
        <section className="script-empty" aria-labelledby="script-empty-title">
          <FileText size={30} aria-hidden="true" />
          <h2 id="script-empty-title">아직 생성된 대본이 없습니다.</h2>
          <p>아이디어 단계에서 확정한 내용을 바탕으로 대본을 생성해 보세요.</p>
        </section>
      ) : null}
    </div>
  );
}

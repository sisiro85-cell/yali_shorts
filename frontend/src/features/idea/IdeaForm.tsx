import type { IdeaDraft, IdeaFormat, IdeaReferenceAsset, JobSummary } from "../../app/api";
import { FormatSelector } from "./FormatSelector";
import { HelpTooltip } from "./HelpTooltip";
import { ReferencePicker } from "./ReferencePicker";

export type IdeaFieldErrors = Partial<Record<"topic" | "source_text" | "formats" | "reference_asset_ids", string>>;

export function IdeaForm({
  draft,
  assets,
  errors,
  generationJob,
  activeVersion,
  isSaving,
  isSubmitting,
  notice,
  onChange,
  onSave,
  onGenerate,
  onCancel,
  onContinue,
  onAddReference,
}: {
  draft: Pick<IdeaDraft, "topic" | "source_text" | "formats" | "reference_asset_ids">;
  assets: IdeaReferenceAsset[];
  errors: IdeaFieldErrors;
  generationJob: JobSummary | null;
  activeVersion: { headline: string; summary: string; key_points: string[] } | null;
  isSaving: boolean;
  isSubmitting: boolean;
  notice: string;
  onChange: (next: Partial<typeof draft>) => void;
  onSave: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onAddReference: (file: File) => Promise<void>;
}) {
  const sourceCount = draft.source_text.length;
  const jobStatus = generationJob?.status;
  const isActiveJob = jobStatus === "queued" || jobStatus === "running";
  const statusLabel = jobStatus === "queued" ? "생성 대기 중" : jobStatus === "running" ? "생성 중" : jobStatus === "cancelled" ? "취소됨" : jobStatus === "failed" ? "오류" : jobStatus === "completed" ? "완료" : "";

  return (
    <form className="idea-form" onSubmit={(event) => { event.preventDefault(); onGenerate(); }}>
      <div className="idea-form__fields">
        <div className="idea-field">
          <div className="idea-field__label"><label htmlFor="idea-topic">주제 / 키워드</label><span className="idea-required" aria-hidden="true">*</span></div>
          <input
            id="idea-topic"
            name="topic"
            type="text"
            value={draft.topic}
            maxLength={500}
            aria-invalid={Boolean(errors.topic)}
            aria-describedby={errors.topic ? "idea-topic-error" : undefined}
            placeholder="예) 마케팅 트렌드, 시간 관리 팁, 다이어트 식단"
            onChange={(event) => onChange({ topic: event.target.value })}
          />
          {errors.topic ? <p className="idea-field__error" id="idea-topic-error" role="alert">{errors.topic}</p> : null}
        </div>

        <div className="idea-field">
          <div className="idea-field__heading">
            <label htmlFor="idea-source">출처 / 참고 내용</label>
            <HelpTooltip label="출처 도움말" description="아이디어 생성에 참고할 원문이나 핵심 내용을 입력합니다." />
          </div>
          <textarea
            id="idea-source"
            name="source_text"
            value={draft.source_text}
            maxLength={100000}
            aria-invalid={Boolean(errors.source_text)}
            aria-describedby={errors.source_text ? "idea-source-error" : "idea-source-count"}
            placeholder={"아이디어 생성에 참고할 배경 정보나 핵심 내용을 입력하세요.\n예) 타깃 시청자, 전달하고 싶은 메시지, 참고할 통계나 사례 등"}
            onChange={(event) => onChange({ source_text: event.target.value })}
          />
          <div className="idea-field__footer">
            {errors.source_text ? <p className="idea-field__error" id="idea-source-error" role="alert">{errors.source_text}</p> : <span />}
            <span id="idea-source-count">{sourceCount.toLocaleString("ko-KR")}/100,000</span>
          </div>
        </div>

        <FormatSelector value={draft.formats} onChange={(formats: IdeaFormat[]) => onChange({ formats })} error={errors.formats} />
        <ReferencePicker assets={assets} selectedIds={draft.reference_asset_ids} onChange={(reference_asset_ids) => onChange({ reference_asset_ids })} onAdd={onAddReference} error={errors.reference_asset_ids} />
      </div>

      {generationJob ? (
        <section className={`idea-generation-status idea-generation-status--${jobStatus}`} role={jobStatus === "failed" ? "alert" : "status"} aria-live="polite">
          <div>
            <strong>{statusLabel}</strong>
            {jobStatus === "failed" && generationJob.error ? <p>{generationJob.error}</p> : null}
            {jobStatus === "queued" || jobStatus === "running" ? <p>입력 내용은 계속 수정할 수 있습니다. 작업 큐에서 백그라운드로 처리합니다.</p> : null}
          </div>
          {isActiveJob ? <button className="button button--secondary" type="button" onClick={onCancel}>생성 취소</button> : null}
        </section>
      ) : null}

      {activeVersion ? (
        <section className="idea-result" aria-labelledby="idea-result-title">
          <span className="idea-result__eyebrow">생성 완료</span>
          <h2 id="idea-result-title">{activeVersion.headline}</h2>
          <p>{activeVersion.summary}</p>
          <button className="button button--secondary" type="button" onClick={onContinue}>대본 단계로 이어서 작업</button>
        </section>
      ) : null}

      {notice ? <p className="idea-notice" role="status" aria-live="polite">{notice}</p> : null}

      <div className="idea-form__actions">
        <button className="button button--secondary" type="button" onClick={onSave} disabled={isSaving}>
          임시 저장
        </button>
        <button className="button button--primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "생성 요청 중…" : "아이디어 생성 시작"}
        </button>
      </div>
    </form>
  );
}

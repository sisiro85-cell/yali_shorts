import { useEffect, useRef, useState } from "react";
import { CaretRight, Lightbulb, Sparkle } from "@phosphor-icons/react";
import { ApiError, apiClient, type IdeaDraft, type IdeaPageData, type IdeaFormat, type JobSummary, type WorkflowStage } from "../app/api";
import { navigateTo, projectScriptPath } from "../app/navigation";
import { AppShell } from "../components/layout/AppShell";
import { IdeaForm, type IdeaFieldErrors } from "../features/idea/IdeaForm";
import { formatLabel } from "../features/idea/FormatSelector";

const EMPTY_DRAFT: Pick<IdeaDraft, "topic" | "source_text" | "formats" | "reference_asset_ids"> = {
  topic: "",
  source_text: "",
  formats: [],
  reference_asset_ids: [],
};

function ideaInputFrom(data: IdeaPageData) {
  return {
    topic: data.draft.topic,
    source_text: data.draft.source_text,
    formats: data.draft.formats,
    reference_asset_ids: data.draft.reference_asset_ids,
  };
}

function ideaJobFrom(data: IdeaPageData): JobSummary | null {
  return data.generation_job ?? null;
}

function IdeaGuide({ format }: { format: IdeaFormat | null }) {
  return (
    <section className="idea-guide" aria-labelledby="idea-guide-title">
      <div className="idea-guide__heading">
        <Lightbulb size={22} aria-hidden="true" />
        <h2 id="idea-guide-title">생성 안내</h2>
      </div>
      <ol className="idea-guide__steps">
        <li><span>1</span><p>구체적인 주제와 배경 정보를 입력할수록 더 적합한 아이디어가 생성됩니다.</p></li>
        <li><span>2</span><p>참고 자료를 추가하면 콘텐츠의 신뢰도와 완성도가 높아집니다.</p></li>
        <li><span>3</span><p>생성된 아이디어는 다음 단계에서 다듬고 발전시킬 수 있습니다.</p></li>
      </ol>
      <div className="idea-guide__format">
        <strong>선택된 출력 형식</strong>
        {format ? <p><span className="idea-guide__format-icon" aria-hidden="true"><CaretRight size={18} /></span><b>{formatLabel(format)}</b><small>{format === "card_news" ? "정사각 1080×1080 · 5~10장 권장" : `세로 9:16 · ${format === "reels" ? "15~90초" : "15~60초"} 권장`}</small></p> : <p className="idea-guide__muted">형식을 선택해 주세요.</p>}
      </div>
      <div className="idea-guide__callout">
        <Sparkle size={19} aria-hidden="true" />
        <div><strong>AI 생성 요청은 작업 큐에서 실행됩니다.</strong><p>생성 중에도 입력을 수정하고 상태를 확인할 수 있습니다.</p></div>
      </div>
    </section>
  );
}

export function IdeaPage({ projectId }: { projectId: string }) {
  const [data, setData] = useState<IdeaPageData | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [generationJob, setGenerationJob] = useState<JobSummary | null>(null);
  const [errors, setErrors] = useState<IdeaFieldErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const generationEpoch = useRef(0);
  const [generationRevision, setGenerationRevision] = useState(0);

  function applyGenerationJob(job: JobSummary | null) {
    setGenerationJob(job);
  }

  function invalidateGenerationRequests() {
    generationEpoch.current += 1;
    setGenerationRevision((current) => current + 1);
  }

  useEffect(() => {
    let active = true;
    const epoch = generationEpoch.current;
    setIsLoading(true);
    apiClient.getIdeaPage(projectId).then((next) => {
      if (!active || epoch !== generationEpoch.current) return;
      setData(next);
      setDraft(ideaInputFrom(next));
      applyGenerationJob(ideaJobFrom(next));
      setNotice(next.draft.topic || next.draft.source_text || next.draft.formats.length ? "임시 저장한 내용을 불러왔습니다." : "");
      setPageError("");
    }).catch((error: unknown) => {
      if (active && epoch === generationEpoch.current) setPageError(error instanceof Error ? error.message : "아이디어 작업을 불러오지 못했습니다.");
    }).finally(() => { if (active && epoch === generationEpoch.current) setIsLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (!generationJob || !["queued", "running"].includes(generationJob.status)) return;
    let active = true;
    const epoch = generationEpoch.current;
    const timer = window.setInterval(() => {
      apiClient.getIdeaPage(projectId).then((next) => {
        if (!active || epoch !== generationEpoch.current) return;
        setData(next);
        applyGenerationJob(ideaJobFrom(next));
      }).catch(() => {
        if (active && epoch === generationEpoch.current) setPageError("생성 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.");
      });
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId, generationJob?.id, generationJob?.status, generationRevision]);

  function updateDraft(next: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...next }));
    setErrors((current) => {
      const updated = { ...current };
      for (const key of Object.keys(next) as Array<keyof typeof next>) delete updated[key as keyof IdeaFieldErrors];
      return updated;
    });
  }

  function errorFields(error: unknown): IdeaFieldErrors {
    if (!(error instanceof ApiError)) return {};
    const fields: IdeaFieldErrors = {};
    for (const item of error.details.errors ?? []) {
      const field = item.loc[item.loc.length - 1];
      if (field === "topic" || field === "source_text" || field === "formats" || field === "reference_asset_ids") fields[field] = item.msg;
    }
    return fields;
  }

  async function handleSave() {
    setIsSaving(true);
    setPageError("");
    try {
      const next = await apiClient.saveIdeaDraft(projectId, draft);
      setData(next);
      setDraft(ideaInputFrom(next));
      applyGenerationJob(ideaJobFrom(next));
      setNotice("임시 저장했습니다.");
    } catch (error) {
      setErrors(errorFields(error));
      setPageError(error instanceof Error ? error.message : "임시 저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleGenerate() {
    const nextErrors: IdeaFieldErrors = {};
    if (!draft.topic.trim()) nextErrors.topic = "주제 또는 키워드를 입력해 주세요.";
    if (!draft.formats.length) nextErrors.formats = "출력 형식을 하나 이상 선택해 주세요.";
    setErrors(nextErrors);
    setPageError("");
    if (Object.keys(nextErrors).length) return;
    invalidateGenerationRequests();
    setIsSubmitting(true);
    try {
      const accepted = await apiClient.generateIdea(projectId, draft);
      applyGenerationJob({ id: accepted.job_id, project_id: projectId, cut_id: null, kind: "idea.generate", status: accepted.status, progress: 0, error: null, retry_count: 0 });
      setNotice("아이디어 생성 요청이 작업 큐에 등록되었습니다.");
    } catch (error) {
      setErrors(errorFields(error));
      setPageError(error instanceof Error ? error.message : "아이디어 생성 요청에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!generationJob) return;
    invalidateGenerationRequests();
    try {
      const cancelled = await apiClient.cancelIdeaGeneration(projectId, generationJob.id);
      applyGenerationJob(cancelled);
      setNotice("생성 요청을 취소했습니다.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "생성 요청을 취소하지 못했습니다.");
    }
  }

  async function handleAddReference(file: File) {
    setPageError("");
    const next = await apiClient.uploadIdeaReferenceAsset(projectId, file);
    setData(next);
    setNotice("참고 자료를 새 앱 라이브러리에 등록했습니다.");
  }

  async function handleContinue() {
    try {
      await apiClient.updateProject(projectId, { stage: "script", status: "script" });
      navigateTo(projectScriptPath(projectId));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "다음 단계로 이동하지 못했습니다.");
    }
  }

  const projectTitle = data?.project_title ?? "새 프로젝트";
  const stage: WorkflowStage = data?.stage ?? "idea";
  const selectedFormat = draft.formats[0] ?? null;
  const activeVersion = data?.active_version ?? null;

  return (
    <AppShell
      projectName={projectTitle}
      stage={stage}
      panelOpen
      onPanelOpenChange={() => undefined}
      currentView="idea"
      projectId={projectId}
      ideaProjectId={projectId}
      contextPanel={<IdeaGuide format={selectedFormat} />}
      quickStart={null}
      showQuickStart={false}
    >
      <div className="idea-page">
        <div className="idea-page__heading">
          <div><h1>아이디어 만들기</h1><p>주제와 참고 자료를 입력하면 매력적인 숏폼 아이디어를 제안해 드립니다.</p></div>
          <span className="idea-page__step">1 / 5</span>
        </div>
        {isLoading ? <p className="idea-state" role="status">아이디어 작업을 불러오는 중입니다…</p> : pageError && !data ? <p className="idea-state idea-state--error" role="alert">{pageError}</p> : data ? <IdeaForm draft={draft} assets={data.reference_assets} errors={errors} generationJob={generationJob} activeVersion={activeVersion} isSaving={isSaving} isSubmitting={isSubmitting} notice={notice} onChange={updateDraft} onSave={handleSave} onGenerate={handleGenerate} onCancel={handleCancel} onContinue={handleContinue} onAddReference={handleAddReference} /> : null}
        {pageError && data ? <p className="idea-state idea-state--error" role="alert">{pageError}</p> : null}
      </div>
    </AppShell>
  );
}

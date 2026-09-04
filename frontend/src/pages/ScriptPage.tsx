import { useEffect, useRef, useState } from "react";
import { FileText, Lightbulb, Sparkle } from "@phosphor-icons/react";
import { apiClient, type CutBoardData, type CutBoardCut, type CutRegenerationOptions, type IdeaPageData, type JobSummary, type ScriptPageData, type ScriptVersionDraft, type WorkflowStage } from "../app/api";
import { navigateTo, projectIdeaPath, projectStagePath } from "../app/navigation";
import { AppShell } from "../components/layout/AppShell";
import { CutBoard } from "../features/cuts/CutBoard";
import type { CutAction } from "../features/cuts/CutCard";
import { DesignBoard } from "../features/design/DesignBoard";
import { ScriptEditor } from "../features/script/ScriptEditor";

export type StagePageStage = "script" | "cuts" | "design" | "output";

const STAGE_LABELS: Record<StagePageStage, string> = { script: "대본", cuts: "컷 구성", design: "디자인", output: "출력" };
const STAGE_NUMBERS: Record<StagePageStage, string> = { script: "2", cuts: "3", design: "4", output: "5" };

function ScriptGuide() {
  return (
    <section className="script-guide" aria-labelledby="script-guide-title">
      <div className="script-guide__heading">
        <FileText size={22} aria-hidden="true" />
        <h2 id="script-guide-title">대본 제작 안내</h2>
      </div>
      <ol className="script-guide__steps">
        <li><span>1</span><p>확정된 아이디어의 핵심 메시지를 확인합니다.</p></li>
        <li><span>2</span><p>후킹 문장, 본문, 행동 유도 문장으로 흐름을 만듭니다.</p></li>
        <li><span>3</span><p>내레이션 라인별 재생 시간을 확인한 뒤 다음 단계로 넘어갑니다.</p></li>
      </ol>
      <div className="script-guide__callout">
        <Sparkle size={19} aria-hidden="true" />
        <div><strong>Codex가 대본을 구성합니다.</strong><p>현재 로그인된 Codex 구독 또는 설정한 API provider를 사용합니다.</p></div>
      </div>
    </section>
  );
}

function CutGuide() {
  return (
    <section className="cut-guide" aria-labelledby="cut-guide-title">
      <div className="cut-guide__heading">
        <Sparkle size={22} aria-hidden="true" />
        <h2 id="cut-guide-title">컷 구성 안내</h2>
      </div>
      <ol className="cut-guide__steps">
        <li><span>1</span><p>활성 대본을 씬과 컷 단위로 나눕니다.</p></li>
        <li><span>2</span><p>각 컷의 내레이션, 자막, 이미지 프롬프트를 확인합니다.</p></li>
        <li><span>3</span><p>마음에 들지 않는 컷은 다음 단계에서 개별 재생성할 수 있습니다.</p></li>
      </ol>
      <div className="cut-guide__callout">
        <FileText size={19} aria-hidden="true" />
        <div><strong>컷 보드는 활성 대본 기준입니다.</strong><p>대본을 수정하면 기존 컷 보드는 최신 상태가 아니므로 다시 생성해야 합니다.</p></div>
      </div>
    </section>
  );
}

function DesignGuide() {
  return (
    <section className="cut-guide" aria-labelledby="design-guide-title">
      <div className="cut-guide__heading">
        <Sparkle size={22} aria-hidden="true" />
        <h2 id="design-guide-title">디자인 작업 안내</h2>
      </div>
      <ol className="cut-guide__steps">
        <li><span>1</span><p>컷 구성에서 연결된 이미지와 컷별 정보를 확인합니다.</p></li>
        <li><span>2</span><p>프롬프트를 수정하면 해당 컷만 새 이미지로 생성할 수 있습니다.</p></li>
        <li><span>3</span><p>모든 컷의 이미지가 준비되면 출력 단계로 이동합니다.</p></li>
      </ol>
      <div className="cut-guide__callout">
        <FileText size={19} aria-hidden="true" />
        <div><strong>이미지는 원본 비율로 표시됩니다.</strong><p>세로 쇼츠 이미지 전체를 잘라내지 않고 카드 안에서 그대로 확인합니다.</p></div>
      </div>
    </section>
  );
}

function findCut(board: CutBoardData | null, cutId: string) {
  for (const scene of board?.scenes ?? []) {
    const cut = scene.cuts.find((item) => item.id === cutId);
    if (cut) return cut;
  }
  return null;
}

function replaceCut(board: CutBoardData, cutId: string, update: (cut: CutBoardCut) => CutBoardCut): CutBoardData {
  return {
    ...board,
    scenes: board.scenes.map((scene) => ({
      ...scene,
      cuts: scene.cuts.map((cut) => (cut.id === cutId ? update(cut) : cut)),
    })),
  };
}

async function waitForJobCompletion(projectId: string, jobId: string, isCurrentOperation: () => boolean): Promise<JobSummary | null> {
  while (isCurrentOperation()) {
    const jobs = await apiClient.listJobs(projectId);
    if (!isCurrentOperation()) return null;
    const job = jobs.find((item) => item.id === jobId);
    if (job && job.status !== "queued" && job.status !== "running") return job;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
  }
  return null;
}

function StagePlaceholder({ projectId, stage, data }: { projectId: string; stage: StagePageStage; data: IdeaPageData | null }) {
  const stageLabel = STAGE_LABELS[stage];
  return (
    <div className="stage-placeholder">
      <div className="stage-placeholder__heading">
        <span>{STAGE_NUMBERS[stage]} / 5</span>
        <h1>{stageLabel} 단계</h1>
        <p>아이디어 결과가 다음 제작 단계로 연결되었습니다.</p>
      </div>
      {data?.active_version ? (
        <section className="stage-placeholder__result" aria-labelledby="script-source-title">
          <span className="idea-result__eyebrow">아이디어 원본</span>
          <h2 id="script-source-title">{data.active_version.headline}</h2>
          <p>{data.active_version.summary}</p>
        </section>
      ) : <p className="stage-placeholder__empty" role="status">아이디어 결과를 먼저 확정해 주세요.</p>}
      <p className="stage-placeholder__note"><Lightbulb size={18} aria-hidden="true" />{stageLabel} 편집 기능은 앞 단계 검증 후 연결됩니다.</p>
      <button className="button button--secondary" type="button" onClick={() => navigateTo(projectIdeaPath(projectId))}>아이디어로 돌아가기</button>
    </div>
  );
}

export function ScriptPage({ projectId, stage = "script" }: { projectId: string; stage?: StagePageStage }) {
  const [scriptData, setScriptData] = useState<ScriptPageData | null>(null);
  const [cutData, setCutData] = useState<CutBoardData | null>(null);
  const [ideaData, setIdeaData] = useState<IdeaPageData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isContinuingToCuts, setIsContinuingToCuts] = useState(false);
  const [isContinuingToDesign, setIsContinuingToDesign] = useState(false);
  const [isContinuingToOutput, setIsContinuingToOutput] = useState(false);
  const [isGeneratingAllImages, setIsGeneratingAllImages] = useState(false);
  const [bulkImageProgress, setBulkImageProgress] = useState<{ completed: number; total: number } | null>(null);
  const [bulkCutId, setBulkCutId] = useState<string | null>(null);
  const [activeCutAction, setActiveCutAction] = useState<{ cutId: string; kind: CutAction } | null>(null);
  const [cutJob, setCutJob] = useState<{ jobId: string; cutId: string; cutOrder: number } | null>(null);
  const pageOperationSequence = useRef(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setIsGenerating(false);
    setIsContinuingToCuts(false);
    setIsContinuingToDesign(false);
    setIsContinuingToOutput(false);
    setIsGeneratingAllImages(false);
    setBulkImageProgress(null);
    setBulkCutId(null);
    setActiveCutAction(null);
    setCutJob(null);
    setError("");
    setNotice("");
    if (stage === "script") setScriptData(null);
    else if (stage === "cuts" || stage === "design") setCutData(null);
    else setIdeaData(null);
    const request = stage === "script"
      ? apiClient.getScriptPage(projectId)
      : stage === "cuts" || stage === "design"
        ? apiClient.getCutBoard(projectId)
        : apiClient.getIdeaPage(projectId);
    request.then((next) => {
      if (!active) return;
      if (stage === "script") setScriptData(next as ScriptPageData);
      else if (stage === "cuts" || stage === "design") setCutData(next as CutBoardData);
      else setIdeaData(next as IdeaPageData);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "프로젝트를 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
      pageOperationSequence.current += 1;
    };
  }, [projectId, stage]);

  useEffect(() => {
    if ((stage !== "cuts" && stage !== "design") || cutJob === null) return;
    const activeJob = cutJob;
    let active = true;
    let checking = false;

    async function checkCutJob() {
      if (!active || checking) return;
      checking = true;
      try {
        const jobs = await apiClient.listJobs(projectId);
        if (!active) return;
        const job = jobs.find((item) => item.id === activeJob.jobId);
        if (!job || job.status === "queued" || job.status === "running") return;
        if (job.status === "completed") {
          const next = await apiClient.getCutBoard(projectId);
          if (!active) return;
          setCutData(next);
          setNotice(`컷 ${activeJob.cutOrder} ${stage === "design" ? "이미지 재생성" : "재생성"}을 완료했습니다.`);
          setCutJob(null);
        } else {
          setError(job.error ?? `컷 ${activeJob.cutOrder} ${stage === "design" ? "이미지 생성" : "재생성"}에 실패했습니다.`);
          setCutJob(null);
        }
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : `${stage === "design" ? "이미지 생성" : "컷 재생성"} 상태를 확인하지 못했습니다.`);
      } finally {
        checking = false;
      }
    }

    void checkCutJob();
    const timer = window.setInterval(() => void checkCutJob(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId, stage, cutJob?.jobId]);

  async function handleGenerate() {
    const requestSequence = pageOperationSequence.current + 1;
    pageOperationSequence.current = requestSequence;
    const isCurrentOperation = () => pageOperationSequence.current === requestSequence;
    setIsGenerating(true);
    setError("");
    setNotice("");
    try {
      const next = await apiClient.generateScript(projectId);
      if (!isCurrentOperation()) return;
      setScriptData(next);
      setNotice("대본을 생성했습니다. 내용을 확인해 주세요.");
    } catch (reason: unknown) {
      if (!isCurrentOperation()) return;
      setError(reason instanceof Error ? reason.message : "대본 생성에 실패했습니다.");
    } finally {
      if (isCurrentOperation()) setIsGenerating(false);
    }
  }

  async function handleGenerateCuts() {
    const requestSequence = pageOperationSequence.current + 1;
    pageOperationSequence.current = requestSequence;
    const isCurrentOperation = () => pageOperationSequence.current === requestSequence;
    setIsGenerating(true);
    setError("");
    setNotice("");
    try {
      const next = await apiClient.generateCuts(projectId);
      if (!isCurrentOperation()) return;
      setCutData(next);
      setNotice("컷 보드를 생성했습니다. 컷별 내용을 확인해 주세요.");
    } catch (reason: unknown) {
      if (!isCurrentOperation()) return;
      setError(reason instanceof Error ? reason.message : "컷 보드 생성에 실패했습니다.");
    } finally {
      if (isCurrentOperation()) setIsGenerating(false);
    }
  }

  async function handleSave(draft: ScriptVersionDraft) {
    const activeVersionId = scriptData?.active_version?.id;
    if (!activeVersionId) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await apiClient.updateScriptVersion(projectId, activeVersionId, draft);
      setScriptData(next);
      setNotice("새 대본 버전을 저장했습니다.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "대본 저장에 실패했습니다.");
      throw reason;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleActivate(versionId: string) {
    setIsActivating(true);
    setError("");
    setNotice("");
    try {
      const next = await apiClient.activateScriptVersion(projectId, versionId);
      setScriptData(next);
      setNotice("선택한 대본 버전을 활성화했습니다.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "대본 버전을 활성화하지 못했습니다.");
      throw reason;
    } finally {
      setIsActivating(false);
    }
  }

  async function handleContinueToCuts() {
    setIsContinuingToCuts(true);
    setError("");
    setNotice("");
    try {
      await apiClient.updateProject(projectId, { stage: "cuts", status: "cuts" });
      navigateTo(projectStagePath(projectId, "cuts"));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "컷 구성으로 이동하지 못했습니다.");
    } finally {
      setIsContinuingToCuts(false);
    }
  }

  async function handleContinueToDesign() {
    setIsContinuingToDesign(true);
    setError("");
    setNotice("");
    try {
      await apiClient.updateProject(projectId, { stage: "design", status: "design" });
      navigateTo(projectStagePath(projectId, "design"));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "디자인 단계로 이동하지 못했습니다.");
    } finally {
      setIsContinuingToDesign(false);
    }
  }

  async function handleContinueToOutput() {
    setIsContinuingToOutput(true);
    setError("");
    setNotice("");
    try {
      await apiClient.updateProject(projectId, { stage: "output", status: "output" });
      navigateTo(projectStagePath(projectId, "output"));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "출력 단계로 이동하지 못했습니다.");
    } finally {
      setIsContinuingToOutput(false);
    }
  }

  async function handleRegenerateCut(cutId: string, options: CutRegenerationOptions) {
    const cut = findCut(cutData, cutId);
    if (!cut) return;
    setActiveCutAction({ cutId, kind: "regenerate" });
    setError("");
    setNotice("");
    try {
      const accepted = await apiClient.regenerateCut(projectId, cutId, options);
      setCutJob({ jobId: accepted.job_id, cutId, cutOrder: cut.order });
      setNotice(`컷 ${cut.order} ${stage === "design" ? "이미지 생성" : "재생성"} 요청을 작업 큐에 등록했습니다.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : `${stage === "design" ? "이미지 생성" : "컷 재생성"} 요청에 실패했습니다.`);
    } finally {
      setActiveCutAction(null);
    }
  }

  async function handleGenerateAllImages(cutIds: string[]) {
    if (isGeneratingAllImages) return;
    const cuts = Array.from(new Set(cutIds))
      .map((cutId) => findCut(cutData, cutId))
      .filter((cut): cut is CutBoardCut => Boolean(cut));
    if (cuts.length === 0) return;

    const requestSequence = pageOperationSequence.current + 1;
    pageOperationSequence.current = requestSequence;
    const isCurrentOperation = () => pageOperationSequence.current === requestSequence;
    setIsGeneratingAllImages(true);
    setBulkImageProgress({ completed: 0, total: cuts.length });
    setError("");
    setNotice("");
    try {
      for (const [index, cut] of cuts.entries()) {
        if (!isCurrentOperation()) return;
        setBulkCutId(cut.id);
        setNotice(`컷 ${cut.order} 이미지 생성 중입니다. (${index + 1}/${cuts.length})`);
        const accepted = await apiClient.regenerateCut(projectId, cut.id);
        if (!isCurrentOperation()) return;
        const job = await waitForJobCompletion(projectId, accepted.job_id, isCurrentOperation);
        if (!job) return;
        if (job.status !== "completed") {
          throw new Error(job.error ?? `컷 ${cut.order} 이미지 생성에 실패했습니다.`);
        }
        setBulkImageProgress({ completed: index + 1, total: cuts.length });
      }

      const next = await apiClient.getCutBoard(projectId);
      if (!isCurrentOperation()) return;
      setCutData(next);
      setNotice("전체 이미지 생성을 완료했습니다.");
    } catch (reason: unknown) {
      if (isCurrentOperation()) setError(reason instanceof Error ? reason.message : "전체 이미지 생성에 실패했습니다.");
    } finally {
      if (isCurrentOperation()) {
        setIsGeneratingAllImages(false);
        setBulkCutId(null);
        setBulkImageProgress(null);
      }
    }
  }

  async function handleToggleCutLock(cutId: string, nextLocked: boolean) {
    const cut = findCut(cutData, cutId);
    if (!cut) return;
    setActiveCutAction({ cutId, kind: "lock" });
    setError("");
    setNotice("");
    try {
      const result = nextLocked
        ? await apiClient.lockCut(projectId, cutId)
        : await apiClient.unlockCut(projectId, cutId);
      setCutData((current) => current ? replaceCut(current, cutId, (item) => ({ ...item, locked: result.locked })) : current);
      setNotice(`컷 ${cut.order} ${result.locked ? "잠금" : "잠금 해제"}을 완료했습니다.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "컷 잠금 상태를 변경하지 못했습니다.");
    } finally {
      setActiveCutAction(null);
    }
  }

  async function handleActivateCutVersion(cutId: string, versionId: string) {
    const cut = findCut(cutData, cutId);
    if (!cut) return;
    const versionIndex = cut.versions.findIndex((version) => version.id === versionId);
    setActiveCutAction({ cutId, kind: "version" });
    setError("");
    setNotice("");
    try {
      const updated = await apiClient.activateCutVersion(projectId, cutId, versionId);
      setCutData((current) => current ? replaceCut(current, cutId, () => updated) : current);
      setNotice(`컷 ${cut.order} 버전 ${versionIndex + 1}을 활성화했습니다.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "컷 버전을 활성화하지 못했습니다.");
    } finally {
      setActiveCutAction(null);
    }
  }

  const projectTitle = (stage === "script" ? scriptData?.project_title : stage === "cuts" || stage === "design" ? cutData?.project_title : ideaData?.project_title) ?? "프로젝트";
  const currentStage: WorkflowStage = stage;
  const busyCutId = bulkCutId ?? cutJob?.cutId ?? activeCutAction?.cutId ?? null;
  const busyCutAction: CutAction | null = bulkCutId ? "regenerate" : cutJob ? "regenerate" : activeCutAction?.kind ?? null;

  return (
    <AppShell
      projectName={projectTitle}
      stage={currentStage}
      projectId={projectId}
      panelOpen
      onPanelOpenChange={() => undefined}
      currentView={stage}
      ideaProjectId={projectId}
      scriptProjectId={projectId}
      contextPanel={stage === "script" ? <ScriptGuide /> : stage === "cuts" ? <CutGuide /> : stage === "design" ? <DesignGuide /> : <section className="stage-guide" aria-labelledby="stage-guide-title"><FileText size={24} aria-hidden="true" /><h2 id="stage-guide-title">{STAGE_LABELS[stage]} 단계 안내</h2><p>앞 단계의 결과를 바탕으로 {STAGE_LABELS[stage]}을(를) 구성하는 화면입니다.</p></section>}
      quickStart={null}
      showQuickStart={false}
    >
      {stage === "script" ? <ScriptEditor data={scriptData?.active_version ?? null} versions={scriptData?.versions} isLoading={isLoading} isGenerating={isGenerating} isSaving={isSaving} isActivating={isActivating} isContinuing={isContinuingToCuts} error={error} notice={notice} onGenerate={handleGenerate} onSave={handleSave} onActivate={handleActivate} onContinueToCuts={handleContinueToCuts} /> : stage === "cuts" ? <CutBoard data={cutData} isLoading={isLoading} isGenerating={isGenerating} isContinuing={isContinuingToDesign} error={error} notice={notice} onGenerate={handleGenerateCuts} onBackToIdeas={() => navigateTo(projectIdeaPath(projectId))} onContinueToDesign={handleContinueToDesign} busyCutId={busyCutId} busyCutAction={busyCutAction} onRegenerateCut={handleRegenerateCut} onToggleCutLock={handleToggleCutLock} onActivateCutVersion={handleActivateCutVersion} /> : stage === "design" ? <DesignBoard projectId={projectId} data={cutData} isLoading={isLoading} error={error} notice={notice} busyCutId={busyCutId} busyCutAction={busyCutAction} onRegenerate={handleRegenerateCut} onGenerateAll={handleGenerateAllImages} isGeneratingAll={isGeneratingAllImages} bulkProgress={bulkImageProgress} onBackToCuts={() => navigateTo(projectStagePath(projectId, "cuts"))} onContinueToOutput={handleContinueToOutput} isContinuing={isContinuingToOutput} /> : <StagePlaceholder projectId={projectId} stage={stage} data={ideaData} />}
    </AppShell>
  );
}

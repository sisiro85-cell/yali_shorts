import { useEffect, useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { apiClient, type JobSummary, type ProjectSummary } from "../app/api";
import { navigateTo, projectStagePath } from "../app/navigation";
import { AppShell } from "../components/layout/AppShell";
import { ContextPanel } from "../components/layout/ContextPanel";
import { QuickStartBar } from "../components/layout/QuickStartBar";
import { ProjectRow } from "../features/home/ProjectRow";
import { ProgressSteps } from "../features/home/ProgressSteps";

const checklistRows = [
  ["아이디어", "주제 확정 및 레퍼런스 수집"],
  ["대본", "대본 확정"],
  ["컷 구성", "컷별 이미지와 자막 구성"],
  ["디자인", "자막 스타일 및 레이아웃"],
  ["출력", "출력 형식 설정 후 렌더링"],
] as const;
const stageIndexes = { idea: 0, script: 1, cuts: 2, design: 3, output: 4, completed: 5, failed: -1 } as const;

export function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]); const [jobs, setJobs] = useState<JobSummary[]>([]); const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null); const [isLoading, setIsLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [panelOpen, setPanelOpen] = useState(true); const [notice, setNotice] = useState(""); const [isCreatingProject, setIsCreatingProject] = useState(false); const [projectToDelete, setProjectToDelete] = useState<ProjectSummary | null>(null); const [isDeletingProject, setIsDeletingProject] = useState(false);
  useEffect(() => { let active = true; Promise.all([apiClient.listProjects(), apiClient.listJobs()]).then(([nextProjects, nextJobs]) => { if (!active) return; setProjects(nextProjects); setJobs(nextJobs); setSelectedProject(nextProjects[0] ?? null); }).catch(() => { if (active) setError("프로젝트 데이터를 불러오지 못했습니다. 백엔드 연결을 확인해 주세요."); }).finally(() => { if (active) setIsLoading(false); }); return () => { active = false; }; }, []);
  const projectName = selectedProject?.title ?? "프로젝트 선택"; const stage = selectedProject?.stage ?? "idea";
  const selectedProjectPath = selectedProject ? projectStagePath(selectedProject.id, selectedProject.stage) : "/";

  function handleRecentProjectAction(project: ProjectSummary) {
    setSelectedProject(project);
    if (project.stage !== "idea") navigateTo(projectStagePath(project.id, project.stage));
  }

  async function handleCreateProject() {
    setIsCreatingProject(true);
    setError(null);
    try {
      const project = await apiClient.createProject("새 프로젝트");
      navigateTo(projectStagePath(project.id, project.stage));
    } catch {
      setError("새 프로젝트를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function handleDeleteProject() {
    if (!projectToDelete || isDeletingProject) return;
    const deletedProject = projectToDelete;
    setIsDeletingProject(true);
    setError(null);
    try {
      await apiClient.deleteProject(deletedProject.id);
      const remainingProjects = projects.filter((project) => project.id !== deletedProject.id);
      setProjects(remainingProjects);
      setSelectedProject((current) => current?.id === deletedProject.id ? remainingProjects[0] ?? null : current);
      setProjectToDelete(null);
      setNotice(`${deletedProject.title} 프로젝트를 삭제했습니다.`);
    } catch {
      setError("프로젝트를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsDeletingProject(false);
    }
  }

  const activeChecklistIndex = stageIndexes[selectedProject?.status ?? "idea"];
  return (
    <AppShell
      projectName={projectName}
      projectId={selectedProject?.id}
      stage={stage}
      projects={isLoading || error ? undefined : projects}
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      currentView="home"
      contextPanel={<ContextPanel project={selectedProject} jobs={jobs} expanded={panelOpen} onExpandedChange={setPanelOpen} />}
      quickStart={<QuickStartBar onAction={(label) => setNotice(`${label} 기능은 다음 화면에서 이어집니다.`)} />}
    >
      <div className="home-page">
        <div className="home-page__heading">
          <div><p>홈</p><h1>작업 공간</h1></div>
          <button className="button button--secondary" type="button" onClick={handleCreateProject} disabled={isCreatingProject}>
            <Plus size={17} aria-hidden="true" />새 프로젝트
          </button>
        </div>
        {notice && <p className="sr-notice" aria-live="polite">{notice}</p>}
        {isLoading ? <p className="home-state" role="status">프로젝트를 불러오는 중입니다…</p> : error ? <p className="home-state home-state--error" role="alert">{error}</p> : <>
          <section className="home-section" aria-labelledby="recent-projects">
            <div className="section-heading"><h2 id="recent-projects">최근 프로젝트</h2><button type="button" className="text-button">전체 보기</button></div>
            {projects.length ? <div className="project-list">{projects.slice(0, 3).map((project) => <ProjectRow project={project} selected={project.id === selectedProject?.id} onSelect={handleRecentProjectAction} onDelete={setProjectToDelete} key={project.id} />)}</div> : <p className="home-state">최근 프로젝트가 없습니다. 새 프로젝트로 시작해 보세요.</p>}
          </section>
          {selectedProject && <section className="home-section continue-work" aria-labelledby="continue-work">
            <div className="section-heading"><h2 id="continue-work">이어갈 작업</h2><button type="button" className="text-button">전체 보기</button></div>
            <article className="continue-card">
              <div className="continue-card__intro"><h3>{selectedProject.title}</h3><p>수정 {new Date(selectedProject.updated_at).toLocaleString("ko-KR")}</p></div>
              <ProgressSteps stage={selectedProject.stage} />
              {selectedProject.status === "failed" && <p className="continue-card__failure" role="status">이전 제작 단계에서 오류가 발생했습니다. 작업 큐에서 실패 원인을 확인해 주세요.</p>}
              <div className="continue-card__checklist">{checklistRows.map(([label, detail], index) => { const complete = activeChecklistIndex > index; const current = activeChecklistIndex === index; const className = complete ? "is-complete" : current ? "is-active" : ""; return <p className={className} key={label}><span>{complete ? "✓" : index + 1}</span> {label} <small>{current && label === "컷 구성" ? `컷 ${selectedProject.cut_count}개` : complete ? "완료" : detail}</small></p>; })}</div>
              <button className="button button--primary" type="button" onClick={() => navigateTo(selectedProjectPath)}>이어서 작업</button>
            </article>
          </section>}
        </>}
      </div>
      {projectToDelete && <div className="project-delete-dialog__backdrop">
        <section className="project-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="project-delete-title">
          <h2 id="project-delete-title">프로젝트 삭제 확인</h2>
          <p><strong>{projectToDelete.title}</strong> 프로젝트를 삭제할까요?</p>
          <p className="project-delete-dialog__warning">프로젝트의 대본, 컷, 미디어 등 저장된 데이터가 함께 삭제됩니다.</p>
          <div className="project-delete-dialog__actions">
            <button className="button button--secondary" type="button" onClick={() => setProjectToDelete(null)} disabled={isDeletingProject}>취소</button>
            <button className="button button--danger" type="button" onClick={handleDeleteProject} disabled={isDeletingProject}>{isDeletingProject ? "삭제 중…" : "삭제"}</button>
          </div>
        </section>
      </div>}
    </AppShell>
  );
}

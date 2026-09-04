import { useEffect, useRef, useState } from "react";
import { Bell, CaretDown, FileText, Lightbulb, Package, PaintBrush, Scissors, UserCircle } from "@phosphor-icons/react";
import { apiClient, type ProjectSummary, type WorkflowStage } from "../../app/api";
import { navigateTo, projectStagePath } from "../../app/navigation";

const workflow = [{ id: "idea", label: "아이디어", icon: Lightbulb }, { id: "script", label: "대본", icon: FileText }, { id: "cuts", label: "컷 구성", icon: Scissors }, { id: "design", label: "디자인", icon: PaintBrush }, { id: "output", label: "출력", icon: Package }] as const;
const stageIndex: Record<WorkflowStage, number> = { idea: 0, script: 1, cuts: 2, design: 3, output: 4, completed: 5, failed: 0 };
const stageLabels: Record<WorkflowStage, string> = { idea: "아이디어", script: "대본", cuts: "컷 구성", design: "디자인", output: "출력", completed: "완료", failed: "오류" };

function projectProgressLabel(project: ProjectSummary) {
  if (project.stage === "completed") return "완료";
  if (project.stage === "failed") return "확인 필요";
  return `${stageLabels[project.stage]} · ${project.progress}%`;
}

function projectListMatch(project: ProjectSummary, projectId: string | undefined, projectName: string) {
  return projectId ? project.id === projectId : project.title === projectName;
}

export function TopWorkflow({ projectName, projectId, stage, projects }: { projectName: string; projectId?: string; stage: WorkflowStage; projects?: ProjectSummary[] }) {
  const currentIndex = stageIndex[stage];
  const [isOpen, setIsOpen] = useState(false);
  const [loadedProjects, setLoadedProjects] = useState<ProjectSummary[] | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectLoadError, setProjectLoadError] = useState("");
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);
  const projectOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const availableProjects = projects ?? loadedProjects ?? [];
  const currentProjectIndex = availableProjects.findIndex((project) => projectListMatch(project, projectId, projectName));

  async function loadProjects() {
    setIsLoadingProjects(true);
    setProjectLoadError("");
    try {
      setLoadedProjects(await apiClient.listProjects());
    } catch {
      setProjectLoadError("프로젝트 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoadingProjects(false);
    }
  }

  function closePicker(restoreFocus = false) {
    setIsOpen(false);
    if (restoreFocus) pickerButtonRef.current?.focus();
  }

  function openPicker() {
    setIsOpen(true);
    if (projects === undefined && loadedProjects === null && !isLoadingProjects) void loadProjects();
  }

  function togglePicker() {
    if (isOpen) closePicker();
    else openPicker();
  }

  function focusProject(index: number) {
    if (!availableProjects.length) return;
    const nextIndex = (index + availableProjects.length) % availableProjects.length;
    projectOptionRefs.current[nextIndex]?.focus();
  }

  function selectProject(project: ProjectSummary) {
    closePicker();
    navigateTo(projectStagePath(project.id, project.stage));
  }

  useEffect(() => {
    if (!isOpen || !availableProjects.length) return;
    const index = currentProjectIndex >= 0 ? currentProjectIndex : 0;
    projectOptionRefs.current[index]?.focus();
  }, [availableProjects.length, currentProjectIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!pickerWrapRef.current?.contains(event.target as Node)) closePicker();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker(true);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handlePickerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!isOpen) {
      openPicker();
      return;
    }
    focusProject(currentProjectIndex >= 0 ? currentProjectIndex + (event.key === "ArrowDown" ? 1 : -1) : 0);
  }

  function handleProjectKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number, project: ProjectSummary) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusProject(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      focusProject(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusProject(availableProjects.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectProject(project);
    }
  }

  return <header className="top-workflow"><div className="project-picker-wrap" ref={pickerWrapRef}><button className="project-picker" ref={pickerButtonRef} type="button" aria-label="현재 프로젝트 선택" aria-expanded={isOpen} aria-haspopup="listbox" aria-controls="project-picker-list" onClick={togglePicker} onKeyDown={handlePickerKeyDown}><strong>{projectName}</strong><CaretDown size={16} aria-hidden="true" /></button>{isOpen && <div className="project-picker-menu" id="project-picker-list" role="listbox" aria-label="프로젝트 목록"><div className="project-picker-menu__heading"><strong>프로젝트 목록</strong><span>{availableProjects.length}개</span></div>{isLoadingProjects ? <p className="project-picker-menu__state" role="status">프로젝트를 불러오는 중입니다…</p> : projectLoadError ? <div className="project-picker-menu__state project-picker-menu__state--error" role="alert"><p>{projectLoadError}</p><button type="button" onClick={() => void loadProjects()}>다시 시도</button></div> : availableProjects.length ? availableProjects.map((project, index) => { const isCurrent = index === currentProjectIndex; return <button className={`project-picker-option${isCurrent ? " project-picker-option--current" : ""}`} ref={(element) => { projectOptionRefs.current[index] = element; }} type="button" role="option" aria-selected={isCurrent} key={project.id} onClick={() => selectProject(project)} onKeyDown={(event) => handleProjectKeyDown(event, index, project)}><span className="project-picker-option__title">{project.title}</span><span className="project-picker-option__meta">{projectProgressLabel(project)}{project.scene_count || project.cut_count ? ` · 컷 ${project.cut_count}개` : ""}</span></button>; }) : <p className="project-picker-menu__state">저장된 프로젝트가 없습니다.</p>}</div>}</div><ol className="workflow" aria-label="제작 진행 단계">{workflow.map((step, index) => { const StepIcon = step.icon; const state = index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming"; return <li className={`workflow__step workflow__step--${state}`} key={step.id} aria-current={state === "current" ? "step" : state === "complete" ? "true" : undefined}><span className="workflow__icon">{state === "complete" ? "✓" : <StepIcon size={18} weight="regular" aria-hidden="true" />}</span><span>{step.label}</span></li>; })}</ol><div className="top-workflow__tools"><button type="button" className="icon-button" aria-label="알림"><Bell size={21} weight="regular" aria-hidden="true" /></button><button type="button" className="icon-button" aria-label="계정"><UserCircle size={23} weight="regular" aria-hidden="true" /></button></div></header>;
}

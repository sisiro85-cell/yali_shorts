import { useEffect, useRef, type ReactNode } from "react";
import { CaretLeft } from "@phosphor-icons/react";
import type { ProjectSummary, WorkflowStage } from "../../app/api";
import type { RouteView } from "./Sidebar";
import { Sidebar } from "./Sidebar";
import { TopWorkflow } from "./TopWorkflow";

interface AppShellProps {
  projectName: string;
  stage: WorkflowStage;
  children: ReactNode;
  contextPanel: ReactNode;
  quickStart: ReactNode;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  currentView?: RouteView;
  projectId?: string;
  projects?: ProjectSummary[];
  ideaProjectId?: string;
  scriptProjectId?: string;
  showQuickStart?: boolean;
}

export function AppShell({
  projectName,
  stage,
  children,
  contextPanel,
  quickStart,
  panelOpen,
  onPanelOpenChange,
  currentView = "home",
  projectId,
  projects,
  ideaProjectId,
  scriptProjectId,
  showQuickStart = true,
}: AppShellProps) {
  const reopenButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!panelOpen) reopenButtonRef.current?.focus(); }, [panelOpen]);
  return <div className={`app-shell${panelOpen ? "" : " app-shell--context-collapsed"}${showQuickStart ? "" : " app-shell--no-quickstart"}${stage === "video_settings" ? " app-shell--video-settings" : ""}`}><Sidebar currentView={currentView} projectId={projectId} ideaProjectId={ideaProjectId} scriptProjectId={scriptProjectId} /><TopWorkflow projectName={projectName} projectId={projectId} stage={stage} projects={projects} /><main className="app-shell__main" id="home">{children}</main><aside className="app-shell__context" aria-label="작업 컨텍스트" aria-hidden={!panelOpen}>{contextPanel}</aside>{!panelOpen && <button className="app-shell__context-reopen icon-button" ref={reopenButtonRef} type="button" aria-label="우측 패널 펼치기" onClick={() => onPanelOpenChange(true)}><CaretLeft size={17} aria-hidden="true" /></button>}{showQuickStart ? <footer className="app-shell__quickstart">{quickStart}</footer> : null}</div>;
}

import { Archive, ChartBar, FileText, Folder, GearSix, GridFour, House, Image, Lightbulb, ListChecks, PaperPlaneTilt, Sparkle, SquaresFour, Tag, UserCircle, VideoCamera } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { navigateTo, projectIdeaPath, projectScriptPath, projectStagePath } from "../../app/navigation";
import type { WorkflowStage } from "../../app/api";

export type RouteView = "home" | "idea" | "script" | "cuts" | "design" | "output";

type NavigationItem = { label: string; icon: Icon; href: string; active?: boolean };
type NavigationGroup = { label: string; items: NavigationItem[] };

function buildGroups(currentView: RouteView, projectId?: string, ideaProjectId?: string, scriptProjectId?: string): NavigationGroup[] {
  const activeProjectId = projectId ?? ideaProjectId ?? scriptProjectId;
  const ideaHref = activeProjectId ? projectIdeaPath(activeProjectId) : "#아이디어";
  const scriptHref = activeProjectId ? projectScriptPath(activeProjectId) : "#대본";
  const stageHref = (stage: WorkflowStage, fallback: string) => activeProjectId ? projectStagePath(activeProjectId, stage) : fallback;

  return [
    { label: "홈", items: [{ label: "홈", icon: House, href: "/", active: currentView === "home" }] },
    {
      label: "제작",
      items: [
        { label: "아이디어", icon: Lightbulb, href: ideaHref, active: currentView === "idea" },
        { label: "대본", icon: FileText, href: scriptHref, active: currentView === "script" },
        { label: "스토리보드", icon: GridFour, href: stageHref("cuts", "#스토리보드"), active: currentView === "cuts" },
        { label: "디자인", icon: Sparkle, href: stageHref("design", "#디자인"), active: currentView === "design" },
        { label: "결과물", icon: Archive, href: stageHref("output", "#결과물"), active: currentView === "output" },
      ],
    },
    { label: "라이브러리", items: [{ label: "자료", icon: Folder, href: "#자료" }, { label: "캐릭터", icon: UserCircle, href: "#캐릭터" }, { label: "브랜드", icon: Tag, href: "#브랜드" }, { label: "템플릿", icon: SquaresFour, href: "#템플릿" }, { label: "미디어", icon: Image, href: "#미디어" }] },
    { label: "운영", items: [{ label: "발행", icon: PaperPlaneTilt, href: "#발행" }, { label: "예약", icon: VideoCamera, href: "#예약" }, { label: "성과", icon: ChartBar, href: "#성과" }] },
    { label: "시스템", items: [{ label: "AI", icon: Sparkle, href: "#AI" }, { label: "작업 큐", icon: ListChecks, href: "#작업 큐" }, { label: "설정", icon: GearSix, href: "#설정" }] },
  ];
}

function handleLinkClick(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href.startsWith("/")) {
    return;
  }

  event.preventDefault();
  navigateTo(href);
}

export function Sidebar({ currentView = "home", projectId, ideaProjectId, scriptProjectId }: { currentView?: RouteView; projectId?: string; ideaProjectId?: string; scriptProjectId?: string }) {
  const groups = buildGroups(currentView, projectId, ideaProjectId, scriptProjectId);

  return <aside className="sidebar" aria-label="전체 메뉴"><a className="brand" href="/" aria-label="얄리 숏폼 스튜디오 홈" onClick={(event) => handleLinkClick(event, "/")}><span className="brand__mark"><Folder size={25} weight="regular" /></span><strong>얄리 숏폼 스튜디오</strong></a><nav className="sidebar__nav" aria-label="주 메뉴">{groups.map((group) => <section className="nav-group" key={group.label} aria-labelledby={`nav-${group.label}`}><h2 id={`nav-${group.label}`}>{group.label}</h2>{group.items.map((item) => { const ItemIcon = item.icon; return <a className={`nav-link${item.active ? " nav-link--active" : ""}`} href={item.href} aria-current={item.active ? "page" : undefined} key={item.label} onClick={(event) => handleLinkClick(event, item.href)}><ItemIcon size={19} weight="regular" aria-hidden="true" /><span className="nav-link__label">{item.label}</span></a>; })}</section>)}</nav></aside>;
}

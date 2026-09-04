import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { JobSummary, ProjectSummary } from "../../app/api";
import { PreviewPanel } from "../../features/home/PreviewPanel";
import { TodayWorkPanel } from "../../features/home/TodayWorkPanel";

export function ContextPanel({ project, jobs, expanded, onExpandedChange }: { project: ProjectSummary | null; jobs: JobSummary[]; expanded: boolean; onExpandedChange: (next: boolean) => void }) {
  return <div className="context-panel"><button className="context-panel__toggle icon-button" type="button" aria-label={expanded ? "우측 패널 접기" : "우측 패널 펼치기"} aria-expanded={expanded} onClick={() => onExpandedChange(!expanded)}>{expanded ? <CaretRight size={17} aria-hidden="true" /> : <CaretLeft size={17} aria-hidden="true" />}</button><div className="context-panel__contents"><TodayWorkPanel project={project} jobs={jobs} /><section className="preview-panel" aria-labelledby="preview-title"><div className="panel-heading"><h2 id="preview-title">미리보기</h2><span>{project?.title ?? "프로젝트 선택"}</span></div><div className="preview-panel__canvas"><PreviewPanel media={project?.preview_media} projectTitle={project?.title ?? "선택한 프로젝트"} /><div className="preview-panel__card"><strong>{project?.title ?? "작업을 시작해 보세요"}</strong><small>{project?.preview_media ? "원본 미디어" : "원본 미디어 없음"}</small><div><b>01</b><span>{project?.preview_media ? "원본 비율과 자연색으로 표시됩니다." : "미디어를 추가하면 원본 미리보기를 표시합니다."}</span></div><div><b>02</b><span>출력 미리보기는 다음 제작 단계에서 설정합니다.</span></div></div></div></section></div></div>;
}

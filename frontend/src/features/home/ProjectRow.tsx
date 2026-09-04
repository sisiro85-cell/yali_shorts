import { CaretRight, Trash, Warning } from "@phosphor-icons/react";
import { resolveMediaUrl, type ProjectSummary } from "../../app/api";
import { ProgressSteps } from "./ProgressSteps";

function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "방금 수정" : date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }); }

export function ProjectRow({ project, selected, onSelect, onDelete }: { project: ProjectSummary; selected: boolean; onSelect: (project: ProjectSummary) => void; onDelete: (project: ProjectSummary) => void }) {
  const failed = project.status === "failed";
  const media = project.preview_media;
  const mediaStyle = { filter: "none", opacity: 1, objectFit: "contain" as const, aspectRatio: `${media?.width} / ${media?.height}` };
  const mediaLabel = media?.alt ?? `${project.title} 원본 미디어`;
  const actionLabel = project.stage === "idea" ? "프로젝트 선택" : "이어서 작업";
  return <article className={`project-row${selected ? " project-row--selected" : ""}`}><div className="project-row__thumbnail-frame">{media ? media.media_type === "video" ? <video className="project-row__thumbnail" src={resolveMediaUrl(media.url)} aria-label={mediaLabel} preload="metadata" muted playsInline style={mediaStyle} /> : <img className="project-row__thumbnail" src={resolveMediaUrl(media.url)} alt={mediaLabel} style={mediaStyle} /> : <span className="project-row__thumbnail--empty">미리보기 없음</span>}</div><div className="project-row__details"><h3>{project.title}</h3><p><span className="format-tag">프로젝트</span>{dateLabel(project.updated_at)} · 컷 {project.cut_count || 0}개</p></div><ProgressSteps stage={project.stage} compact /><div className="project-row__actions">{failed ? <span className="project-row__alert"><Warning size={17} aria-hidden="true" /> 제작 실패</span> : null}<button className="row-action" type="button" onClick={() => onSelect(project)} aria-pressed={selected}>{actionLabel} <CaretRight size={15} aria-hidden="true" /></button><button className="row-delete" type="button" onClick={() => onDelete(project)} aria-label={`${project.title} 프로젝트 삭제`} title="프로젝트 삭제"><Trash size={17} aria-hidden="true" /></button></div></article>;
}

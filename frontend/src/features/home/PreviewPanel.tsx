import { resolveMediaUrl, type ProjectPreviewMedia } from "../../app/api";

export function PreviewPanel({ media, projectTitle }: { media?: ProjectPreviewMedia | null; projectTitle: string }) {
  if (!media) return <div className="preview-panel__empty" role="status"><strong>원본 미디어가 없습니다.</strong><span>프로젝트에 원본 미디어를 추가하면 여기에서 표시됩니다.</span></div>;
  const label = media.alt ?? `${projectTitle} 원본 미디어`;
  const style = { filter: "none", opacity: 1, objectFit: "contain" as const };
  return <div className="preview-panel__media-frame" style={{ aspectRatio: `${media.width} / ${media.height}` }}>{media.media_type === "video" ? <video className="preview-panel__media" src={resolveMediaUrl(media.url)} aria-label={label} controls preload="metadata" playsInline style={style} /> : <img className="preview-panel__media" src={resolveMediaUrl(media.url)} alt={label} style={style} />}</div>;
}

import type { WorkflowStage } from "../../app/api";

const labels = ["아이디어", "대본", "컷 구성", "디자인", "영상 설정", "출력"];
const indexes: Record<WorkflowStage, number> = { idea: 0, script: 1, cuts: 2, design: 3, video_settings: 4, output: 5, completed: 6, failed: 0 };

export function ProgressSteps({ stage, compact = false }: { stage: WorkflowStage; compact?: boolean }) {
  const active = indexes[stage];
  return <ol className={`progress-steps${compact ? " progress-steps--compact" : ""}`} aria-label="프로젝트 진행 단계">{labels.map((label, index) => <li className={index < active ? "is-complete" : index === active ? "is-current" : ""} aria-current={index === active ? "step" : index < active ? "true" : undefined} key={label}><span>{index < active ? "✓" : index + 1}</span>{!compact && <em>{label}</em>}</li>)}</ol>;
}

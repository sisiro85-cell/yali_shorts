import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { CutBoardData } from "../../app/api";
import { CutBoard } from "./CutBoard";

const board: CutBoardData = {
  project_id: "project-1",
  project_title: "자동화 뉴스 쇼츠",
  stage: "cuts",
  script_version_id: "script-version-1",
  stale: false,
  scenes: [
    {
      id: "scene-1",
      order: 1,
      title: "도입",
      source_script_version_id: "script-version-1",
      cuts: [
        {
          id: "cut-1",
          order: 1,
          title: "문제 제시",
          duration_ms: 1800,
          visual_prompt: "도시 사무실에서 반복 업무를 처리하는 장면",
          media_asset_id: "asset-1",
          audio_asset_id: null,
          narration_text: "반복 업무는 시간을 빼앗습니다.",
          subtitle: "반복 업무는 시간을 빼앗습니다.",
          motion_preset: "slow-zoom",
          locked: false,
          status: "ready",
          error: null,
          active_version_id: "cut-version-1",
          versions: [
            {
              id: "cut-version-1",
              created_at: "2026-09-03T03:00:00Z",
              visual_prompt: "도시 사무실에서 반복 업무를 처리하는 장면",
              narration_text: "반복 업무는 시간을 빼앗습니다.",
              subtitle: "반복 업무는 시간을 빼앗습니다.",
              motion_preset: "slow-zoom",
              media_asset_id: "asset-1",
              audio_asset_id: null,
            },
          ],
        },
        {
          id: "cut-2",
          order: 2,
          title: "해결 방법",
          duration_ms: 2200,
          visual_prompt: "업무 자동화 체크리스트를 확인하는 손",
          media_asset_id: null,
          audio_asset_id: null,
          narration_text: "작은 업무부터 자동화해 보세요.",
          subtitle: "작은 업무부터 자동화해 보세요.",
          motion_preset: "static",
          locked: false,
          status: "draft",
          error: null,
          active_version_id: null,
          versions: [],
        },
      ],
    },
  ],
};

test("renders every cut as an individual card", () => {
  render(<CutBoard data={board} isGenerating={false} error="" onGenerate={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "컷 구성" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "도입" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "문제 제시" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "해결 방법" })).toBeInTheDocument();
  expect(screen.getAllByText("반복 업무는 시간을 빼앗습니다.")).toHaveLength(2);
  expect(screen.getByText("도시 사무실에서 반복 업무를 처리하는 장면")).toBeInTheDocument();
  expect(screen.getByText("이미지 연결됨")).toBeInTheDocument();
  expect(screen.getByText("이미지 생성 대기")).toBeInTheDocument();
});

test("shows loading, generation, and error states", async () => {
  const onGenerate = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(
    <CutBoard data={null} isLoading isGenerating={false} error="" onGenerate={onGenerate} />,
  );

  expect(screen.getByRole("status")).toHaveTextContent("컷 보드를 불러오는 중입니다.");

  rerender(<CutBoard data={null} isGenerating error="" onGenerate={onGenerate} />);
  expect(screen.getByRole("button", { name: "컷 보드 생성 중…" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("컷 보드를 생성하고 있습니다.");

  rerender(<CutBoard data={null} isGenerating={false} error="대본을 먼저 생성해 주세요." onGenerate={onGenerate} />);
  expect(screen.getByRole("alert")).toHaveTextContent("대본을 먼저 생성해 주세요.");

  fireEvent.click(screen.getByRole("button", { name: "컷 보드 생성" }));
  await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
});

test("does not present stale cuts as the current board", () => {
  render(
    <CutBoard
      data={{ ...board, stale: true }}
      isGenerating={false}
      error=""
      onGenerate={vi.fn()}
    />,
  );

  expect(screen.getByRole("status")).toHaveTextContent("현재 대본과 맞지 않는 컷 보드입니다.");
  expect(screen.queryByRole("heading", { name: "문제 제시" })).not.toBeInTheDocument();
  expect(screen.queryByText("도시 사무실에서 반복 업무를 처리하는 장면")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "최신 대본으로 다시 생성" })).toBeInTheDocument();
});

test("does not show the empty-board status alongside a board error", () => {
  render(
    <CutBoard
      data={null}
      isGenerating={false}
      error="컷 보드를 불러오지 못했습니다."
      onGenerate={vi.fn()}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent("컷 보드를 불러오지 못했습니다.");
  expect(screen.queryByText("아직 생성된 컷 보드가 없습니다.")).not.toBeInTheDocument();
});

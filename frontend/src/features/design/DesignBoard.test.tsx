import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { CutBoardData } from "../../app/api";
import { DesignBoard } from "./DesignBoard";

const board: CutBoardData = {
  project_id: "project-1",
  project_title: "자동화 뉴스 쇼츠",
  stage: "design",
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
          versions: [],
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

test("renders each cut image and provides per-cut generation actions", () => {
  const onRegenerate = vi.fn();

  render(
    <DesignBoard
      projectId="project-1"
      data={board}
      isLoading={false}
      error=""
      onRegenerate={onRegenerate}
      onContinueToOutput={vi.fn()}
      onBackToCuts={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: "디자인" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "컷 1 문제 제시 이미지" })).toHaveAttribute(
    "src",
    expect.stringContaining("/api/projects/project-1/assets/asset-1/preview"),
  );
  expect(screen.getByText("이미지 생성 대기")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "컷 1 이미지 재생성" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "컷 2 이미지 생성" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "컷 2 이미지 생성" }));
  expect(onRegenerate).toHaveBeenCalledWith("cut-2", {});
});

test("shows the image action before the detailed settings", () => {
  render(
    <DesignBoard
      projectId="project-1"
      data={board}
      isLoading={false}
      error=""
      onRegenerate={vi.fn()}
      onContinueToOutput={vi.fn()}
      onBackToCuts={vi.fn()}
    />,
  );

  const action = screen.getByRole("button", { name: "컷 1 이미지 재생성" });
  const settings = document.getElementById("design-cut-prompt-cut-1")?.closest("details");

  expect(settings).not.toBeNull();
  expect(action.compareDocumentPosition(settings!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test("provides a top action for generating every missing cut image", () => {
  const onGenerateAll = vi.fn();

  render(
    <DesignBoard
      projectId="project-1"
      data={board}
      isLoading={false}
      error=""
      onRegenerate={vi.fn()}
      onGenerateAll={onGenerateAll}
      onContinueToOutput={vi.fn()}
      onBackToCuts={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "이미지 전체 생성" }));

  expect(onGenerateAll).toHaveBeenCalledWith(["cut-2"]);
});

test("places every cut in one grid while keeping its scene context", () => {
  const multiSceneBoard: CutBoardData = {
    ...board,
    scenes: [
      board.scenes[0],
      {
        id: "scene-2",
        order: 2,
        title: "해결",
        source_script_version_id: "script-version-1",
        cuts: [{ ...board.scenes[0].cuts[1], id: "cut-3", order: 3, title: "실행" }],
      },
    ],
  };

  render(
    <DesignBoard
      projectId="project-1"
      data={multiSceneBoard}
      isLoading={false}
      error=""
      onRegenerate={vi.fn()}
      onContinueToOutput={vi.fn()}
      onBackToCuts={vi.fn()}
    />,
  );

  const grids = document.querySelectorAll(".design-card-grid");
  expect(grids).toHaveLength(1);
  expect(grids[0]?.querySelectorAll(".design-cut-card")).toHaveLength(3);
  expect(screen.getAllByText("씬 1 · 도입")).toHaveLength(2);
  expect(screen.getByText("씬 2 · 해결")).toBeInTheDocument();
});

test("allows moving to output after every cut image is ready", () => {
  const onContinueToOutput = vi.fn();
  const completeBoard: CutBoardData = {
    ...board,
    scenes: board.scenes.map((scene) => ({
      ...scene,
      cuts: scene.cuts.map((cut) => cut.id === "cut-2" ? { ...cut, media_asset_id: "asset-2", status: "ready" as const } : cut),
    })),
  };

  render(
    <DesignBoard
      projectId="project-1"
      data={completeBoard}
      isLoading={false}
      error=""
      onRegenerate={vi.fn()}
      onContinueToOutput={onContinueToOutput}
      onBackToCuts={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "출력으로 이동" }));
  expect(onContinueToOutput).toHaveBeenCalledTimes(1);
});

test("keeps the next-stage action unavailable until every cut has an image", () => {
  render(
    <DesignBoard
      projectId="project-1"
      data={board}
      isLoading={false}
      error=""
      onRegenerate={vi.fn()}
      onContinueToOutput={vi.fn()}
      onBackToCuts={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "출력으로 이동" })).toBeDisabled();
  expect(screen.getByText("모든 컷 이미지를 생성하면 출력 단계로 이동할 수 있습니다.")).toBeInTheDocument();
});

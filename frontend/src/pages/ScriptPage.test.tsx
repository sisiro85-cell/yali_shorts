import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { CutBoardData, ScriptPageData } from "../app/api";
import { ScriptPage } from "./ScriptPage";

function makeBoard(projectId: string, projectTitle: string, cutTitle: string): CutBoardData {
  return {
    project_id: projectId,
    project_title: projectTitle,
    stage: "cuts",
    script_version_id: `${projectId}-script`,
    stale: false,
    scenes: [
      {
        id: `${projectId}-scene`,
        order: 1,
        title: "도입",
        source_script_version_id: `${projectId}-script`,
        cuts: [
          {
            id: `${projectId}-cut`,
            order: 1,
            title: cutTitle,
            duration_ms: 1800,
            visual_prompt: "테스트용 비주얼 프롬프트",
            media_asset_id: null,
            audio_asset_id: null,
            narration_text: "테스트 내레이션",
            subtitle: "테스트 자막",
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
}

function makeJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeScriptPage(projectId: string, projectTitle: string): ScriptPageData {
  return {
    project_id: projectId,
    project_title: projectTitle,
    stage: "script",
    versions: [],
  };
}

const scriptPage = makeScriptPage("project-a", "프로젝트 A");

afterEach(() => {
  vi.unstubAllGlobals();
});

test("clears the previous project's board before a cuts request that fails", async () => {
  let rejectProjectB: (reason?: unknown) => void = () => undefined;
  const projectBRequest = new Promise<Response>((_resolve, reject) => {
    rejectProjectB = reject;
  });
  const projectABoard = makeBoard("project-a", "프로젝트 A", "프로젝트 A 컷");

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.endsWith("/projects/project-a/cuts")) return Promise.resolve(makeJsonResponse(projectABoard));
      if (input.endsWith("/projects/project-b/cuts")) return projectBRequest;
      throw new Error(`Unhandled fetch ${input}`);
    }),
  );

  const view = render(<ScriptPage projectId="project-a" stage="cuts" />);
  await waitFor(() => expect(screen.getByRole("heading", { name: "프로젝트 A 컷" })).toBeVisible());

  view.rerender(<ScriptPage projectId="project-b" stage="cuts" />);

  expect(screen.queryByRole("heading", { name: "프로젝트 A 컷" })).not.toBeInTheDocument();
  expect(screen.getByText("컷 보드를 불러오는 중입니다.")).toBeVisible();

  await act(async () => {
    rejectProjectB(new Error("프로젝트 B 컷 보드를 불러오지 못했습니다."));
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("프로젝트 B 컷 보드를 불러오지 못했습니다."));
  expect(screen.queryByRole("heading", { name: "프로젝트 A 컷" })).not.toBeInTheDocument();
});

test("ignores a cuts generation result after the project stage changes", async () => {
  let resolveGeneration: (response: Response) => void = () => undefined;
  const generationRequest = new Promise<Response>((resolve) => {
    resolveGeneration = resolve;
  });
  const projectABoard = makeBoard("project-a", "프로젝트 A", "기존 프로젝트 A 컷");
  const generatedProjectABoard = makeBoard("project-a", "프로젝트 A", "이전 요청이 만든 컷");
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.endsWith("/projects/project-a/cuts") && !init?.method) return Promise.resolve(makeJsonResponse(projectABoard));
    if (input.endsWith("/projects/project-a/cuts/generate") && init?.method === "POST") return generationRequest;
    if (input.endsWith("/projects/project-a/script") && !init?.method) return Promise.resolve(makeJsonResponse(scriptPage));
    throw new Error(`Unhandled fetch ${input} ${init?.method ?? "GET"}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const view = render(<ScriptPage projectId="project-a" stage="cuts" />);
  await waitFor(() => expect(screen.getByRole("heading", { name: "기존 프로젝트 A 컷" })).toBeVisible());

  await act(async () => {
    screen.getByRole("button", { name: "컷 보드 다시 생성" }).click();
    await Promise.resolve();
  });
  view.rerender(<ScriptPage projectId="project-a" stage="script" />);
  await waitFor(() => expect(screen.getByRole("heading", { name: "대본 만들기" })).toBeVisible());

  await act(async () => {
    resolveGeneration(makeJsonResponse(generatedProjectABoard));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.queryByText("컷 보드를 생성했습니다. 컷별 내용을 확인해 주세요.")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "이전 요청이 만든 컷" })).not.toBeInTheDocument();
});

test("ignores a late script generation result after the project and stage change", async () => {
  let resolveGeneration: (response: Response) => void = () => undefined;
  const generationRequest = new Promise<Response>((resolve) => {
    resolveGeneration = resolve;
  });
  const projectBBoard = makeBoard("project-b", "프로젝트 B", "프로젝트 B 컷");
  const lateScriptPage = makeScriptPage("project-a", "이전 대본 응답 프로젝트");
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.endsWith("/projects/project-a/script") && !init?.method) return Promise.resolve(makeJsonResponse(scriptPage));
    if (input.endsWith("/projects/project-a/script/generate") && init?.method === "POST") return generationRequest;
    if (input.endsWith("/projects/project-b/cuts") && !init?.method) return Promise.resolve(makeJsonResponse(projectBBoard));
    throw new Error(`Unhandled fetch ${input} ${init?.method ?? "GET"}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const view = render(<ScriptPage projectId="project-a" stage="script" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "대본 생성" })).toBeVisible());

  await act(async () => {
    screen.getByRole("button", { name: "대본 생성" }).click();
    await Promise.resolve();
  });
  view.rerender(<ScriptPage projectId="project-b" stage="cuts" />);
  await waitFor(() => expect(screen.getByRole("heading", { name: "프로젝트 B 컷" })).toBeVisible());

  await act(async () => {
    resolveGeneration(makeJsonResponse(lateScriptPage));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.queryByText("대본을 생성했습니다. 내용을 확인해 주세요.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "현재 프로젝트 선택" })).toHaveTextContent("프로젝트 B");
});

test("does not show the previous project's title while the current stage is loading", async () => {
  let resolveProjectB: (response: Response) => void = () => undefined;
  const projectBRequest = new Promise<Response>((resolve) => {
    resolveProjectB = resolve;
  });
  const projectBPage = makeScriptPage("project-b", "프로젝트 B");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.endsWith("/projects/project-a/script")) return Promise.resolve(makeJsonResponse(scriptPage));
      if (input.endsWith("/projects/project-b/script")) return projectBRequest;
      throw new Error(`Unhandled fetch ${input}`);
    }),
  );

  const view = render(<ScriptPage projectId="project-a" stage="script" />);
  const projectPicker = () => screen.getByRole("button", { name: "현재 프로젝트 선택" });
  await waitFor(() => expect(projectPicker()).toHaveTextContent("프로젝트 A"));

  view.rerender(<ScriptPage projectId="project-b" stage="script" />);

  expect(projectPicker()).not.toHaveTextContent("프로젝트 A");
  expect(projectPicker()).toHaveTextContent(/^프로젝트$/);
  expect(screen.getByText("대본 화면을 불러오는 중입니다…")).toBeVisible();

  await act(async () => {
    resolveProjectB(makeJsonResponse(projectBPage));
    await Promise.resolve();
  });
  await waitFor(() => expect(projectPicker()).toHaveTextContent("프로젝트 B"));
});

test("loads the cut board and renders cut images on the design stage", async () => {
  const designBoard = makeBoard("project-a", "프로젝트 A", "디자인 컷");
  designBoard.stage = "design";
  designBoard.scenes[0].cuts[0].media_asset_id = "asset-1";
  designBoard.scenes[0].cuts[0].status = "ready";

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.endsWith("/projects/project-a/cuts")) return Promise.resolve(makeJsonResponse(designBoard));
      throw new Error(`Unhandled fetch ${input}`);
    }),
  );

  render(<ScriptPage projectId="project-a" stage="design" />);

  await waitFor(() => expect(screen.getByRole("heading", { name: "디자인" })).toBeVisible());
  expect(screen.getByRole("img", { name: "컷 1 디자인 컷 이미지" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "출력으로 이동" })).toBeEnabled();
});

test("generates every design image through parallel cut sessions", async () => {
  const designBoard = makeBoard("project-a", "프로젝트 A", "첫 번째 컷");
  designBoard.stage = "design";
  designBoard.scenes[0].cuts = [
    designBoard.scenes[0].cuts[0],
    { ...designBoard.scenes[0].cuts[0], id: "project-a-cut-2", order: 2, title: "두 번째 컷" },
  ];
  const completedBoard: CutBoardData = {
    ...designBoard,
    scenes: designBoard.scenes.map((scene) => ({
      ...scene,
      cuts: scene.cuts.map((cut) => ({ ...cut, media_asset_id: `${cut.id}-asset`, status: "ready" as const })),
    })),
  };
  let boardReads = 0;
  const regenerationRequests: string[] = [];
  let polledBeforeAllRequests = false;

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (input.endsWith("/projects/project-a/cuts") && !init?.method) {
        boardReads += 1;
        return Promise.resolve(makeJsonResponse(boardReads === 1 ? designBoard : completedBoard));
      }
      if (input.endsWith("/projects/project-a/cuts/project-a-cut/regenerate") && init?.method === "POST") {
        regenerationRequests.push("project-a-cut");
        return Promise.resolve(makeJsonResponse({ job_id: "design-job-1", cut_id: "project-a-cut", status: "queued" }, 202));
      }
      if (input.endsWith("/projects/project-a/cuts/project-a-cut-2/regenerate") && init?.method === "POST") {
        regenerationRequests.push("project-a-cut-2");
        return Promise.resolve(makeJsonResponse({ job_id: "design-job-2", cut_id: "project-a-cut-2", status: "queued" }, 202));
      }
      if (input.includes("/jobs?project_id=project-a")) {
        if (regenerationRequests.length < 2) polledBeforeAllRequests = true;
        return Promise.resolve(makeJsonResponse({
          jobs: [
            { id: "design-job-1", project_id: "project-a", cut_id: "project-a-cut", kind: "cut.regenerate", status: regenerationRequests.length === 2 ? "completed" : "running", progress: regenerationRequests.length === 2 ? 100 : 1, error: null, retry_count: 0 },
            { id: "design-job-2", project_id: "project-a", cut_id: "project-a-cut-2", kind: "cut.regenerate", status: regenerationRequests.length === 2 ? "completed" : "running", progress: regenerationRequests.length === 2 ? 100 : 1, error: null, retry_count: 0 },
          ],
        }));
      }
      throw new Error(`Unhandled fetch ${input} ${init?.method ?? "GET"}`);
    }),
  );

  render(<ScriptPage projectId="project-a" stage="design" />);

  await waitFor(() => expect(screen.getByRole("button", { name: "이미지 전체 생성" })).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "이미지 전체 생성" }));

  await waitFor(() => expect(screen.getByText("전체 이미지 생성을 완료했습니다.")).toBeVisible());
  expect(regenerationRequests).toEqual(["project-a-cut", "project-a-cut-2"]);
  expect(polledBeforeAllRequests).toBe(false);
});

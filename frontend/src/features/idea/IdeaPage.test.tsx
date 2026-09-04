import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app/App";

const createdProject = {
  id: "b0ef2df8-8d89-4f9e-8ab8-2114db4ea001",
  title: "새 프로젝트",
  stage: "idea" as const,
  status: "idea" as const,
  scene_count: 0,
  cut_count: 0,
  progress: 0,
  updated_at: "2026-09-03T01:42:00Z",
};

function makeIdeaPage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    project_id: createdProject.id,
    project_title: createdProject.title,
    stage: "idea",
    draft: {
      topic: "",
      source_text: "",
      formats: [],
      reference_asset_ids: [],
      updated_at: "2026-09-03T02:00:00+00:00",
    },
    reference_assets: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("home new-project action creates a project and opens the real idea route", async () => {
  const ideaPage = makeIdeaPage();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (input.endsWith("/projects") && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify({ projects: [] }), { status: 200 }));
      }
      if (input.endsWith("/jobs")) {
        return Promise.resolve(new Response(JSON.stringify({ jobs: [] }), { status: 200 }));
      }
      if (input.endsWith("/projects") && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify(createdProject), { status: 201 }));
      }
      if (input.endsWith(`/projects/${createdProject.id}/ideas`)) {
        return Promise.resolve(new Response(JSON.stringify(ideaPage), { status: 200 }));
      }
      throw new Error(`Unhandled fetch ${input} ${init?.method ?? "GET"}`);
    }),
  );

  render(<App />);
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
  await flush();

  expect(window.location.pathname).toBe(`/projects/${createdProject.id}/idea`);
  expect(screen.getByRole("heading", { name: "아이디어 만들기" })).toBeVisible();
  expect(screen.getByText("아직 추가된 자료가 없습니다.")).toBeVisible();
  expect(screen.getByRole("link", { name: "아이디어" })).toHaveAttribute("aria-current", "page");
});

test("an existing idea project selection opens its idea route", async () => {
  const ideaPage = makeIdeaPage();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.endsWith("/projects")) {
        return Promise.resolve(new Response(JSON.stringify({ projects: [createdProject] }), { status: 200 }));
      }
      if (input.endsWith("/jobs")) {
        return Promise.resolve(new Response(JSON.stringify({ jobs: [] }), { status: 200 }));
      }
      if (input.endsWith(`/projects/${createdProject.id}/ideas`)) {
        return Promise.resolve(new Response(JSON.stringify(ideaPage), { status: 200 }));
      }
      throw new Error(`Unhandled fetch ${input}`);
    }),
  );

  render(<App />);
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /이어서 작업/ }));
  await flush();

  expect(window.location.pathname).toBe(`/projects/${createdProject.id}/idea`);
  expect(screen.getByRole("heading", { name: "아이디어 만들기" })).toBeVisible();
});

test("shows field errors and live counts without enqueueing an empty draft", async () => {
  const fetchMock = vi.fn((input: string) => {
    if (input.endsWith(`/projects/${createdProject.id}/ideas`)) {
      return Promise.resolve(new Response(JSON.stringify(makeIdeaPage()), { status: 200 }));
    }
    throw new Error(`Unhandled fetch ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", `/projects/${createdProject.id}/idea`);

  render(<App />);
  await flush();
  fireEvent.change(screen.getByLabelText("출처 / 참고 내용"), { target: { value: "참고 문장" } });
  fireEvent.click(screen.getByRole("button", { name: "아이디어 생성 시작" }));

  expect(screen.getByText("주제 또는 키워드를 입력해 주세요.")).toBeVisible();
  expect(screen.getByText("출력 형식을 하나 이상 선택해 주세요.")).toBeVisible();
  expect(screen.getByText("5/100,000")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("shows source guidance on hover or focus and hides it after leaving", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.endsWith(`/projects/${createdProject.id}/ideas`)) {
        return Promise.resolve(new Response(JSON.stringify(makeIdeaPage()), { status: 200 }));
      }
      throw new Error(`Unhandled fetch ${input}`);
    }),
  );
  window.history.replaceState({}, "", `/projects/${createdProject.id}/idea`);

  render(<App />);
  await flush();

  const help = screen.getByRole("button", { name: "출처 도움말" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

  fireEvent.mouseEnter(help);
  expect(screen.getByRole("tooltip")).toHaveTextContent("아이디어 생성에 참고할 원문이나 핵심 내용을 입력합니다.");
  fireEvent.mouseLeave(help);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

  fireEvent.focus(help);
  expect(screen.getByRole("tooltip")).toHaveTextContent("아이디어 생성에 참고할 원문이나 핵심 내용을 입력합니다.");
  expect(help).toHaveAttribute("aria-describedby");

  fireEvent.blur(help);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

test("selects only reference assets returned by the idea API", async () => {
  let savedBody: Record<string, unknown> | null = null;
  const registeredAsset = {
    id: "24860294-bd7c-4b6a-b834-c5fe976e1490",
    filename: "등록된-레퍼런스.png",
    media_type: "image",
    created_at: "2026-09-03T02:00:00+00:00",
    preview_media: {
      url: "/api/projects/demo/assets/reference/preview",
      media_type: "image",
      width: 1080,
      height: 1920,
      alt: "등록된 레퍼런스 원본",
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (input.endsWith(`/projects/${createdProject.id}/ideas`) && !init?.method) {
        return Promise.resolve(
          new Response(JSON.stringify(makeIdeaPage({ reference_assets: [registeredAsset] })), { status: 200 }),
        );
      }
      if (input.endsWith(`/projects/${createdProject.id}/ideas/draft`) && init?.method === "PATCH") {
        savedBody = JSON.parse(String(init.body));
        return Promise.resolve(
          new Response(
            JSON.stringify(makeIdeaPage({ reference_assets: [registeredAsset], draft: { ...makeIdeaPage().draft, ...savedBody } })),
            { status: 200 },
          ),
        );
      }
      throw new Error(`Unhandled fetch ${input} ${init?.method ?? "GET"}`);
    }),
  );
  window.history.replaceState({}, "", `/projects/${createdProject.id}/idea`);

  render(<App />);
  await flush();
  fireEvent.change(screen.getByLabelText("주제 / 키워드"), { target: { value: "자료 기반 기획" } });
  fireEvent.click(screen.getByRole("button", { name: /쇼츠/ }));
  fireEvent.click(screen.getByRole("button", { name: "등록된-레퍼런스.png 선택" }));
  fireEvent.click(screen.getByRole("button", { name: "임시 저장" }));
  await flush();

  expect(savedBody).toMatchObject({ reference_asset_ids: [registeredAsset.id] });
  expect(screen.queryByText("C:\\프로그램\\쇼츠참고자료")).not.toBeInTheDocument();
});

test("saved draft restores after remount and preserves selected formats", async () => {
  const savedState = {
    ideaPage: makeIdeaPage(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (input.endsWith(`/projects/${createdProject.id}/ideas`) && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify(savedState.ideaPage), { status: 200 }));
      }
      if (input.endsWith(`/projects/${createdProject.id}/ideas/draft`) && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        savedState.ideaPage = makeIdeaPage({
          draft: {
            ...savedState.ideaPage.draft,
            ...body,
            updated_at: "2026-09-03T03:00:00+00:00",
          },
        });
        return Promise.resolve(new Response(JSON.stringify(savedState.ideaPage), { status: 200 }));
      }
      throw new Error(`Unhandled fetch ${input} ${init?.method ?? "GET"}`);
    }),
  );

  window.history.replaceState({}, "", `/projects/${createdProject.id}/idea`);
  const rendered = render(<App />);
  await flush();

  fireEvent.change(screen.getByLabelText("주제 / 키워드"), { target: { value: "브랜딩 전략" } });
  fireEvent.click(screen.getByRole("button", { name: /쇼츠/ }));
  fireEvent.click(screen.getByRole("button", { name: /카드뉴스/ }));
  fireEvent.click(screen.getByRole("button", { name: "임시 저장" }));
  await flush();

  rendered.unmount();
  render(<App />);
  await flush();

  expect(screen.getByLabelText("주제 / 키워드")).toHaveValue("브랜딩 전략");
  expect(screen.getByRole("button", { name: /쇼츠/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: /카드뉴스/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("임시 저장한 내용을 불러왔습니다.")).toBeVisible();
});

test("queued generation keeps fields editable and allows cancellation", async () => {
  let jobState = "queued";
  let generationJob = {
    id: "93ab6ae6-5ca8-4f5a-ad62-7330e9bc9123",
    project_id: createdProject.id,
    cut_id: null,
    kind: "idea.generate",
    status: "queued",
    progress: 0,
    error: null,
    retry_count: 0,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (input.endsWith(`/projects/${createdProject.id}/ideas`) && !init?.method) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              makeIdeaPage({
                draft: {
                  topic: "브랜드 인지도",
                  source_text: "",
                  formats: ["shorts"],
                  reference_asset_ids: [],
                  updated_at: "2026-09-03T02:00:00+00:00",
                },
                generation_job: { ...generationJob, status: jobState },
              }),
            ),
            { status: 200 },
          ),
        );
      }
      if (input.endsWith(`/projects/${createdProject.id}/ideas/generate`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ job_id: generationJob.id, status: "queued" }), { status: 202 }),
        );
      }
      if (input.endsWith(`/projects/${createdProject.id}/ideas/jobs/${generationJob.id}/cancel`) && init?.method === "POST") {
        jobState = "cancelled";
        generationJob = { ...generationJob, status: "cancelled" };
        return Promise.resolve(new Response(JSON.stringify(generationJob), { status: 200 }));
      }
      throw new Error(`Unhandled fetch ${input} ${init?.method ?? "GET"}`);
    }),
  );

  window.history.replaceState({}, "", `/projects/${createdProject.id}/idea`);
  render(<App />);
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "아이디어 생성 시작" }));
  await flush();

  const topicInput = screen.getByLabelText("주제 / 키워드");
  fireEvent.change(topicInput, { target: { value: "브랜드 인지도 상승" } });
  expect(topicInput).toHaveValue("브랜드 인지도 상승");
  expect(screen.getByText("아이디어 생성 요청이 작업 큐에 등록되었습니다.")).toBeVisible();
  expect(screen.getByRole("button", { name: "생성 취소" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "생성 취소" }));
  await flush();

  expect(screen.getByText("생성 요청을 취소했습니다.")).toBeVisible();
  expect(screen.getByText("취소됨")).toBeVisible();
});

test("completed idea version exposes continue behavior for the next workflow stage", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (input.endsWith(`/projects/${createdProject.id}/ideas`) && !init?.method) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              makeIdeaPage({
                active_version: {
                  id: "e7fa3eb0-bef7-430b-84f0-bfcbfc77c211",
                  headline: "브랜드 인지도 상승을 위한 5가지 쇼츠 기획",
                  summary: "대본 단계로 넘길 수 있는 완료된 아이디어 버전입니다.",
                  key_points: ["문제 제기", "사례", "행동 유도"],
                  created_at: "2026-09-03T02:00:00+00:00",
                },
              }),
            ),
            { status: 200 },
          ),
        );
      }
      if (input.endsWith(`/projects/${createdProject.id}/script`) && !init?.method) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ project_id: createdProject.id, project_title: createdProject.title, stage: "script", versions: [] }),
            { status: 200 },
          ),
        );
      }
      if (input.endsWith(`/projects/${createdProject.id}`) && init?.method === "PATCH") {
        return Promise.resolve(new Response(JSON.stringify({ ...createdProject, stage: "script", status: "script" }), { status: 200 }));
      }
      if (input.endsWith("/projects") && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify({ projects: [createdProject] }), { status: 200 }));
      }
      if (input.endsWith("/jobs")) {
        return Promise.resolve(new Response(JSON.stringify({ jobs: [] }), { status: 200 }));
      }
      throw new Error(`Unhandled fetch ${input} ${init?.method ?? "GET"}`);
    }),
  );

  window.history.replaceState({}, "", `/projects/${createdProject.id}/idea`);
  render(<App />);
  await flush();

  expect(screen.getByText("브랜드 인지도 상승을 위한 5가지 쇼츠 기획")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "대본 단계로 이어서 작업" }));
  await waitFor(() => expect(window.location.pathname).toBe(`/projects/${createdProject.id}/script`));
  expect(screen.getByRole("heading", { name: "대본 만들기" })).toBeVisible();
});

test("shows a persisted generation error while leaving the draft editable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.endsWith(`/projects/${createdProject.id}/ideas`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              makeIdeaPage({
                draft: {
                  topic: "오류가 난 작업",
                  source_text: "수정 가능한 원문",
                  formats: ["reels"],
                  reference_asset_ids: [],
                  updated_at: "2026-09-03T02:00:00+00:00",
                },
                generation_job: {
                  id: "2f81bf1a-2348-42a4-8d52-b5b391c60e48",
                  project_id: createdProject.id,
                  cut_id: null,
                  kind: "idea.generate",
                  status: "failed",
                  progress: 20,
                  error: "생성 작업을 처리하지 못했습니다.",
                  retry_count: 1,
                },
              }),
            ),
            { status: 200 },
          ),
        );
      }
      throw new Error(`Unhandled fetch ${input}`);
    }),
  );
  window.history.replaceState({}, "", `/projects/${createdProject.id}/idea`);

  render(<App />);
  await flush();

  expect(screen.getByText("오류")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("생성 작업을 처리하지 못했습니다.");
  expect(screen.getByLabelText("주제 / 키워드")).not.toBeDisabled();
});

test("restarts status polling when cancellation fails", async () => {
  vi.useFakeTimers();
  let ideaCalls = 0;
  const queuedJob = {
    id: "ca0f3b2e-4c5f-4b04-8d64-2d4c4d28a001",
    project_id: createdProject.id,
    cut_id: null,
    kind: "idea.generate",
    status: "queued",
    progress: 0,
    error: null,
    retry_count: 0,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (input.endsWith(`/projects/${createdProject.id}/ideas`) && !init?.method) {
        ideaCalls += 1;
        if (ideaCalls === 1) {
          return Promise.resolve(new Response(JSON.stringify(makeIdeaPage({ generation_job: queuedJob })), { status: 200 }));
        }
        return Promise.reject(new Error("poll failed"));
      }
      if (input.endsWith(`/projects/${createdProject.id}/ideas/jobs/${queuedJob.id}/cancel`)) {
        return Promise.reject(new Error("cancel failed"));
      }
      throw new Error(`Unhandled fetch ${input} ${init?.method ?? "GET"}`);
    }),
  );
  window.history.replaceState({}, "", `/projects/${createdProject.id}/idea`);

  render(<App />);
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "생성 취소" }));
  await flush();
  expect(screen.getByRole("alert")).toHaveTextContent("cancel failed");

  await act(async () => {
    vi.advanceTimersByTime(1500);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByText("생성 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.")).toBeVisible();
});

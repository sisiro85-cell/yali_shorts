import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app/App";

const project = {
  id: "8c0afd1b-a242-4a3e-9e2b-8d9625212486",
  title: "AI 자동화 뉴스 쇼츠",
  status: "cuts" as const,
  stage: "cuts" as const,
  scene_count: 1,
  cut_count: 6,
  progress: 50,
  updated_at: "2026-09-03T01:42:00Z",
};

const secondProject = {
  ...project,
  id: "536b165a-c332-4319-826e-737030e2035b",
  title: "두 번째 프로젝트",
  stage: "design" as const,
  status: "design" as const,
  cut_count: 8,
  preview_media: { url: "/api/projects/demo/assets/second/preview", media_type: "video", width: 720, height: 1280 },
};
const ideaProject = {
  ...project,
  id: "34d3a3cd-1943-4582-a31a-2f794b3fcd62",
  title: "새 아이디어 프로젝트",
  stage: "idea" as const,
  status: "idea" as const,
  cut_count: 0,
  progress: 0,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-03T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn((input: string) => Promise.resolve(new Response(JSON.stringify(input.endsWith("/projects") ? { projects: [project, secondProject, ideaProject] } : { jobs: [] }), { status: 200 }))));
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function renderApp() {
  const rendered = render(<App />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return rendered;
}

test("renders the brand, grouped production navigation, and active workflow", async () => {
  await renderApp();

  expect(screen.getByRole("link", { name: "얄리 숏폼 스튜디오 홈" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "제작" })).toBeVisible();
  expect(screen.getByRole("link", { name: "아이디어" })).toBeVisible();
  expect(screen.getByLabelText("제작 진행 단계").querySelector('[aria-current="step"]')).toHaveTextContent("컷 구성");
});

test("shows an explicit empty preview state when the API provides no original media", async () => {
  await renderApp();

  expect(screen.getByText("원본 미디어가 없습니다.")).toBeVisible();
  expect(screen.queryByRole("img", { name: "AI 자동화 뉴스 쇼츠 원본 미디어" })).not.toBeInTheDocument();
});

test("collapses the context layout and provides a keyboard-accessible reopen control", async () => {
  const { container } = await renderApp();

  const toggle = screen.getByRole("button", { name: "우측 패널 접기" });
  fireEvent.click(toggle);
  expect(container.querySelector(".app-shell__context")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector(".app-shell")).toHaveClass("app-shell--context-collapsed");
  const reopen = screen.getByRole("button", { name: "우측 패널 펼치기" });
  expect(reopen).toHaveFocus();
  fireEvent.click(reopen);
  expect(screen.getByRole("complementary", { name: "작업 컨텍스트" })).toHaveAttribute("aria-hidden", "false");
});

test("uses the selected project and the current locale date in today work", async () => {
  await renderApp();

  fireEvent.click(screen.getAllByRole("button", { name: /이어서 작업/ })[1]);
  expect(screen.getByRole("region", { name: "오늘 작업" })).toHaveTextContent("두 번째 프로젝트");
  expect(screen.getByText("9월 3일 (목)")).toHaveAttribute("dateTime", "2026-09-03");
  const previews = screen.getAllByLabelText("두 번째 프로젝트 원본 미디어");
  expect(previews).toHaveLength(2);
  for (const preview of previews) {
    expect(preview.tagName).toBe("VIDEO");
    expect(preview).toHaveAttribute("src", "http://127.0.0.1:8000/api/projects/demo/assets/second/preview");
    expect(preview).toHaveAttribute("preload", "metadata");
    expect(preview).toHaveStyle({ filter: "none", opacity: "1", objectFit: "contain" });
  }
  expect(previews[1]).toHaveAttribute("controls");
});

test("does not mark future checklist steps complete for an idea-stage project", async () => {
  const { container } = await renderApp();

  fireEvent.click(screen.getByRole("button", { name: "프로젝트 선택" }));

  const checklist = container.querySelector(".continue-card__checklist");
  expect(checklist?.querySelectorAll(".is-complete")).toHaveLength(0);
  expect(checklist?.querySelector(".is-active")).toHaveTextContent("아이디어");
  expect(checklist).toHaveTextContent("대본");
  expect(checklist).toHaveTextContent("대본 확정");
});

test("confirms project deletion before removing it from the home list", async () => {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.endsWith("/projects") && init?.method === "DELETE") {
      return Promise.resolve(new Response(JSON.stringify({ id: project.id, deleted: true }), { status: 200 }));
    }
    if (input.endsWith("/projects")) {
      return Promise.resolve(new Response(JSON.stringify({ projects: [project, secondProject, ideaProject] }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ jobs: [] }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  await renderApp();

  fireEvent.click(screen.getByRole("button", { name: "AI 자동화 뉴스 쇼츠 프로젝트 삭제" }));
  expect(screen.getByRole("dialog", { name: "프로젝트 삭제 확인" })).toHaveTextContent("AI 자동화 뉴스 쇼츠");
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining(`/projects/${project.id}`), expect.objectContaining({ method: "DELETE" }));

  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining(`/projects/${project.id}`),
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(screen.queryByRole("heading", { name: project.title, level: 3 })).not.toBeInTheDocument();
});

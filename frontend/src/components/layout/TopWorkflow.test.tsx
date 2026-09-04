import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { apiClient, type ProjectSummary } from "../../app/api";
import { TopWorkflow } from "./TopWorkflow";

const currentProject: ProjectSummary = {
  id: "current-project",
  title: "현재 프로젝트",
  status: "script",
  stage: "script",
  scene_count: 2,
  cut_count: 4,
  progress: 40,
  updated_at: "2026-09-03T01:42:00Z",
};

const nextProject: ProjectSummary = {
  id: "next-project",
  title: "다음 프로젝트",
  status: "design",
  stage: "design",
  scene_count: 3,
  cut_count: 8,
  progress: 70,
  updated_at: "2026-09-02T01:42:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

test("opens the project list and navigates to the selected project's saved stage", () => {
  render(<TopWorkflow projectName={currentProject.title} projectId={currentProject.id} stage={currentProject.stage} projects={[currentProject, nextProject]} />);

  const picker = screen.getByRole("button", { name: "현재 프로젝트 선택" });
  expect(picker).toHaveAttribute("aria-expanded", "false");

  fireEvent.click(picker);

  expect(screen.getByRole("listbox", { name: "프로젝트 목록" })).toBeVisible();
  expect(screen.getByRole("option", { name: /현재 프로젝트/ })).toHaveAttribute("aria-selected", "true");
  const nextOption = screen.getByRole("option", { name: /다음 프로젝트/ });
  expect(nextOption).toHaveAttribute("aria-selected", "false");

  fireEvent.click(nextOption);

  expect(window.location.pathname).toBe(`/projects/${nextProject.id}/design`);
  expect(screen.queryByRole("listbox", { name: "프로젝트 목록" })).not.toBeInTheDocument();
});

test("closes the project list with Escape and returns focus to the picker", () => {
  render(<TopWorkflow projectName={currentProject.title} projectId={currentProject.id} stage={currentProject.stage} projects={[currentProject, nextProject]} />);
  const picker = screen.getByRole("button", { name: "현재 프로젝트 선택" });

  fireEvent.click(picker);
  fireEvent.keyDown(document, { key: "Escape" });

  expect(screen.queryByRole("listbox", { name: "프로젝트 목록" })).not.toBeInTheDocument();
  expect(picker).toHaveAttribute("aria-expanded", "false");
  expect(picker).toHaveFocus();
});

test("loads the project list when a page does not provide it", async () => {
  vi.spyOn(apiClient, "listProjects").mockResolvedValue([nextProject]);
  render(<TopWorkflow projectName="프로젝트" stage="idea" />);

  fireEvent.click(screen.getByRole("button", { name: "현재 프로젝트 선택" }));

  expect(await screen.findByRole("option", { name: /다음 프로젝트/ })).toBeVisible();
  expect(apiClient.listProjects).toHaveBeenCalledTimes(1);
});

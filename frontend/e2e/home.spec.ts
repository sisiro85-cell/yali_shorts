import { expect, test } from "@playwright/test";

const project = { id: "8c0afd1b-a242-4a3e-9e2b-8d9625212486", title: "AI 자동화 뉴스 쇼츠", status: "cuts", stage: "cuts", scene_count: 1, cut_count: 6, progress: 50, updated_at: "2026-09-03T01:42:00Z" };

test("home shell renders interactive workflow and collapses its secondary panel", async ({ page }) => {
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [project] } }));
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.goto("/");
  await expect(page.getByText("AI 자동화 뉴스 쇼츠").first()).toBeVisible();
  await expect(page.getByText("원본 미디어가 없습니다.")).toBeVisible();
  await expect(page.getByRole("img", { name: "AI 자동화 뉴스 쇼츠 원본 미디어" })).toHaveCount(0);
  await expect(page.getByLabel("제작 진행 단계").locator('[aria-current="step"]')).toHaveText("컷 구성");
  await page.screenshot({ path: "test-results/home-shell-expanded.png", fullPage: true });
  const mainWidth = (await page.locator(".app-shell__main").boundingBox())?.width ?? 0;
  await page.getByRole("button", { name: "우측 패널 접기" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/app-shell--context-collapsed/);
  await expect(page.locator(".app-shell__context")).toBeHidden();
  expect((await page.locator(".app-shell__main").boundingBox())?.width).toBeGreaterThan(mainWidth);
  await page.getByRole("button", { name: "우측 패널 펼치기" }).click();
  await expect(page.locator(".app-shell__context")).toBeVisible();
  await page.screenshot({ path: "test-results/home-shell.png", fullPage: true });

  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator(".app-shell__context")).toBeVisible();
  await page.getByRole("button", { name: "우측 패널 접기" }).click();
  await expect(page.getByRole("button", { name: "우측 패널 펼치기" })).toBeVisible();
  await page.getByRole("button", { name: "우측 패널 펼치기" }).click();
  await expect(page.locator(".app-shell__context")).toBeVisible();

  await page.setViewportSize({ width: 820, height: 800 });
  await expect(page.locator(".app-shell")).toHaveCSS("grid-template-columns", /76px/);
  await page.getByRole("button", { name: "우측 패널 접기" }).click();
  await expect(page.getByRole("button", { name: "우측 패널 펼치기" })).toBeVisible();
});

test("home shell reflows below desktop width without overlay or clipped navigation", async ({ page }) => {
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [project] } }));
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.goto("/");

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 768, height: 700 },
    { width: 375, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>(".app-shell__main")?.getBoundingClientRect();
      const context = document.querySelector<HTMLElement>(".app-shell__context");
      const contextRect = context?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainBottom: main?.bottom ?? 0,
        mainLeft: main?.left ?? 0,
        mainWidth: main?.width ?? 0,
        contextTop: contextRect?.top ?? 0,
        contextLeft: contextRect?.left ?? 0,
        contextWidth: contextRect?.width ?? 0,
        contextVisible: !!context && getComputedStyle(context).display !== "none",
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    if (layout.contextVisible) {
      expect(layout.contextTop).toBeGreaterThanOrEqual(layout.mainBottom - 1);
      expect(layout.contextLeft).toBeCloseTo(layout.mainLeft, 0);
      expect(layout.contextWidth).toBeGreaterThanOrEqual(layout.mainWidth - 1);
    }
  }

  await page.setViewportSize({ width: 768, height: 700 });
  expect(await page.locator(".nav-link__label").count()).toBeGreaterThan(0);
  const navLabelStyles = await page.locator(".nav-link__label").evaluateAll((labels) => labels.map((label) => {
    const style = getComputedStyle(label);
    return { display: style.display, position: style.position, width: style.width, height: style.height };
  }));
  expect(navLabelStyles.every((style) => style.display !== "none" && style.position === "absolute" && style.width === "1px" && style.height === "1px")).toBe(true);
  await expect(page.getByRole("link", { name: "아이디어" })).toHaveCount(1);
});

test("project picker opens the saved projects and moves to the selected workflow stage", async ({ page }) => {
  const secondProject = { ...project, id: "536b165a-c332-4319-826e-737030e2035b", title: "다른 프로젝트", status: "design", stage: "design", cut_count: 8, progress: 70 };
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [project, secondProject] } }));
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.goto("/");

  await expect(page.getByRole("button", { name: "현재 프로젝트 선택" })).toBeVisible();
  await page.getByRole("button", { name: "현재 프로젝트 선택" }).click();
  await expect(page.getByRole("listbox", { name: "프로젝트 목록" })).toBeVisible();
  await expect(page.getByRole("option", { name: /다른 프로젝트/ })).toContainText("디자인");

  await page.getByRole("option", { name: /다른 프로젝트/ }).click();
  await expect(page).toHaveURL(`/projects/${secondProject.id}/design`);
});

test("project deletion requires confirmation and updates the home list", async ({ page }) => {
  let deleteRequests = 0;
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [project] } }));
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      deleteRequests += 1;
      await route.fulfill({ json: { id: project.id, deleted: true } });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.setViewportSize({ width: 375, height: 800 });
  const narrowLayout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
  expect(narrowLayout.documentWidth).toBeLessThanOrEqual(narrowLayout.viewportWidth + 1);
  await page.getByRole("button", { name: "AI 자동화 뉴스 쇼츠 프로젝트 삭제" }).click();
  await expect(page.getByRole("dialog", { name: "프로젝트 삭제 확인" })).toBeVisible();

  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByRole("dialog", { name: "프로젝트 삭제 확인" })).toHaveCount(0);
  expect(deleteRequests).toBe(0);

  await page.getByRole("button", { name: "AI 자동화 뉴스 쇼츠 프로젝트 삭제" }).click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "프로젝트 삭제 확인" })).toHaveCount(0);
  expect(deleteRequests).toBe(1);
  await expect(page.getByRole("region", { name: "최근 프로젝트" }))
    .toContainText("최근 프로젝트가 없습니다. 새 프로젝트로 시작해 보세요.");
});

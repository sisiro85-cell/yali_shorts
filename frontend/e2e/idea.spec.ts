import { expect, test } from "@playwright/test";

const projectId = "b6f86d5d-6d29-4c0f-8b0a-8d7c6cbcc001";

test("새 프로젝트가 아이디어 입력 화면으로 이동하고 형식 선택을 유지한다", async ({ page }) => {
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        json: { id: projectId, title: "새 프로젝트", status: "idea", stage: "idea" },
      });
      return;
    }
    await route.fulfill({ json: { projects: [] } });
  });
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route(`**/api/projects/${projectId}/ideas`, (route) =>
    route.fulfill({
      json: {
        project_id: projectId,
        project_title: "새 프로젝트",
        stage: "idea",
        draft: { topic: "", source_text: "", formats: [], reference_asset_ids: [], updated_at: "2026-09-03T00:00:00Z" },
        reference_assets: [],
      },
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "새 프로젝트", exact: true }).click();

  await expect(page).toHaveURL(`/projects/${projectId}/idea`);
  await expect(page.getByRole("heading", { name: "아이디어 만들기" })).toBeVisible();
  await expect(page.getByText("아직 추가된 자료가 없습니다.")).toBeVisible();

  await page.getByLabel("주제 / 키워드").fill("퇴근 후 시간을 되찾는 방법");
  await page.getByRole("button", { name: "쇼츠" }).click();
  await expect(page.getByRole("button", { name: "쇼츠" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/idea-screen.png", fullPage: true });
});

test("아이디어 생성 요청 중에도 입력을 수정하고 작업을 취소할 수 있다", async ({ page }) => {
  const jobId = "2cc8a92b-8cd9-4cb9-9c4f-1920b388c002";
  let generationRequestBody: unknown;
  const ideaPage = {
    project_id: projectId,
    project_title: "생성 테스트 프로젝트",
    stage: "idea",
    draft: { topic: "", source_text: "", formats: [], reference_asset_ids: [], updated_at: "2026-09-03T00:00:00Z" },
    reference_assets: [],
  };
  await page.route(`**/api/projects/${projectId}/ideas`, (route) => route.fulfill({ json: ideaPage }));
  await page.route(`**/api/projects/${projectId}/ideas/generate`, async (route) => {
    generationRequestBody = route.request().postDataJSON();
    await route.fulfill({ status: 202, json: { job_id: jobId, status: "queued" } });
  });
  await page.route(`**/api/projects/${projectId}/ideas/jobs/${jobId}/cancel`, (route) =>
    route.fulfill({ json: { id: jobId, project_id: projectId, cut_id: null, kind: "idea.generate", status: "cancelled", progress: 0, error: null, retry_count: 0 } }),
  );

  await page.goto(`/projects/${projectId}/idea`);
  await page.getByLabel("주제 / 키워드").fill("재택근무 집중력 높이는 방법");
  await page.getByRole("button", { name: "릴스" }).click();
  await page.getByRole("button", { name: "아이디어 생성 시작" }).click();
  await expect(page.getByText("아이디어 생성 요청이 작업 큐에 등록되었습니다.")).toBeVisible();
  expect(generationRequestBody).toEqual({ topic: "재택근무 집중력 높이는 방법", source_text: "", formats: ["reels"], reference_asset_ids: [] });
  await page.getByLabel("주제 / 키워드").fill("수정 가능한 입력");
  await expect(page.getByLabel("주제 / 키워드")).toHaveValue("수정 가능한 입력");
  await page.getByRole("button", { name: "생성 취소" }).click();
  await expect(page.getByText("취소됨")).toBeVisible();
});

test("축소된 아이디어 화면에서 생성 안내가 본문과 겹치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1240, height: 900 });
  await page.route(`**/api/projects/${projectId}/ideas`, (route) => route.fulfill({
    json: {
      project_id: projectId,
      project_title: "새 프로젝트",
      stage: "idea",
      draft: { topic: "", source_text: "", formats: [], reference_asset_ids: [], updated_at: "2026-09-03T00:00:00Z" },
      reference_assets: [],
    },
  }));

  await page.goto(`/projects/${projectId}/idea`);
  await expect(page.getByRole("heading", { name: "아이디어 만들기" })).toBeVisible();

  const overlap = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".app-shell__main")?.getBoundingClientRect();
    const context = document.querySelector<HTMLElement>(".app-shell__context")?.getBoundingClientRect();
    if (!main || !context || context.width === 0 || context.height === 0) return false;
    return context.left < main.right && context.right > main.left && context.top < main.bottom && context.bottom > main.top;
  });

  expect(overlap).toBe(false);
});

test("도움말 아이콘은 hover와 키보드 focus에서 설명을 표시한다", async ({ page }) => {
  await page.route(`**/api/projects/${projectId}/ideas`, (route) => route.fulfill({
    json: {
      project_id: projectId,
      project_title: "새 프로젝트",
      stage: "idea",
      draft: { topic: "", source_text: "", formats: [], reference_asset_ids: [], updated_at: "2026-09-03T00:00:00Z" },
      reference_assets: [],
    },
  }));

  await page.goto(`/projects/${projectId}/idea`);
  const help = page.getByRole("button", { name: "출처 도움말" });
  const tooltip = page.getByRole("tooltip");

  await expect(help).toBeVisible();
  await expect(tooltip).toHaveCount(0);

  await help.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText("아이디어 생성에 참고할 원문이나 핵심 내용을 입력합니다.");

  await page.mouse.move(8, 8);
  await expect(tooltip).toHaveCount(0);

  await help.focus();
  await expect(tooltip).toBeVisible();
  await expect(help).toHaveAttribute("aria-describedby", /idea-help-/);
  await page.screenshot({ path: "test-results/idea-help-tooltip.png", fullPage: false });

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/projects/${projectId}/idea`);
  const mobileHelp = page.getByRole("button", { name: "출처 도움말" });
  await mobileHelp.hover();
  const mobileTooltip = page.getByRole("tooltip");
  const mobileBox = await mobileTooltip.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBox!.x + mobileBox!.width).toBeLessThanOrEqual(375);
});

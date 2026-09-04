import { expect, test } from "@playwright/test";

const projectId = "c7f86d5d-6d29-4c0f-8b0a-8d7c6cbcc002";

const emptyBoard = {
  project_id: projectId,
  project_title: "컷 보드 생성 테스트",
  stage: "script",
  script_version_id: "script-version-1",
  stale: false,
  scenes: [],
};

const generatedBoard = {
  ...emptyBoard,
  stage: "cuts",
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

test("cuts stage generates a board and displays each cut card", async ({ page }) => {
  await page.route(`**/api/projects/${projectId}/cuts`, (route) => route.fulfill({ json: emptyBoard }));
  await page.route(`**/api/projects/${projectId}/cuts/generate`, (route) => route.fulfill({ json: generatedBoard }));

  await page.goto(`/projects/${projectId}/cuts`);
  await expect(page.getByRole("heading", { name: "컷 구성", exact: true })).toBeVisible();
  await expect(page.getByText("아직 생성된 컷 보드가 없습니다.")).toBeVisible();

  await page.getByRole("button", { name: "컷 보드 생성" }).click();

  await expect(page.getByRole("heading", { name: "도입" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "문제 제시" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "해결 방법" })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "도시 사무실에서 반복 업무를 처리하는 장면" })).toBeVisible();
  await expect(page.getByText("이미지 생성 대기")).toBeVisible();
  await expect(page.getByText("컷 보드를 생성했습니다. 컷별 내용을 확인해 주세요.")).toBeVisible();
});

test("cuts stage provides a path to the design stage after a board is ready", async ({ page }) => {
  let projectPatch: unknown;
  await page.route(`**/api/projects/${projectId}/cuts`, (route) => route.fulfill({ json: generatedBoard }));
  await page.route(`**/api/projects/${projectId}`, async (route) => {
    projectPatch = route.request().postDataJSON();
    await route.fulfill({ status: 200, json: { id: projectId, title: "컷 보드 생성 테스트", stage: "design", status: "design" } });
  });
  await page.route(`**/api/projects/${projectId}/ideas`, (route) => route.fulfill({
    json: {
      project_id: projectId,
      project_title: "컷 보드 생성 테스트",
      stage: "design",
      draft: { topic: "자동화 뉴스", source_text: "", formats: ["shorts"], reference_asset_ids: [], updated_at: "2026-09-03T00:00:00Z" },
      reference_assets: [],
      active_version: { id: "idea-version-1", headline: "자동화 뉴스 아이디어", summary: "아이디어 요약", key_points: ["핵심 포인트"], created_at: "2026-09-03T00:00:00Z" },
    },
  }));

  await page.goto(`/projects/${projectId}/cuts`);
  await expect(page.getByRole("heading", { name: "문제 제시" })).toBeVisible();
  await expect(page.getByRole("button", { name: "디자인으로 이동" })).toBeVisible();

  await page.getByRole("button", { name: "디자인으로 이동" }).click();

  expect(projectPatch).toEqual({ stage: "design", status: "design" });
  await expect(page).toHaveURL(`/projects/${projectId}/design`);
  await expect(page.getByRole("heading", { name: "디자인", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "컷 1 문제 제시 이미지" })).toBeVisible();
  await expect(page.getByRole("button", { name: "컷 2 이미지 생성" })).toBeVisible();
});

test("design stage renders the selected cut image and regenerates only that cut", async ({ page }) => {
  const regeneratedBoard = {
    ...generatedBoard,
    stage: "design",
    scenes: [{
      ...generatedBoard.scenes[0],
      cuts: [
        generatedBoard.scenes[0].cuts[0],
        { ...generatedBoard.scenes[0].cuts[1], media_asset_id: "asset-2", status: "ready" },
      ],
    }],
  };
  let hasRegenerated = false;
  let projectPatch: unknown;

  await page.route(`**/api/projects/${projectId}/cuts`, async (route) => {
    await route.fulfill({ json: hasRegenerated ? regeneratedBoard : generatedBoard });
  });
  await page.route(`**/api/projects/${projectId}/cuts/cut-2/regenerate`, async (route) => {
    hasRegenerated = true;
    await route.fulfill({
      status: 202,
      json: { job_id: "design-job-2", cut_id: "cut-2", status: "queued" },
    });
  });
  await page.route(`**/api/jobs?project_id=${projectId}`, (route) => route.fulfill({
    json: { jobs: [{ id: "design-job-2", project_id: projectId, cut_id: "cut-2", kind: "cut.regenerate", status: "completed", progress: 100, error: null, retry_count: 0 }] },
  }));
  await page.route(`**/api/projects/${projectId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      projectPatch = route.request().postDataJSON();
      await route.fulfill({ status: 200, json: { id: projectId, title: "컷 보드 생성 테스트", stage: "output", status: "output" } });
      return;
    }
    await route.continue();
  });
  await page.route(`**/api/projects/${projectId}/ideas`, (route) => route.fulfill({
    json: { project_id: projectId, project_title: "컷 보드 생성 테스트", stage: "output", draft: null, reference_assets: [], active_version: null },
  }));

  await page.goto(`/projects/${projectId}/design`);

  await expect(page.getByRole("heading", { name: "디자인", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "컷 1 문제 제시 이미지" })).toHaveAttribute("src", /\/api\/projects\/.*\/assets\/asset-1\/preview/);
  await expect(page.getByText("이미지 생성 대기")).toBeVisible();
  await expect(page.getByRole("button", { name: "출력으로 이동" })).toBeDisabled();

  await page.getByRole("button", { name: "컷 2 이미지 생성" }).click();

  await expect(page.getByRole("img", { name: "컷 2 해결 방법 이미지" })).toBeVisible();
  await expect(page.getByRole("button", { name: "출력으로 이동" })).toBeEnabled();
  await expect(page.getByText("컷 2 이미지 재생성을 완료했습니다.")).toBeVisible();

  await page.getByRole("button", { name: "출력으로 이동" }).click();
  expect(projectPatch).toEqual({ stage: "output", status: "output" });
  await expect(page).toHaveURL(`/projects/${projectId}/output`);
});

test("cuts stage does not show a stale board as current", async ({ page }) => {
  await page.route(`**/api/projects/${projectId}/cuts`, (route) => route.fulfill({
    json: { ...generatedBoard, stale: true },
  }));

  await page.goto(`/projects/${projectId}/cuts`);

  await expect(page.getByRole("status")).toContainText("현재 대본과 맞지 않는 컷 보드입니다.");
  await expect(page.getByRole("heading", { name: "문제 제시" })).not.toBeVisible();
  await expect(page.getByText("도시 사무실에서 반복 업무를 처리하는 장면")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "최신 대본으로 다시 생성" })).toBeVisible();
});

test("cuts stage exposes a generation error", async ({ page }) => {
  await page.route(`**/api/projects/${projectId}/cuts`, (route) => route.fulfill({ json: emptyBoard }));
  await page.route(`**/api/projects/${projectId}/cuts/generate`, (route) => route.fulfill({
    status: 422,
    json: { code: "VALIDATION_ERROR", message: "대본을 먼저 생성해 주세요.", details: {} },
  }));

  await page.goto(`/projects/${projectId}/cuts`);
  await page.getByRole("button", { name: "컷 보드 생성" }).click();

  await expect(page.getByRole("alert")).toHaveText("대본을 먼저 생성해 주세요.");
  await expect(page.getByText("아직 생성된 컷 보드가 없습니다.")).not.toBeVisible();
});

test("regenerates only the selected cut and refreshes its result", async ({ page }) => {
  const regeneratedBoard = {
    ...generatedBoard,
    scenes: [{
      ...generatedBoard.scenes[0],
      cuts: [
        {
          ...generatedBoard.scenes[0].cuts[0],
          title: "문제 제시 개선",
          active_version_id: "cut-version-2",
          visual_prompt: "새로운 야간 사무실 장면",
          versions: [
            {
              id: "cut-version-1",
              created_at: "2026-09-03T03:00:00Z",
              visual_prompt: generatedBoard.scenes[0].cuts[0].visual_prompt,
              narration_text: generatedBoard.scenes[0].cuts[0].narration_text,
              subtitle: generatedBoard.scenes[0].cuts[0].subtitle,
              motion_preset: generatedBoard.scenes[0].cuts[0].motion_preset,
              media_asset_id: "asset-1",
              audio_asset_id: null,
            },
            {
              id: "cut-version-2",
              created_at: "2026-09-03T03:10:00Z",
              visual_prompt: "새로운 야간 사무실 장면",
              narration_text: generatedBoard.scenes[0].cuts[0].narration_text,
              subtitle: generatedBoard.scenes[0].cuts[0].subtitle,
              motion_preset: generatedBoard.scenes[0].cuts[0].motion_preset,
              media_asset_id: "asset-2",
              audio_asset_id: null,
            },
          ],
        },
        generatedBoard.scenes[0].cuts[1],
      ],
    }],
  };
  let boardReads = 0;
  let regenerationPayload: Record<string, unknown> | undefined;

  await page.route(`**/api/projects/${projectId}/cuts`, async (route) => {
    boardReads += 1;
    await route.fulfill({ json: boardReads <= 2 ? generatedBoard : regeneratedBoard });
  });
  await page.route(`**/api/projects/${projectId}/cuts/cut-1/regenerate`, async (route) => {
    regenerationPayload = (await route.request().postDataJSON()) as Record<string, unknown>;
    await route.fulfill({ status: 202, json: { job_id: "cut-job-1", cut_id: "cut-1", status: "queued" } });
  });
  await page.route(`**/api/jobs?project_id=${projectId}`, async (route) => {
    await route.fulfill({ json: { jobs: [{ id: "cut-job-1", project_id: projectId, cut_id: "cut-1", kind: "cut.regenerate", status: "completed", progress: 100, error: null, retry_count: 0 }] } });
  });

  await page.goto(`/projects/${projectId}/cuts`);
  await page.getByLabel("컷 1 이미지 생성 프롬프트").fill("새로운 야간 사무실 장면");
  await expect(page.getByLabel("컷 1 이미지 생성 프롬프트")).toHaveValue("새로운 야간 사무실 장면");
  await page.getByRole("button", { name: "컷 1 재생성" }).click();

  await expect(page.getByRole("heading", { name: "문제 제시 개선" })).toBeVisible();
  await expect(page.getByText("해결 방법")).toBeVisible();
  await expect(page.getByText("컷 1 재생성을 완료했습니다.")).toBeVisible();
  expect(regenerationPayload).toEqual({ visual_prompt: "새로운 야간 사무실 장면" });
});

test("locks a cut, prevents regeneration, and can restore its previous version", async ({ page }) => {
  const versionOne = {
    id: "cut-version-1",
    created_at: "2026-09-03T03:00:00Z",
    visual_prompt: "처음 생성한 사무실 장면",
    narration_text: "반복 업무는 시간을 빼앗습니다.",
    subtitle: "반복 업무는 시간을 빼앗습니다.",
    motion_preset: "static",
    media_asset_id: "asset-old",
    audio_asset_id: null,
  };
  const versionTwo = {
    ...versionOne,
    id: "cut-version-2",
    visual_prompt: "현재 사무실 장면",
    motion_preset: "slow-zoom",
    media_asset_id: "asset-1",
  };
  const versionedBoard = {
    ...generatedBoard,
    scenes: [{
      ...generatedBoard.scenes[0],
      cuts: [{ ...generatedBoard.scenes[0].cuts[0], active_version_id: versionTwo.id, versions: [versionOne, versionTwo] }, generatedBoard.scenes[0].cuts[1]],
    }],
  };
  const lockedCut = { ...versionedBoard.scenes[0].cuts[0], locked: true };
  const restoredCut = { ...lockedCut, active_version_id: versionOne.id };
  let lockRequests = 0;

  await page.route(`**/api/projects/${projectId}/cuts`, (route) => route.fulfill({ json: versionedBoard }));
  await page.route(`**/api/projects/${projectId}/cuts/cut-1/lock`, async (route) => {
    lockRequests += 1;
    await route.fulfill({ json: { cut_id: "cut-1", locked: true } });
  });
  await page.route(`**/api/projects/${projectId}/cuts/cut-1/versions/cut-version-1/activate`, (route) => route.fulfill({ json: restoredCut }));

  await page.goto(`/projects/${projectId}/cuts`);
  await page.getByRole("button", { name: "컷 1 잠금" }).click();

  await expect(page.getByRole("button", { name: "컷 1 잠금 해제" })).toBeVisible();
  await expect(page.getByRole("button", { name: "컷 1 재생성" })).toBeDisabled();
  expect(lockRequests).toBe(1);

  await page.getByRole("button", { name: "컷 1 버전 1 사용" }).click();
  await expect(page.getByRole("button", { name: "컷 1 버전 1 사용 중" })).toBeDisabled();
});

test("keeps cut actions within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 780 });
  await page.route(`**/api/projects/${projectId}/cuts`, (route) => route.fulfill({ json: generatedBoard }));

  await page.goto(`/projects/${projectId}/cuts`);
  await expect(page.getByLabel("컷 1 이미지 생성 프롬프트")).toBeVisible();
  await expect(page.getByRole("button", { name: "컷 1 재생성" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
});

import { expect, test } from "@playwright/test";

const projectId = "b6f86d5d-6d29-4c0f-8b0a-8d7c6cbcc001";
const emptyScriptPage = {
  project_id: projectId,
  project_title: "대본 생성 테스트",
  stage: "script",
  versions: [],
};
const generatedScriptPage = {
  ...emptyScriptPage,
  active_version: {
    id: "script-version-1",
    created_at: "2026-09-03T03:00:00Z",
    source_idea_version_id: "idea-version-1",
    hook: "반복 업무를 줄이는 첫 단계",
    body: "작은 업무부터 자동화합니다.",
    cta: "오늘 하나를 골라 보세요.",
    lines: [
      {
        id: "line-1",
        order: 1,
        speaker: "내레이션",
        text: "먼저 반복 업무를 찾습니다.",
        duration_ms: 1400,
        scene_intent: "문제 제시",
      },
    ],
  },
  versions: [],
};

test("script stage generates and displays the active script", async ({ page }) => {
  await page.route(`**/api/projects/${projectId}/script`, (route) => route.fulfill({ json: emptyScriptPage }));
  await page.route(`**/api/projects/${projectId}/script/generate`, (route) => route.fulfill({ json: generatedScriptPage }));

  await page.goto(`/projects/${projectId}/script`);
  await expect(page.getByRole("heading", { name: "대본 만들기" })).toBeVisible();
  await expect(page.getByText("아직 생성된 대본이 없습니다.")).toBeVisible();

  await page.getByRole("button", { name: "대본 생성" }).click();
  await expect(page.getByText("반복 업무를 줄이는 첫 단계")).toBeVisible();
  await expect(page.getByText("먼저 반복 업무를 찾습니다.")).toBeVisible();
  await expect(page.getByText("오늘 하나를 골라 보세요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "새 대본 생성" })).toBeVisible();
});

test("script stage provides a path to the cuts stage after a script is ready", async ({ page }) => {
  let projectPatch: unknown;
  await page.route(`**/api/projects/${projectId}/script`, (route) => route.fulfill({ json: generatedScriptPage }));
  await page.route(`**/api/projects/${projectId}`, async (route) => {
    projectPatch = route.request().postDataJSON();
    await route.fulfill({ status: 200, json: { id: projectId, title: "대본 생성 테스트", stage: "cuts", status: "cuts" } });
  });
  await page.route(`**/api/projects/${projectId}/cuts`, (route) => route.fulfill({
    json: {
      project_id: projectId,
      project_title: "대본 생성 테스트",
      stage: "cuts",
      script_version_id: generatedScriptPage.active_version.id,
      stale: false,
      scenes: [],
    },
  }));

  await page.goto(`/projects/${projectId}/script`);
  await expect(page.getByText("반복 업무를 줄이는 첫 단계")).toBeVisible();
  await expect(page.getByRole("button", { name: "컷 구성으로 이동" })).toBeVisible();

  await page.getByRole("button", { name: "컷 구성으로 이동" }).click();

  expect(projectPatch).toEqual({ stage: "cuts", status: "cuts" });
  await expect(page).toHaveURL(`/projects/${projectId}/cuts`);
  await expect(page.getByRole("heading", { name: "컷 구성", exact: true })).toBeVisible();
});

test("script stage exposes a generation error", async ({ page }) => {
  await page.route(`**/api/projects/${projectId}/script`, (route) => route.fulfill({ json: emptyScriptPage }));
  await page.route(`**/api/projects/${projectId}/script/generate`, (route) => route.fulfill({
    status: 422,
    json: { code: "VALIDATION_ERROR", message: "아이디어 결과를 먼저 확정해 주세요.", details: {} },
  }));

  await page.goto(`/projects/${projectId}/script`);
  await page.getByRole("button", { name: "대본 생성" }).click();
  await expect(page.getByRole("alert")).toHaveText("아이디어 결과를 먼저 확정해 주세요.");
});

test("unavailable stages keep the current project when returning to ideas", async ({ page }) => {
  await page.route(`**/api/projects/${projectId}/ideas`, (route) => route.fulfill({
    status: 404,
    json: { code: "PROJECT_NOT_FOUND", message: "프로젝트를 찾을 수 없습니다.", details: {} },
  }));

  await page.goto(`/projects/${projectId}/cuts`);
  await page.getByRole("button", { name: "아이디어로 돌아가기" }).click();
  await expect(page).toHaveURL(`/projects/${projectId}/idea`);
});

test("script stage edits a line and saves an immutable new version", async ({ page }) => {
  const oldVersion = generatedScriptPage.active_version;
  const editedVersion = {
    ...oldVersion,
    id: "script-version-2",
    lines: [{ ...oldVersion.lines[0], text: "수정된 내레이션" }],
  };
  const editedPage = {
    ...generatedScriptPage,
    active_version: editedVersion,
    versions: [oldVersion, editedVersion],
  };
  let patchPayload: Record<string, unknown> | undefined;

  await page.route(`**/api/projects/${projectId}/script`, (route) => route.fulfill({ json: generatedScriptPage }));
  await page.route(`**/api/projects/${projectId}/script/versions/script-version-1`, async (route) => {
    patchPayload = (await route.request().postDataJSON()) as Record<string, unknown>;
    await route.fulfill({ json: editedPage });
  });

  await page.goto(`/projects/${projectId}/script`);
  await page.getByRole("button", { name: "대본 편집" }).click();
  await page.getByLabel("1번 내레이션").fill("수정된 내레이션");
  await page.getByRole("button", { name: "대본 저장" }).click();

  await expect(page.getByText("수정된 내레이션")).toBeVisible();
  await expect(page.getByText("새 대본 버전을 저장했습니다.")).toBeVisible();
  expect(patchPayload?.lines).toEqual([expect.objectContaining({ order: 1, text: "수정된 내레이션" })]);
});

test("script stage activates an older version from the version history", async ({ page }) => {
  const activeVersion = generatedScriptPage.active_version;
  const olderVersion = { ...activeVersion, id: "script-version-0", hook: "이전 후킹 문장" };
  const versionedPage = {
    ...generatedScriptPage,
    active_version: activeVersion,
    versions: [olderVersion, activeVersion],
  };
  const restoredPage = { ...versionedPage, active_version: olderVersion };

  await page.route(`**/api/projects/${projectId}/script`, (route) => route.fulfill({ json: versionedPage }));
  await page.route(`**/api/projects/${projectId}/script/versions/script-version-0/activate`, (route) => route.fulfill({ json: restoredPage }));

  await page.goto(`/projects/${projectId}/script`);
  await page.getByRole("button", { name: "이 버전 사용" }).click();

  await expect(page.getByText("이전 후킹 문장")).toBeVisible();
  await expect(page.getByText("선택한 대본 버전을 활성화했습니다.")).toBeVisible();
});

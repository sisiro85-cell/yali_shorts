import { expect, test } from "@playwright/test";

const projectId = "d6f86d5d-6d29-4c0f-8b0a-8d7c6cbcc010";

const board = {
  project_id: projectId,
  project_title: "영상 설정 테스트 프로젝트",
  stage: "design",
  script_version_id: "script-version-1",
  target_aspect_ratio: "9:16",
  stale: false,
  scenes: [{
    id: "scene-1",
    order: 1,
    title: "도입",
    source_script_version_id: "script-version-1",
    cuts: [
      {
        id: "cut-1",
        order: 1,
        title: "문제 제시",
        duration_ms: 3500,
        visual_prompt: "스마트폰 화면 속 AI 채팅",
        media_asset_id: "asset-1",
        media_width: 1080,
        media_height: 1920,
        audio_asset_id: null,
        narration_text: "AI 자동화는 시간을 줄입니다.",
        subtitle: "AI 자동화는 시간을 줄입니다.",
        motion_preset: "static",
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
        duration_ms: 5000,
        visual_prompt: "업무 자동화 체크리스트",
        media_asset_id: null,
        media_width: null,
        media_height: null,
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
  }],
};

const initialSettings = {
  audio: { enabled: true, provider: "edge_tts", language: "ko-KR", voice_id: "ko-KR-SunHiNeural", speed: 1, volume: 0.85, pitch: 0 },
  subtitle: { enabled: true, style: { position: "bottom", font_family: "Pretendard", font_size: 60, color: "#FFFFFF", outline_color: "#111111", outline_width: 2, background_color: null, custom_x: 50, custom_y: 82, alignment: "center", max_lines: 2, safe_area: true } },
};

test("영상 설정을 컷 미리보기와 함께 수정하고 저장한다", async ({ page }) => {
  let settings = structuredClone(initialSettings);
  let patchPayload: unknown;
  await page.route(`**/api/projects/${projectId}/cuts`, (route) => route.fulfill({ json: board }));
  await page.route(`**/api/projects/${projectId}/video-settings`, async (route) => {
    if (route.request().method() === "PATCH") {
      patchPayload = await route.request().postDataJSON();
      const patch = patchPayload as Partial<typeof initialSettings>;
      settings = {
        ...settings,
        ...patch,
        audio: { ...settings.audio, ...(patch.audio ?? {}) },
        subtitle: {
          ...settings.subtitle,
          ...(patch.subtitle ?? {}),
          style: { ...settings.subtitle.style, ...(patch.subtitle?.style ?? {}) },
        },
      };
    }
    await route.fulfill({ json: settings });
  });
  await page.route(`**/api/projects/${projectId}/assets/asset-1/preview`, (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 9 16\"><rect width=\"9\" height=\"16\" fill=\"#806d5f\"/><circle cx=\"4.5\" cy=\"7\" r=\"2\" fill=\"#fff\"/></svg>",
  }));

  await page.goto(`/projects/${projectId}/design/settings`);
  await expect(page.getByRole("heading", { name: "음성·자막 설정" })).toBeVisible();
  await expect(page.getByRole("img", { name: "컷 1 미리보기" })).toBeVisible();

  await page.getByRole("slider", { name: "말하기 속도" }).fill("1.2");
  await page.getByRole("button", { name: "자막 위치: 상단" }).click();
  await page.getByRole("button", { name: "설정 저장" }).click();

  await expect(page.getByText("설정을 저장했습니다.")).toBeVisible();
  expect(patchPayload).toMatchObject({
    audio: { speed: 1.2 },
    subtitle: { style: { position: "top" } },
  });

  await page.screenshot({ path: "test-results/video-settings-desktop.png", fullPage: true });
  for (const viewport of [{ width: 1024, height: 768 }, { width: 820, height: 768 }, { width: 620, height: 844 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
  }
  await page.screenshot({ path: "test-results/video-settings-mobile.png", fullPage: true });
});

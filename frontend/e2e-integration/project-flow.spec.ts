import { expect, test } from "@playwright/test";

test("real FastAPI and persistent test provider complete and restore an idea", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "작업 공간" })).toBeVisible();

  await page.getByRole("button", { name: "새 프로젝트", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/idea$/);
  await expect(page.getByRole("heading", { name: "아이디어 만들기" })).toBeVisible();

  await page.getByLabel("주제 / 키워드").fill("통합 QA 흐름");
  await page.getByRole("button", { name: "쇼츠" }).click();
  await page.getByRole("button", { name: "아이디어 생성 시작" }).click();

  await expect(page.getByText("생성 완료")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "통합 QA 테스트 아이디어" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "통합 QA 테스트 아이디어" })).toBeVisible();
  await expect(page.getByText("생성 완료")).toBeVisible();
});

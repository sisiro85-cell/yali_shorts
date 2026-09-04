import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { CutBoardCut } from "../../app/api";
import { CutCard } from "./CutCard";

const cut: CutBoardCut = {
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
  active_version_id: "cut-version-2",
  versions: [
    {
      id: "cut-version-1",
      created_at: "2026-09-03T03:00:00Z",
      visual_prompt: "처음 생성한 사무실 장면",
      narration_text: "반복 업무는 시간을 빼앗습니다.",
      subtitle: "반복 업무는 시간을 빼앗습니다.",
      motion_preset: "static",
      media_asset_id: "asset-old",
      audio_asset_id: null,
    },
    {
      id: "cut-version-2",
      created_at: "2026-09-03T03:05:00Z",
      visual_prompt: "도시 사무실에서 반복 업무를 처리하는 장면",
      narration_text: "반복 업무는 시간을 빼앗습니다.",
      subtitle: "반복 업무는 시간을 빼앗습니다.",
      motion_preset: "slow-zoom",
      media_asset_id: "asset-1",
      audio_asset_id: null,
    },
  ],
};

test("sends only the selected cut's regeneration request", async () => {
  const onRegenerate = vi.fn().mockResolvedValue(undefined);

  render(
    <CutCard
      cut={cut}
      isBusy={false}
      onRegenerate={onRegenerate}
      onToggleLock={vi.fn()}
      onActivateVersion={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("컷 1 이미지 생성 프롬프트"), {
    target: { value: "새로운 야간 사무실 장면" },
  });
  fireEvent.click(screen.getByRole("button", { name: "컷 1 재생성" }));

  await waitFor(() => {
    expect(onRegenerate).toHaveBeenCalledWith("cut-1", { visual_prompt: "새로운 야간 사무실 장면" });
  });
});

test("disables regeneration for a locked cut and restores a previous version", async () => {
  const onActivateVersion = vi.fn().mockResolvedValue(undefined);

  render(
    <CutCard
      cut={{ ...cut, locked: true }}
      isBusy={false}
      onRegenerate={vi.fn()}
      onToggleLock={vi.fn()}
      onActivateVersion={onActivateVersion}
    />,
  );

  expect(screen.getByRole("button", { name: "컷 1 재생성" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "컷 1 잠금 해제" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "컷 1 버전 1 사용" }));
  await waitFor(() => expect(onActivateVersion).toHaveBeenCalledWith("cut-1", "cut-version-1"));
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ScriptEditor } from "./ScriptEditor";

const generatedScript = {
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
};

test("shows the generated script sections and narration lines", () => {
  render(<ScriptEditor data={generatedScript} isGenerating={false} error="" onGenerate={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "대본 만들기" })).toBeInTheDocument();
  expect(screen.getByText("반복 업무를 줄이는 첫 단계")).toBeInTheDocument();
  expect(screen.getByText("먼저 반복 업무를 찾습니다.")).toBeInTheDocument();
  expect(screen.getByText("오늘 하나를 골라 보세요.")).toBeInTheDocument();
});

test("edits a narration line and saves a new script version", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);

  render(
    <ScriptEditor
      data={generatedScript}
      versions={[generatedScript]}
      isGenerating={false}
      error=""
      onGenerate={vi.fn()}
      onSave={onSave}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "대본 편집" }));
  fireEvent.change(screen.getByLabelText("1번 내레이션"), {
    target: { value: "수정된 내레이션" },
  });
  fireEvent.click(screen.getByRole("button", { name: "대본 저장" }));

  await waitFor(() => expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      lines: [expect.objectContaining({ text: "수정된 내레이션", order: 1 })],
    }),
  ));
});

test("activates an older script version from version history", async () => {
  const olderVersion = { ...generatedScript, id: "script-version-0", hook: "이전 후킹 문장" };
  const onActivate = vi.fn().mockResolvedValue(undefined);

  render(
    <ScriptEditor
      data={generatedScript}
      versions={[olderVersion, generatedScript]}
      isGenerating={false}
      error=""
      onGenerate={vi.fn()}
      onActivate={onActivate}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "이 버전 사용" }));

  await waitFor(() => expect(onActivate).toHaveBeenCalledWith("script-version-0"));
});

test("disables historical version activation while editing", () => {
  const olderVersion = { ...generatedScript, id: "script-version-0", hook: "이전 후킹 문장" };

  render(
    <ScriptEditor
      data={generatedScript}
      versions={[olderVersion, generatedScript]}
      isGenerating={false}
      error=""
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onActivate={vi.fn()}
    />,
  );

  const buttonsBeforeEdit = screen.getAllByRole("button", { name: /사용|이 버전 사용/ });
  expect(buttonsBeforeEdit[0]).toBeEnabled();
  expect(buttonsBeforeEdit[1]).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "대본 편집" }));

  const buttonsWhileEditing = screen.getAllByRole("button", { name: /사용|이 버전 사용/ });
  expect(buttonsWhileEditing[0]).toBeDisabled();
  expect(buttonsWhileEditing[1]).toBeDisabled();
});

test("disables entering edit mode while a version activation is in flight", () => {
  const olderVersion = { ...generatedScript, id: "script-version-0", hook: "이전 후킹 문장" };

  render(
    <ScriptEditor
      data={generatedScript}
      versions={[olderVersion, generatedScript]}
      isGenerating={false}
      isActivating
      error=""
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onActivate={vi.fn()}
    />,
  );

  const editButton = screen.getByRole("button", { name: "버전 전환 중…" });
  expect(editButton).toBeDisabled();
  expect(editButton).toHaveAttribute("aria-busy", "true");
});

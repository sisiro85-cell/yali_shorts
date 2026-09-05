import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { apiClient } from "../app/api";
import { VideoSettingsPage } from "./VideoSettingsPage";

vi.mock("../app/api", async () => {
  const actual = await vi.importActual<typeof import("../app/api")>("../app/api");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getCutBoard: vi.fn(),
      getVideoSettings: vi.fn(),
      updateVideoSettings: vi.fn(),
      updateCutVideoSettings: vi.fn(),
      updateProject: vi.fn(),
    },
  };
});

const mockedApi = apiClient as unknown as {
  getCutBoard: ReturnType<typeof vi.fn>;
  getVideoSettings: ReturnType<typeof vi.fn>;
  updateVideoSettings: ReturnType<typeof vi.fn>;
  updateCutVideoSettings: ReturnType<typeof vi.fn>;
  updateProject: ReturnType<typeof vi.fn>;
};

const board = {
  project_id: "project-1",
  project_title: "자동화 뉴스 쇼츠",
  stage: "design" as const,
  script_version_id: "script-version-1",
  target_aspect_ratio: "9:16" as const,
  stale: false,
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
          duration_ms: 3500,
          visual_prompt: "스마트폰 화면 속 AI 채팅 장면",
          media_asset_id: "asset-1",
          media_width: 1080,
          media_height: 1920,
          audio_asset_id: null,
          narration_text: "AI 자동화는 시간을 줄입니다.",
          subtitle: "AI 자동화는 시간을 줄입니다.",
          motion_preset: "static",
          locked: false,
           status: "ready" as const,
           error: null,
           active_version_id: "cut-version-1",
           video_settings_overrides: {},
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
           status: "draft" as const,
           error: null,
           active_version_id: null,
           video_settings_overrides: {},
           versions: [],
        },
      ],
    },
  ],
};

const settings = {
  audio: {
    enabled: true,
    provider: "edge_tts" as const,
    language: "ko-KR",
    voice_id: "ko-KR-SunHiNeural",
    speed: 1,
    volume: 0.85,
    pitch: 0,
  },
  subtitle: {
    enabled: true,
    style: {
      position: "bottom" as const,
      font_family: "Pretendard",
      font_size: 60,
      color: "#FFFFFF",
      outline_color: "#111111",
      outline_width: 2,
      background_color: null,
      custom_x: 50,
      custom_y: 82,
      alignment: "center" as const,
      max_lines: 2,
      safe_area: true,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getCutBoard.mockResolvedValue(board);
  mockedApi.getVideoSettings.mockResolvedValue(settings);
  mockedApi.updateVideoSettings.mockImplementation(async (_projectId: string, next: unknown) => next);
  mockedApi.updateCutVideoSettings.mockImplementation(async (_projectId: string, cutId: string, patch: unknown) => ({
    ...board.scenes[0].cuts.find((cut) => cut.id === cutId),
    video_settings_overrides: patch,
  }));
  mockedApi.updateProject.mockResolvedValue({ id: "project-1", title: "자동화 뉴스 쇼츠", stage: "output", status: "output" });
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

test("컷 미리보기와 프로젝트 기본 음성·자막 설정을 표시한다", async () => {
  render(<VideoSettingsPage projectId="project-1" />);

  expect(await screen.findByRole("heading", { name: "음성·자막 설정" })).toBeInTheDocument();
  expect(screen.getAllByText("프로젝트 기본값").length).toBeGreaterThan(0);
  expect(screen.getByText("전체 2컷에 적용")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "컷 1 미리보기" })).toHaveAttribute(
    "src",
    expect.stringContaining("/api/projects/project-1/assets/asset-1/preview"),
  );
  expect(screen.getByText("AI 자동화는 시간을 줄입니다.")).toBeInTheDocument();
  expect(screen.getByLabelText("음성 엔진")).toHaveValue("edge_tts");
});

test("미리보기 컷을 바꾸고 음성 속도와 자막 위치를 저장한다", async () => {
  render(<VideoSettingsPage projectId="project-1" />);

  await screen.findByRole("heading", { name: "음성·자막 설정" });
  fireEvent.change(screen.getByLabelText("미리보기 컷"), { target: { value: "cut-2" } });
  fireEvent.change(screen.getByRole("slider", { name: "말하기 속도" }), { target: { value: "1.2" } });
  fireEvent.click(screen.getByRole("button", { name: "자막 위치: 상단" }));

  expect(screen.getByText("작은 업무부터 자동화해 보세요.")).toBeInTheDocument();
  expect(screen.getByText("미리보기 이미지 없음")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "자막 위치: 상단" })).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

  await waitFor(() => expect(mockedApi.updateVideoSettings).toHaveBeenCalledWith(
    "project-1",
    expect.objectContaining({
      audio: expect.objectContaining({ speed: 1.2 }),
      subtitle: expect.objectContaining({
        style: expect.objectContaining({ position: "top" }),
      }),
    }),
  ));
  expect(await screen.findByText("설정을 저장했습니다.")).toBeInTheDocument();
});

test("무료 라이선스 한글 글꼴을 추가로 선택할 수 있다", async () => {
  render(<VideoSettingsPage projectId="project-1" />);

  const fontSelect = await screen.findByLabelText("자막 글꼴");
  expect(screen.getByRole("group", { name: "무료 라이선스 한글 글꼴" })).toBeInTheDocument();
  for (const font of ["Noto Serif KR", "SUIT", "Spoqa Han Sans Neo", "IBM Plex Sans KR", "나눔명조"]) {
    expect(screen.getByRole("option", { name: font })).toBeInTheDocument();
  }
  expect(screen.getByText(/SIL Open Font License 1\.1/)).toBeInTheDocument();

  fireEvent.change(fontSelect, { target: { value: "SUIT" } });
  expect(fontSelect).toHaveValue("SUIT");
  expect(screen.getByRole("button", { name: "설정 저장" })).toBeEnabled();
});

test("선택한 컷 예외는 프로젝트 기본값에서 시작하고 변경 필드만 저장한다", async () => {
  render(<VideoSettingsPage projectId="project-1" />);

  await screen.findByRole("heading", { name: "음성·자막 설정" });
  fireEvent.click(screen.getByRole("button", { name: "컷 1 예외 설정" }));
  fireEvent.click(screen.getByRole("button", { name: "자막 위치: 상단" }));

  expect(screen.getAllByText("컷 1 예외 설정").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "자막 위치: 상단" })).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(screen.getByRole("button", { name: "컷 예외 저장" }));

  await waitFor(() => expect(mockedApi.updateCutVideoSettings).toHaveBeenCalledWith(
    "project-1",
    "cut-1",
    { subtitle: { style: { position: "top" } } },
  ));
  expect(await screen.findByText("컷별 예외 설정을 저장했습니다.")).toBeInTheDocument();
});

test("presents video settings as step five and continues to output", async () => {
  render(<VideoSettingsPage projectId="project-1" />);

  expect(await screen.findByText("영상 설정 단계 · 음성·자막 설정")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다음: 출력으로 이동" }));

  await waitFor(() => expect(mockedApi.updateProject).toHaveBeenCalledWith("project-1", { stage: "output", status: "output" }));
  expect(window.location.pathname).toBe("/projects/project-1/output");
});

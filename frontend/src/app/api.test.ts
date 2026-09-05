import { afterEach, expect, test, vi } from "vitest";
import { apiClient } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("아이디어 생성 요청은 멱등성 키와 JSON content type을 함께 보낸다", async () => {
  let receivedInit: RequestInit | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: string, init?: RequestInit) => {
      receivedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ job_id: "job-1", status: "queued" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );

  await apiClient.generateIdea(
    "project-1",
    { topic: "마케팅 트렌드", source_text: "", formats: ["shorts"], reference_asset_ids: [] },
    "request-1",
  );

  const headers = new Headers(receivedInit?.headers);
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(headers.get("Idempotency-Key")).toBe("request-1");
});

test("영상 설정을 프로젝트별로 조회하고 부분 수정한다", async () => {
  const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({
        audio: { speed: 1.2 },
        subtitle: { style: { position: "top" } },
      }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({
      audio: { provider: "edge_tts", speed: 1 },
      subtitle: { enabled: true, style: { position: "bottom" } },
    }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  await apiClient.getVideoSettings("project-1");
  await apiClient.updateVideoSettings("project-1", { audio: { speed: 1.2 } });

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("/projects/project-1/video-settings"),
    expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
  );
  const [, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(patchInit.method).toBe("PATCH");
  expect(JSON.parse(String(patchInit.body))).toEqual({ audio: { speed: 1.2 } });
});

test("작업 상태를 단일 작업 API로 조회한다", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
    id: "job-1",
    project_id: "project-1",
    cut_id: "cut-1",
    kind: "cut.regenerate",
    status: "running",
    progress: 42,
    error: null,
    retry_count: 0,
  }), { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);

  const job = await apiClient.getJob("job-1");

  expect(job.status).toBe("running");
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/jobs/job-1"),
    expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
  );
});

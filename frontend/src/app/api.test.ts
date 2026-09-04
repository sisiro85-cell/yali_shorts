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

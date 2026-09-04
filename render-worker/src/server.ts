import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { renderManifest } from "./renderer.js";
import type { RenderManifest, RenderOptions } from "./types.js";

const MAX_BODY_BYTES = 10_000_000;

export function startServer(port = Number(process.env.YALI_RENDER_PORT ?? 8010)) {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, { status: "ready", renderer: "hyperframes" });
      return;
    }
    if (request.method !== "POST" || request.url !== "/render") {
      writeJson(response, 404, { code: "NOT_FOUND", message: "Render endpoint not found" });
      return;
    }
    try {
      const payload = JSON.parse(await readBody(request)) as { manifest: RenderManifest; options: RenderOptions };
      const projectRoot = await validateRenderProjectRoot(
        payload.options.projectRoot,
        payload.manifest.project_id,
      );
      await renderManifest(payload.manifest, { ...payload.options, projectRoot });
      writeJson(response, 202, { status: "accepted", output_path: payload.options.outputPath });
    } catch {
      writeJson(response, 400, { code: "RENDER_FAILED", message: "Render request could not be completed" });
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

export async function validateRenderProjectRoot(
  projectRoot: string,
  projectId: string,
  allowedProjectsRoot = process.env.YALI_PROJECTS_ROOT || join(process.cwd(), "storage", "projects"),
): Promise<string> {
  const requestedRoot = resolve(projectRoot);
  const allowedRoot = resolve(allowedProjectsRoot);
  let realRequestedRoot: string;
  let realAllowedRoot: string;
  try {
    [realRequestedRoot, realAllowedRoot] = await Promise.all([
      realpath(requestedRoot),
      realpath(allowedRoot),
    ]);
  } catch {
    throw new Error("Render project root is unavailable");
  }
  if (!isInside(realRequestedRoot, realAllowedRoot)) {
    throw new Error("Render project root is outside the configured projects directory");
  }
  if (basename(realRequestedRoot).toLowerCase() !== projectId.toLowerCase()) {
    throw new Error("Render project root does not match the manifest project");
  }
  return realRequestedRoot;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function writeJson(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function isInside(candidate: string, parent: string): boolean {
  const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const normalizedParent = (process.platform === "win32" ? parent.toLowerCase() : parent).replace(/[\\/]$/, "");
  const separator = process.platform === "win32" ? "\\" : "/";
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${separator}`);
}

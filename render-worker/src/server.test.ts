import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, validateRenderProjectRoot } from "./server.js";

test("render worker exposes a local health endpoint", async () => {
  const server = startServer(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ready", renderer: "hyperframes" });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("render worker only accepts a project root under its configured projects directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "yali-render-server-"));
  const projectsRoot = join(root, "storage", "projects");
  const projectRoot = join(projectsRoot, "project-1");
  const outsideRoot = join(root, "outside", "project-1");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  try {
    assert.equal(
      await validateRenderProjectRoot(projectRoot, "project-1", projectsRoot),
      projectRoot,
    );
    await assert.rejects(
      validateRenderProjectRoot(outsideRoot, "project-1", projectsRoot),
      /outside the configured projects directory/,
    );
    await assert.rejects(
      validateRenderProjectRoot(projectsRoot, "project-1", projectsRoot),
      /does not match/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

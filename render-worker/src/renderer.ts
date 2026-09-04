import { access, lstat, mkdir, mkdtemp, realpath, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { assertRenderManifest, createCompositionHtml } from "./composition.js";
import type { RenderManifest, RenderOptions } from "./types.js";

export class RenderError extends Error {}

export async function renderManifest(manifest: RenderManifest, options: RenderOptions): Promise<void> {
  assertRenderManifest(manifest);
  const projectRoot = resolve(options.projectRoot);
  const outputPath = resolveOutputPath(projectRoot, options.outputPath);
  await assertSourceAssetsExist(manifest, projectRoot);
  const compositionDir = await createCompositionWorkspace(projectRoot, manifest.output_variant_id);
  await ensureCompositionAssets(compositionDir, resolve(projectRoot, "assets"));
  await mkdir(dirname(outputPath), { recursive: true });
const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const extension = extname(outputPath) || ".mp4";
  const temporaryOutputPath = join(
    dirname(outputPath),
    `.${basename(outputPath, extension)}.partial${extension}`,
  );
  try {
    await writeAtomic(join(compositionDir, "index.html"), createCompositionHtml(manifest));
    await writeAtomic(join(compositionDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    await unlink(temporaryOutputPath).catch(() => undefined);
    const args = ["--yes", "hyperframes@0.8.26", "render", compositionDir, "--output", temporaryOutputPath];
    if (options.quality) args.push("--quality", options.quality);
    args.push("--format", options.format ?? "mp4");
    await run(command, args, projectRoot);
    await replaceOutput(temporaryOutputPath, outputPath);
  } finally {
    await unlink(temporaryOutputPath).catch(() => undefined);
    await rm(compositionDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function createCompositionWorkspace(projectRoot: string, variantId: string): Promise<string> {
  const renderRoot = join(resolve(projectRoot), ".yali-render");
  await mkdir(renderRoot, { recursive: true });
  const safeVariantId = variantId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "variant";
  return mkdtemp(join(renderRoot, `${safeVariantId}-`));
}

async function ensureCompositionAssets(compositionDir: string, assetsRoot: string): Promise<void> {
  const linkPath = join(compositionDir, "assets");
  try {
    const existingTarget = await realpath(linkPath);
    const expectedTarget = await realpath(assetsRoot);
    if (existingTarget !== expectedTarget) {
      throw new RenderError("Composition assets link points outside the project assets directory");
    }
    return;
  } catch (error) {
    if (error instanceof RenderError) throw error;
    if (await exists(linkPath)) {
      throw new RenderError("Composition assets path is not a valid project assets link");
    }
  }
  try {
    await symlink(assetsRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch {
    throw new RenderError("Composition assets link could not be created");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function resolveOutputPath(projectRoot: string, outputPath: string): string {
  const outputsRoot = resolve(projectRoot, "outputs");
  const candidate = resolve(projectRoot, outputPath);
  if (!isInside(candidate, outputsRoot)) {
    throw new RenderError("Render output must stay inside the project outputs directory");
  }
  return candidate;
}

async function assertSourceAssetsExist(manifest: RenderManifest, projectRoot: string): Promise<void> {
  const assetsRoot = resolve(projectRoot, "assets");
  let realProjectRoot: string;
  let realAssetsRoot: string;
  try {
    realProjectRoot = await realpath(projectRoot);
    realAssetsRoot = await realpath(assetsRoot);
  } catch {
    throw new RenderError("Render assets directory is unavailable");
  }
  if (!isInside(realAssetsRoot, realProjectRoot)) {
    throw new RenderError("Render assets directory must stay inside the project directory");
  }
  for (const asset of manifest.assets) {
    const lexicalCandidate = resolve(projectRoot, asset.relative_path);
    if (!isInside(lexicalCandidate, assetsRoot)) {
      throw new RenderError("Render asset must stay inside the project assets directory");
    }
    try {
      const candidate = await realpath(lexicalCandidate);
      if (!isInside(candidate, realAssetsRoot)) {
        throw new Error("asset symlink escapes project assets");
      }
      await access(candidate, constants.R_OK);
      if (!(await stat(candidate)).isFile()) throw new Error("not a file");
    } catch {
      throw new RenderError(`Render asset is unavailable: ${asset.asset_id}`);
    }
  }
}

async function replaceOutput(temporaryOutputPath: string, outputPath: string): Promise<void> {
  try {
    await rename(temporaryOutputPath, outputPath);
  } catch (error) {
    if (process.platform !== "win32" || !isExistingTargetError(error)) throw error;
    await unlink(outputPath).catch(() => undefined);
    await rename(temporaryOutputPath, outputPath);
  }
}

function isExistingTargetError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return (error as { code?: string }).code === "EEXIST" || (error as { code?: string }).code === "EPERM";
}

function isInside(candidate: string, parent: string): boolean {
  const caseFold = process.platform === "win32" ? (value: string) => value.toLowerCase() : (value: string) => value;
  const normalizedCandidate = caseFold(candidate);
  const normalizedParent = caseFold(parent).replace(/[\\/]$/, "");
  const separator = process.platform === "win32" ? "\\" : "/";
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${separator}`);
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const windows = process.platform === "win32";
    const executable = windows ? (process.env.ComSpec || process.env.COMSPEC || "cmd.exe") : command;
    const spawnArgs = windows
      ? ["/d", "/s", "/c", [command, ...args.map(quoteWindowsArgument)].join(" ")]
      : args;
    const child = spawn(executable, spawnArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let stderr = "";
    child.stdout?.on("data", () => undefined);
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-2_000); });
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      callback();
    };
    timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new RenderError("HyperFrames render timed out")));
    }, renderTimeoutMs());
    child.on("error", () => finish(() => reject(new RenderError("HyperFrames render process could not start"))));
    child.on("close", (code) => {
      if (code === 0) return finish(resolvePromise);
      finish(() => reject(new RenderError(`HyperFrames render failed (${code ?? "unknown"})${stderr ? `: ${stderr.trim()}` : ""}`)));
    });
  });
}

export function normalizeRenderTimeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10 * 60 * 1_000;
  return Math.max(1_000, Math.min(30 * 60 * 1_000, Math.round(parsed)));
}

function renderTimeoutMs(): number {
  return normalizeRenderTimeoutMs(process.env.YALI_RENDER_TIMEOUT_MS);
}

function quoteWindowsArgument(value: string): string {
  if (/["\r\n%!^&|<>]/.test(value)) {
    throw new RenderError("Render process arguments contain unsupported shell characters");
  }
  if (!/[ \t]/.test(value)) return value;
  return `"${value}"`;
}

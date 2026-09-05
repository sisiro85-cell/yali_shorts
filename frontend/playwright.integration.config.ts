import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, "..");
const virtualEnvironmentPython = resolve(
  repositoryRoot,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const configuredPython = process.env.YALI_PYTHON;
const python = configuredPython
  ? quoteArgument(configuredPython)
  : existsSync(virtualEnvironmentPython)
    ? quoteArgument(virtualEnvironmentPython)
    : process.platform === "win32"
      ? "py -3"
      : "python3";
const pythonServer = quoteArgument(resolve(configDirectory, "e2e-integration", "integration-server.py"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

function quoteArgument(value: string) {
  return /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

export default defineConfig({
  testDir: "./e2e-integration",
  use: {
    baseURL: "http://127.0.0.1:5173",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      name: "QA API",
      command: `${python} ${pythonServer} --port 18000`,
      cwd: repositoryRoot,
      env: { ...inheritedEnvironment, YALI_LLM_PROVIDER: "fake" },
      port: 18000,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: "QA frontend",
      command: `${npm} run dev -- --host 127.0.0.1 --port 5173`,
      cwd: configDirectory,
      env: { ...inheritedEnvironment, VITE_API_BASE_URL: "http://127.0.0.1:18000/api" },
      port: 5173,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

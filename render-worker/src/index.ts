export { assertRenderManifest, createCompositionHtml } from "./composition.js";
export { RenderError, renderManifest } from "./renderer.js";
export { startServer } from "./server.js";
export type * from "./types.js";

if (process.argv[1]?.endsWith("index.js")) {
  const { startServer } = await import("./server.js");
  startServer();
}

import { useSyncExternalStore } from "react";
import type { WorkflowStage } from "./api";

const NAVIGATION_EVENT = "yali:navigate";

function getPathname() {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => onStoreChange();
  window.addEventListener("popstate", handler);
  window.addEventListener(NAVIGATION_EVENT, handler);

  return () => {
    window.removeEventListener("popstate", handler);
    window.removeEventListener(NAVIGATION_EVENT, handler);
  };
}

export function useCurrentPath() {
  return useSyncExternalStore(subscribe, getPathname, () => "/");
}

export function navigateTo(pathname: string, options?: { replace?: boolean }) {
  if (typeof window === "undefined" || window.location.pathname === pathname) {
    return;
  }

  if (options?.replace) {
    window.history.replaceState({}, "", pathname);
  } else {
    window.history.pushState({}, "", pathname);
  }

  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function projectIdeaPath(projectId: string) {
  return `/projects/${projectId}/idea`;
}

export function projectScriptPath(projectId: string) {
  return `/projects/${projectId}/script`;
}

export function projectVideoSettingsPath(projectId: string) {
  return `/projects/${projectId}/video-settings`;
}

export function projectStagePath(projectId: string, stage: WorkflowStage) {
  if (stage === "idea") return projectIdeaPath(projectId);
  if (stage === "script") return projectScriptPath(projectId);
  if (stage === "cuts" || stage === "design" || stage === "output") return `/projects/${projectId}/${stage}`;
  if (stage === "video_settings") return projectVideoSettingsPath(projectId);
  if (stage === "completed") return `/projects/${projectId}/output`;
  return "/";
}

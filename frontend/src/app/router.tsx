import { useCurrentPath } from "./navigation";
import { HomePage } from "../pages/HomePage";
import { IdeaPage } from "../pages/IdeaPage";
import { ScriptPage, type StagePageStage } from "../pages/ScriptPage";

export function AppRouter() {
  const pathname = useCurrentPath();
  const ideaMatch = pathname.match(/^\/projects\/([^/]+)\/idea$/);

  if (ideaMatch) {
    return <IdeaPage projectId={ideaMatch[1]} />;
  }
  const scriptMatch = pathname.match(/^\/projects\/([^/]+)\/(script|cuts|design|output)$/);

  if (scriptMatch) {
    return <ScriptPage projectId={scriptMatch[1]} stage={scriptMatch[2] as StagePageStage} />;
  }

  return <HomePage />;
}

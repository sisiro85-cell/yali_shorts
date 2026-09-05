"""Read-only-to-production QA observations; all writes use a temporary store.

Run from the repository root with .venv/Scripts/python.exe and no API credentials.
This reports existing behavior, not desired acceptance criteria. No worker or
real AI/render provider is started. Keep this evidence script out of CI gates.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
import runpy
import sys
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from yali.domain.models import MediaAsset  # noqa: E402
from yali.storage.project_store import ProjectStore  # noqa: E402


def main() -> None:
    helpers = runpy.run_path(str(ROOT / "backend/tests/test_api_mvp.py"))
    with TemporaryDirectory(prefix="yali-qa-observation-") as directory:
        data_root = Path(directory)
        client, project = helpers["_client"](data_root)
        with client:
            assert client.app.state.job_runner is None
            created = client.post(
                "/api/projects", json={"title": "QA lifecycle probe", "stage": "completed"}
            )
            observations = {
                "empty_project_created_completed": {
                    "http_status": created.status_code,
                    "stage": created.json().get("stage"),
                    "cut_count": len(created.json().get("scenes", [])),
                }
            }

            helpers["_complete_idea"](client, project)
            base = f"/api/projects/{project.id}"
            assert client.post(f"{base}/script/generate", json={}).status_code == 200
            assert client.post(f"{base}/cuts/generate", json={}).status_code == 200
            store = ProjectStore(data_root)
            before = len(store.get(project.id).output_variants)
            rejected = client.post(f"{base}/output/render", json={"format": "shorts"})
            observations["rejected_render_side_effect"] = {
                "http_status": rejected.status_code,
                "variants_before": before,
                "variants_after": len(store.get(project.id).output_variants),
            }

            # Known 1x1 PNG fixture: deliberately mismatched to shorts' 9:16.
            png = base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1kAAAAASUVORK5CYII="
            )
            current = store.get(project.id)
            asset = MediaAsset(
                filename="qa-square.png", relative_path="assets/qa-square.png",
                media_type="image", width=1, height=1,
            )
            asset_path = store.projects_root / str(project.id) / asset.relative_path
            asset_path.parent.mkdir(parents=True, exist_ok=True)
            asset_path.write_bytes(png)
            current.assets.append(asset)
            for scene in current.scenes:
                for cut in scene.cuts:
                    cut.media_asset_id = asset.id
                    cut.status = "ready"
            store.update(current)
            accepted = client.post(f"{base}/output/render", json={"format": "shorts"})
            observations["square_image_accepted_for_shorts_render"] = {
                "http_status": accepted.status_code,
                "job_status": accepted.json().get("status"),
                "actual_ratio": "1:1", "output_ratio": "9:16",
                "render_executed": False,
            }
            print(json.dumps(observations, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

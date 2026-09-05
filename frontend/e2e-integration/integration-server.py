"""Start a deterministic FastAPI server for the real browser integration suite."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "backend"))

import uvicorn

from yali.ai.gateway import AiGateway
from yali.ai.protocols import Operation
from yali.ai.providers.fake import FakeTextProvider
from yali.api.app import create_app


def build_app(data_root: Path):
    gateway = AiGateway(
        primary=FakeTextProvider(
            responses={
                Operation.GENERATE_IDEA: json.dumps(
                    {
                        "title": "통합 QA 테스트 아이디어",
                        "summary": "실제 API와 영속 저장소를 거치는 테스트입니다.",
                        "key_points": ["실제 FastAPI", "재시작 후 복원"],
                    },
                    ensure_ascii=False,
                )
            }
        )
    )
    return create_app(
        data_root=data_root,
        provider_factory=lambda: gateway,
        enable_worker=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18000)
    arguments = parser.parse_args()
    with TemporaryDirectory(prefix="yali-e2e-") as temporary_root:
        print(f"QA API data root: {temporary_root}", flush=True)
        uvicorn.run(build_app(Path(temporary_root)), host="127.0.0.1", port=arguments.port, log_level="warning")


if __name__ == "__main__":
    main()

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from yali.ai.gateway import AiGateway
from yali.ai.providers.fake import FakeTextProvider
from yali.api.app import create_app


@pytest.fixture
def isolated_data_root(tmp_path: Path) -> Path:
    """Give every integration-style API test a private persistent data root."""
    root = tmp_path / "data-qa"
    root.mkdir()
    return root


@pytest.fixture
def api_client(isolated_data_root: Path) -> Iterator[TestClient]:
    """Create a deterministic API client without starting background workers."""
    gateway = AiGateway(primary=FakeTextProvider())
    app = create_app(
        data_root=isolated_data_root,
        provider_factory=lambda: gateway,
        enable_worker=False,
    )
    with TestClient(app) as client:
        yield client

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from yali.api.dependencies import get_project_store
from yali.domain.models import MediaAsset
from yali.storage.project_store import ProjectStore


router = APIRouter(prefix="/projects/{project_id}/assets", tags=["media"])


class MediaAssetResponse(BaseModel):
    id: UUID
    filename: str
    media_type: Literal["image", "video", "audio", "other"]
    width: int | None
    height: int | None
    media_color_profile: str | None
    created_at: datetime
    preview_url: str | None = None

    @classmethod
    def from_asset(cls, project_id: UUID, asset: MediaAsset) -> "MediaAssetResponse":
        preview_url = (
            f"/api/projects/{project_id}/assets/{asset.id}/preview"
            if asset.media_type in {"image", "video"}
            else None
        )
        return cls(
            id=asset.id,
            filename=asset.filename,
            media_type=asset.media_type,
            width=asset.width,
            height=asset.height,
            media_color_profile=asset.media_color_profile,
            created_at=asset.created_at,
            preview_url=preview_url,
        )


class MediaAssetListResponse(BaseModel):
    assets: list[MediaAssetResponse]


@router.get("", response_model=MediaAssetListResponse)
def list_project_assets(
    project_id: UUID,
    store: ProjectStore = Depends(get_project_store),
) -> MediaAssetListResponse:
    project = store.get(project_id)
    return MediaAssetListResponse(
        assets=[MediaAssetResponse.from_asset(project.id, asset) for asset in project.assets]
    )

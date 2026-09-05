from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends

from yali.api.dependencies import get_project_store
from yali.domain.models import Project
from yali.domain.video_settings import ProjectVideoSettings, VideoSettingsPatch, merge_video_settings
from yali.storage.project_store import ProjectStore


router = APIRouter(prefix="/projects/{project_id}/video-settings", tags=["video-settings"])


@router.get("", response_model=ProjectVideoSettings)
def get_video_settings(
    project_id: UUID,
    store: ProjectStore = Depends(get_project_store),
) -> ProjectVideoSettings:
    return store.get(project_id).video_settings


@router.patch("", response_model=ProjectVideoSettings)
def patch_video_settings(
    project_id: UUID,
    request: VideoSettingsPatch,
    store: ProjectStore = Depends(get_project_store),
) -> ProjectVideoSettings:
    project = store.get(project_id)
    project.video_settings = merge_video_settings(project.video_settings, request)
    store.update(project)
    return project.video_settings

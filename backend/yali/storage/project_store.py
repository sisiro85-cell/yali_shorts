from __future__ import annotations

import json
import os
import shutil
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import UUID, uuid4

from pydantic import ValidationError

from yali.domain.enums import ProjectStage
from yali.domain.models import Cut, Project, ProjectSummary, utc_now
from yali.storage.atomic_json import write_json_atomic
from yali.storage.file_lock import CrossProcessFileLock


class ProjectStoreError(Exception):
    """Base exception for project persistence failures."""


class ProjectNotFoundError(ProjectStoreError):
    pass


class CutNotFoundError(ProjectStoreError):
    pass


class DuplicateProjectError(ProjectStoreError):
    pass


class InvalidCutOrderError(ProjectStoreError):
    pass


class CutLockedError(ProjectStoreError):
    pass


class ProjectDataError(ProjectStoreError):
    pass


class MediaAssetNotFoundError(ProjectStoreError):
    pass


class OutputVariantNotFoundError(ProjectStoreError):
    pass


class ProjectRevisionConflict(ProjectStoreError):
    """Raised when a write is based on an older persisted project snapshot."""


_PROJECT_THREAD_LOCK = RLock()


class ProjectStore:
    def __init__(self, data_root: Path) -> None:
        self.data_root = Path(data_root)
        self.projects_root = self.data_root / "projects"
        self._lock_path = self.projects_root / ".store.lock"

    def save(self, project: Project) -> None:
        with _PROJECT_THREAD_LOCK, CrossProcessFileLock(self._lock_path):
            path = self._project_path(project.id)
            if path.exists():
                raise DuplicateProjectError(f"Project already exists: {project.id}")
            self._write(project)

    def delete(self, project_id: UUID) -> None:
        with _PROJECT_THREAD_LOCK, CrossProcessFileLock(self._lock_path):
            project_path = self._project_path(project_id)
            if not project_path.exists():
                raise ProjectNotFoundError(f"Project not found: {project_id}")

            project_dir = project_path.parent.resolve()
            projects_root = self.projects_root.resolve()
            try:
                project_dir.relative_to(projects_root)
            except ValueError as error:
                raise ProjectDataError(f"Project path escapes storage root: {project_id}") from error
            if project_dir == projects_root or project_dir.name != str(project_id) or not project_dir.is_dir():
                raise ProjectDataError(f"Invalid project storage path: {project_id}")

            summaries = self._read_index()
            index_path = self._index_path()
            tombstone = self.projects_root / f".deleting-{project_id}-{uuid4().hex}"
            index_updated = False
            try:
                os.replace(project_dir, tombstone)
                write_json_atomic(
                    index_path,
                    {"projects": [item.model_dump(mode="json") for item in summaries if item.id != project_id]},
                )
                index_updated = True
                shutil.rmtree(tombstone)
            except OSError as error:
                if index_updated:
                    try:
                        write_json_atomic(
                            index_path,
                            {"projects": [item.model_dump(mode="json") for item in summaries]},
                        )
                    except OSError:
                        pass
                if tombstone.exists() and not project_dir.exists():
                    try:
                        os.replace(tombstone, project_dir)
                    except OSError:
                        pass
                raise ProjectDataError(f"Unable to delete project: {project_id}") from error

    def update(self, project: Project) -> None:
        self._update(project)

    def restore(self, project: Project) -> None:
        """Restore a previously persisted snapshot during a failed transaction.

        This is intentionally separate from ``update``: compensating writes are
        allowed to use the snapshot's older revision after a later step failed.
        Callers should only pass a snapshot captured immediately before that
        transaction.
        """
        with _PROJECT_THREAD_LOCK, CrossProcessFileLock(self._lock_path):
            if not self._project_path(project.id).exists():
                raise ProjectNotFoundError(f"Project not found: {project.id}")
            self._write(project)

    def update_if_unchanged(
        self,
        project: Project,
        *,
        expected_updated_at: datetime,
        guard: Callable[[], bool] | None = None,
    ) -> None:
        """Persist only when the on-disk project has the expected revision."""
        with _PROJECT_THREAD_LOCK, CrossProcessFileLock(self._lock_path):
            stored = self._get_unlocked(project.id)
            if stored.updated_at != expected_updated_at:
                raise ProjectRevisionConflict(f"Project changed while generating: {project.id}")
            if guard is not None and not guard():
                raise ProjectRevisionConflict(f"Project write guard rejected the update: {project.id}")
            self._protect_locked_cuts(project, stored, set())
            project.updated_at = utc_now()
            self._write(project)

    def update_cut_if_current(
        self,
        project_id: UUID,
        cut_id: UUID,
        *,
        expected_active_version_id: UUID | None,
        update: Callable[[Project, Cut], None],
        guard: Callable[[], bool] | None = None,
    ) -> Project:
        """Merge one current cut after work outside the store lock finishes."""
        with _PROJECT_THREAD_LOCK, CrossProcessFileLock(self._lock_path):
            stored = self._get_unlocked(project_id)
            cut = self._find_cut(stored, cut_id)
            if cut.active_version_id != expected_active_version_id:
                raise ProjectRevisionConflict(f"Cut changed before update: {cut_id}")
            if cut.locked:
                raise CutLockedError(f"Cut is locked: {cut_id}")
            if guard is not None and not guard():
                raise ProjectRevisionConflict(f"Cut write guard rejected the update: {cut_id}")
            update(stored, cut)
            stored.updated_at = utc_now()
            self._write(stored)
            return stored

    def get_cut(self, project_id: UUID, cut_id: UUID) -> Cut:
        return self._find_cut(self.get(project_id), cut_id)

    def get_preview_asset_path(self, project_id: UUID, asset_id: UUID) -> Path:
        project = self.get(project_id)
        asset = next((item for item in project.assets if item.id == asset_id), None)
        if asset is None or asset.media_type not in {"image", "video"}:
            raise MediaAssetNotFoundError(f"Media asset not found: {asset_id}")
        return self._resolve_asset_path(project_id, asset)

    def get_asset_path(self, project_id: UUID, asset_id: UUID) -> Path:
        project = self.get(project_id)
        asset = next((item for item in project.assets if item.id == asset_id), None)
        if asset is None:
            raise MediaAssetNotFoundError(f"Media asset not found: {asset_id}")
        return self._resolve_asset_path(project_id, asset)

    def get_output_path(self, project_id: UUID, variant_id: UUID) -> Path:
        project = self.get(project_id)
        variant = next((item for item in project.output_variants if item.id == variant_id), None)
        if variant is None or not variant.relative_path:
            raise OutputVariantNotFoundError(f"Output variant is not ready: {variant_id}")
        project_dir = self._project_path(project_id).parent.resolve()
        outputs_dir = (project_dir / "outputs").resolve()
        candidate = (project_dir / variant.relative_path).resolve()
        try:
            outputs_dir.relative_to(project_dir)
            candidate.relative_to(outputs_dir)
        except ValueError as error:
            raise ProjectDataError(f"Output path escapes project outputs: {variant_id}") from error
        if not candidate.is_file():
            raise OutputVariantNotFoundError(f"Output file not found: {variant_id}")
        return candidate

    def promote_output_file(
        self,
        project_id: UUID,
        variant_id: UUID,
        staged_relative_path: str,
        final_relative_path: str,
    ) -> None:
        project = self.get(project_id)
        if not any(item.id == variant_id for item in project.output_variants):
            raise OutputVariantNotFoundError(f"Output variant is not stored: {variant_id}")
        project_dir = self._project_path(project_id).parent.resolve()
        staged = self._resolve_output_relative_path(project_dir, staged_relative_path)
        final = self._resolve_output_relative_path(project_dir, final_relative_path)
        if not staged.is_file():
            raise OutputVariantNotFoundError(f"Staged output file not found: {variant_id}")
        os.replace(staged, final)

    def finalize_output_file(
        self,
        project_id: UUID,
        variant_id: UUID,
        staged_relative_path: str,
        final_relative_path: str,
        *,
        expected_updated_at: datetime | None = None,
        guard: Callable[[], bool] | None = None,
    ) -> Project:
        """Promote a rendered file and its project metadata as one local transaction.

        The revision check happens before the file move. If the metadata write
        fails after the move, both the old project snapshot and any previous
        output file are restored, so a stale render cannot leave an orphaned or
        falsely published output behind.
        """
        with _PROJECT_THREAD_LOCK, CrossProcessFileLock(self._lock_path):
            stored = self._get_unlocked(project_id)
            previous = stored.model_copy(deep=True)
            if expected_updated_at is not None and stored.updated_at != expected_updated_at:
                raise ProjectRevisionConflict(f"Project changed before output finalization: {project_id}")
            if guard is not None and not guard():
                raise ProjectRevisionConflict(f"Output finalization guard rejected the update: {project_id}")
            variant = next((item for item in stored.output_variants if item.id == variant_id), None)
            if variant is None:
                raise OutputVariantNotFoundError(f"Output variant is not stored: {variant_id}")

            project_dir = self._project_path(project_id).parent.resolve()
            staged = self._resolve_output_relative_path(project_dir, staged_relative_path)
            final = self._resolve_output_relative_path(project_dir, final_relative_path)
            if not staged.is_file():
                raise OutputVariantNotFoundError(f"Staged output file not found: {variant_id}")
            final.parent.mkdir(parents=True, exist_ok=True)

            backup: Path | None = None
            staged_moved = False
            metadata_write_started = False
            try:
                if final.exists():
                    backup = final.with_name(f".{final.name}.{uuid4().hex}.previous")
                    os.replace(final, backup)
                os.replace(staged, final)
                staged_moved = True

                variant.relative_path = final_relative_path
                payload = stored.model_dump()
                payload["status"] = ProjectStage.OUTPUT
                payload["stage"] = ProjectStage.OUTPUT
                finalized = Project.model_validate(payload)
                finalized.updated_at = utc_now()
                metadata_write_started = True
                self._write(finalized)
            except Exception:
                if metadata_write_started:
                    try:
                        self._write(previous)
                    except Exception:
                        pass
                if staged_moved and final.exists():
                    if backup is None:
                        os.replace(final, staged)
                    else:
                        final.unlink(missing_ok=True)
                if backup is not None and backup.exists():
                    os.replace(backup, final)
                raise
            finally:
                if backup is not None:
                    backup.unlink(missing_ok=True)
            return finalized

    def unlock_cut(self, project_id: UUID, cut_id: UUID) -> Project:
        project = self.get(project_id)
        cut = self._find_cut(project, cut_id)
        cut.locked = False
        self._update(project, unlocked_cut_ids={cut_id})
        return project

    def _update(self, project: Project, *, unlocked_cut_ids: set[UUID] | None = None) -> None:
        with _PROJECT_THREAD_LOCK, CrossProcessFileLock(self._lock_path):
            path = self._project_path(project.id)
            if not path.exists():
                raise ProjectNotFoundError(f"Project not found: {project.id}")
            stored = self._get_unlocked(project.id)
            if stored.updated_at != project.updated_at:
                raise ProjectRevisionConflict(f"Project changed before update: {project.id}")
            self._protect_locked_cuts(project, stored, unlocked_cut_ids or set())
            project.updated_at = utc_now()
            self._write(project)

    def get(self, project_id: UUID) -> Project:
        return self._get_unlocked(project_id)

    def _get_unlocked(self, project_id: UUID) -> Project:
        payload = self._read_payload(project_id)
        try:
            return Project.model_validate(payload)
        except ValidationError as error:
            raise ProjectDataError(f"Invalid project JSON for {project_id}: {error}") from error

    def list_summaries(self) -> list[ProjectSummary]:
        return self._read_index()

    def update_cut(self, project_id: UUID, cut_id: UUID, **changes: Any) -> Project:
        project = self.get(project_id)
        cut = self._find_cut(project, cut_id)
        if cut.locked:
            raise CutLockedError(f"Cut is locked: {cut_id}")
        for field, value in changes.items():
            if field not in Cut.model_fields:
                raise ValueError(f"Unknown cut field: {field}")
            setattr(cut, field, value)
        self.update(project)
        return project

    def _write(self, project: Project) -> None:
        self._validate_cut_order(project)
        project_dir = self._project_path(project.id).parent
        (project_dir / "assets").mkdir(parents=True, exist_ok=True)
        (project_dir / "outputs").mkdir(parents=True, exist_ok=True)
        write_json_atomic(self._project_path(project.id), project.model_dump(mode="json"))
        self._upsert_summary(ProjectSummary.from_project(project))

    def _upsert_summary(self, summary: ProjectSummary) -> None:
        summaries = [item for item in self._read_index() if item.id != summary.id]
        summaries.append(summary)
        write_json_atomic(
            self._index_path(),
            {"projects": [item.model_dump(mode="json") for item in summaries]},
        )

    def _read_index(self) -> list[ProjectSummary]:
        path = self._index_path()
        if not path.exists():
            return self._recover_missing_index()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            entries = payload["projects"]
            summaries = [ProjectSummary.model_validate(entry) for entry in entries]
        except (OSError, KeyError, TypeError, json.JSONDecodeError, ValidationError) as error:
            raise ProjectDataError(f"Invalid project summary index: {error}") from error
        backfilled = False
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict) or "preview_media" in entry:
                continue
            try:
                summaries[index] = ProjectSummary.from_project(self.get(summaries[index].id))
                backfilled = True
            except ProjectNotFoundError:
                # A stale legacy entry remains listable even when its project file was removed.
                continue
        if backfilled:
            write_json_atomic(
                self._index_path(),
                {"projects": [item.model_dump(mode="json") for item in summaries]},
            )
        return summaries

    def _recover_missing_index(self) -> list[ProjectSummary]:
        if not self.projects_root.exists():
            return []
        summaries: list[ProjectSummary] = []
        for path in sorted(self.projects_root.glob("*/project.json")):
            project_id = self._project_id_from_path(path)
            summaries.append(ProjectSummary.from_project(self.get(project_id)))
        write_json_atomic(
            self._index_path(),
            {"projects": [summary.model_dump(mode="json") for summary in summaries]},
        )
        return summaries

    def _read_payload(self, project_id: UUID) -> dict[str, Any]:
        path = self._project_path(project_id)
        if not path.exists():
            raise ProjectNotFoundError(f"Project not found: {project_id}")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ProjectDataError(f"Invalid project JSON for {project_id}: {error}") from error
        if not isinstance(payload, dict):
            raise ProjectDataError(f"Invalid project JSON for {project_id}: root must be an object")
        return payload

    def _project_path(self, project_id: UUID) -> Path:
        return self.projects_root / str(project_id) / "project.json"

    def _index_path(self) -> Path:
        return self.projects_root / "index.json"

    @staticmethod
    def _project_id_from_path(path: Path) -> UUID:
        try:
            return UUID(path.parent.name)
        except ValueError as error:
            raise ProjectDataError(f"Invalid project directory name: {path.parent.name}") from error

    @staticmethod
    def _find_cut(project: Project, cut_id: UUID) -> Cut:
        for scene in project.scenes:
            for cut in scene.cuts:
                if cut.id == cut_id:
                    return cut
        raise CutNotFoundError(f"Cut not found in project {project.id}: {cut_id}")

    @staticmethod
    def _validate_cut_order(project: Project) -> None:
        for scene in project.scenes:
            expected = list(range(1, len(scene.cuts) + 1))
            actual = [cut.order for cut in scene.cuts]
            if actual != expected:
                raise InvalidCutOrderError(
                    f"Cut order in scene {scene.id} must be contiguous starting at 1; got {actual}"
                )

    @staticmethod
    def _protect_locked_cuts(project: Project, stored: Project, unlocked_cut_ids: set[UUID]) -> None:
        candidate_scenes = {scene.id: scene for scene in project.scenes}
        for stored_scene in stored.scenes:
            candidate_scene = candidate_scenes.get(stored_scene.id)
            for stored_cut in stored_scene.cuts:
                if not stored_cut.locked or stored_cut.id in unlocked_cut_ids:
                    continue
                candidate_cut = (
                    next((cut for cut in candidate_scene.cuts if cut.id == stored_cut.id), None)
                    if candidate_scene is not None
                    else None
                )
                if candidate_cut != stored_cut:
                    raise CutLockedError(f"Cut is locked: {stored_cut.id}")
                candidate_index = candidate_scene.cuts.index(candidate_cut)
                candidate_scene.cuts[candidate_index] = stored_cut.model_copy(deep=True)

    def _resolve_asset_path(self, project_id: UUID, asset) -> Path:
        project_dir = self._project_path(project_id).parent.resolve()
        assets_dir = (project_dir / "assets").resolve()
        candidate = (project_dir / asset.relative_path).resolve()
        try:
            assets_dir.relative_to(project_dir)
            candidate.relative_to(assets_dir)
        except ValueError as error:
            raise ProjectDataError(f"Media asset path escapes project assets: {asset.id}") from error
        if not candidate.is_file():
            raise MediaAssetNotFoundError(f"Media asset file not found: {asset.id}")
        return candidate

    @staticmethod
    def _resolve_output_relative_path(project_dir: Path, relative_path: str) -> Path:
        outputs_dir = (project_dir / "outputs").resolve()
        candidate = (project_dir / relative_path).resolve()
        try:
            outputs_dir.relative_to(project_dir)
            candidate.relative_to(outputs_dir)
        except ValueError as error:
            raise ProjectDataError("Output path escapes project outputs") from error
        return candidate

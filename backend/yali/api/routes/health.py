from fastapi import APIRouter, Request

from yali.storage.atomic_json import StorageUnavailableError

router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request) -> dict[str, object]:
    try:
        request.app.state.data_root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise StorageUnavailableError(f"Unable to access storage: {error}") from error
    return {"version": "0.1.0", "storage": {"status": "ready"}}

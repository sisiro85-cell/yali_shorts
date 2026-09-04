from __future__ import annotations


class ApiValidationError(Exception):
    def __init__(self, errors: list[dict[str, object]]) -> None:
        super().__init__("validation failed")
        self.errors = errors


class IdeaJobStateError(Exception):
    """Raised when a completed idea cannot be attached to its current job state."""

    def __init__(self, job_id: object, state: str) -> None:
        super().__init__(f"Idea job {job_id} cannot be completed from state {state}")
        self.job_id = job_id
        self.state = state

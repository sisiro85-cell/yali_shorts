from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any


DEFAULT_TIMEOUT_SECONDS = 300.0
_END = object()


class CodexAppServerError(RuntimeError):
    pass


def process_creation_kwargs(platform_name: str | None = None) -> dict[str, int]:
    if (platform_name or os.name) != "nt":
        return {}
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)}


def _standard_codex_command() -> str | None:
    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if not local_app_data:
        profile = os.environ.get("USERPROFILE", "").strip()
        if profile:
            local_app_data = str(Path(profile) / "AppData" / "Local")
    if not local_app_data:
        return None
    bin_dir = Path(local_app_data) / "OpenAI" / "Codex" / "bin"
    candidates = [bin_dir / "codex.exe", *bin_dir.glob("*/codex.exe")]
    existing = [candidate for candidate in candidates if candidate.is_file()]
    existing.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    return str(existing[0]) if existing else None


def resolve_codex_command() -> str:
    configured = os.environ.get("CODEX_CLI_PATH", "").strip()
    if configured:
        if Path(configured).is_file():
            return configured
        raise CodexAppServerError("Configured Codex CLI was not found")
    command = shutil.which("codex") or shutil.which("codex.exe") or _standard_codex_command()
    if command:
        return command
    raise CodexAppServerError("Codex CLI was not found")


def _process_environment() -> dict[str, str]:
    environment = os.environ.copy()
    profile = environment.get("USERPROFILE", "").strip()
    if profile:
        environment.setdefault("CODEX_HOME", str(Path(profile) / ".codex"))
        if os.name == "nt":
            environment.setdefault("HOME", profile)
    return environment


def _start_process(cwd: Path) -> subprocess.Popen[str]:
    kwargs: dict[str, Any] = {
        "cwd": str(cwd),
        "env": _process_environment(),
        "stdin": subprocess.PIPE,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "bufsize": 1,
        **process_creation_kwargs(),
    }
    try:
        return subprocess.Popen(
            [resolve_codex_command(), "app-server", "--listen", "stdio://"],
            **kwargs,
        )
    except OSError as exc:
        raise CodexAppServerError("Could not start Codex app-server") from exc


def _read_stream(stream: Any, name: str, events: queue.Queue[tuple[str, object]]) -> None:
    try:
        for line in iter(stream.readline, ""):
            events.put((name, line))
    finally:
        events.put((name, _END))


def _parse_message(line: str) -> dict[str, Any]:
    try:
        message = json.loads(line)
    except (TypeError, json.JSONDecodeError) as exc:
        raise CodexAppServerError("Codex app-server returned invalid JSON") from exc
    if not isinstance(message, dict):
        raise CodexAppServerError("Codex app-server returned invalid data")
    return message


class _Session:
    def __init__(self, process: subprocess.Popen[str], timeout_seconds: float) -> None:
        self.process = process
        self.timeout_seconds = timeout_seconds
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.messages: list[dict[str, Any]] = []
        self.next_id = 1
        for name, stream in (("stdout", process.stdout), ("stderr", process.stderr)):
            threading.Thread(
                target=_read_stream, args=(stream, name, self.events), daemon=True
            ).start()

    def send(self, message: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise CodexAppServerError("Codex app-server input is unavailable")
        try:
            self.process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
        except (OSError, ValueError) as exc:
            raise CodexAppServerError("Could not communicate with Codex app-server") from exc

    def _next(self, deadline: float) -> dict[str, Any]:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CodexAppServerError("Codex app-server request timed out")
            try:
                stream, value = self.events.get(timeout=remaining)
            except queue.Empty as exc:
                raise CodexAppServerError("Codex app-server request timed out") from exc
            if stream == "stderr":
                continue
            if value is _END:
                raise CodexAppServerError("Codex app-server exited before responding")
            if str(value).strip():
                return _parse_message(str(value))

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        request_id = self.next_id
        self.next_id += 1
        self.send({"method": method, "id": request_id, "params": params})
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            message = self._next(deadline)
            if message.get("id") != request_id:
                if isinstance(message.get("method"), str):
                    self.messages.append(message)
                continue
            if message.get("error") is not None:
                raise CodexAppServerError("Codex app-server request failed")
            result = message.get("result")
            if not isinstance(result, dict):
                raise CodexAppServerError("Codex app-server returned an invalid response")
            return result

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.send({"method": method, "params": params})

    def wait_for_completion(self) -> None:
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            message = self._next(deadline)
            if isinstance(message.get("method"), str):
                self.messages.append(message)
            if message.get("method") != "turn/completed":
                continue
            turn = (message.get("params") or {}).get("turn") or {}
            if turn.get("status") != "completed":
                raise CodexAppServerError("Codex generation failed")
            return


def _final_agent_text(messages: list[dict[str, Any]]) -> str:
    completed: list[str] = []
    streamed: list[str] = []
    for message in messages:
        params = message.get("params") or {}
        if message.get("method") == "item/agentMessage/delta":
            if isinstance(params.get("delta"), str):
                streamed.append(params["delta"])
        elif message.get("method") == "item/completed":
            item = params.get("item") or {}
            text = item.get("text")
            if item.get("type") == "agentMessage" and isinstance(text, str) and text.strip():
                if item.get("phase") == "final_answer":
                    return text.strip()
                completed.append(text)
    return (completed[-1] if completed else "".join(streamed)).strip()


def _close_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        try:
            process.kill()
            process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            pass


def _initialize_session(session: _Session) -> None:
    session.request(
        "initialize",
        {
            "clientInfo": {
                "name": "yali-short-form-studio",
                "title": "Yali Short-form Studio",
                "version": "1.0.0",
            }
        },
    )
    session.notify("initialized", {})


def check_connection(
    cwd: str | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    """Perform only the app-server handshake; never start a generation turn."""
    working_directory = Path(cwd or Path.cwd()).resolve()
    process = _start_process(working_directory)
    session = _Session(process, timeout_seconds)
    try:
        _initialize_session(session)
    finally:
        _close_process(process)


def generate_text(
    prompt: str,
    model_name: str = "",
    cwd: str | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> str:
    working_directory = Path(cwd or Path.cwd()).resolve()
    process = _start_process(working_directory)
    session = _Session(process, timeout_seconds)
    try:
        _initialize_session(session)
        thread_params: dict[str, Any] = {
            "cwd": str(working_directory),
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "ephemeral": True,
            "serviceName": "yali-short-form-studio",
        }
        normalized_model = model_name.strip()
        if normalized_model:
            thread_params["model"] = normalized_model
        thread_result = session.request("thread/start", thread_params)
        thread_id = (thread_result.get("thread") or {}).get("id")
        if not isinstance(thread_id, str) or not thread_id:
            raise CodexAppServerError("Codex app-server did not start a thread")
        turn_params: dict[str, Any] = {
            "threadId": thread_id,
            "input": [{"type": "text", "text": prompt}],
        }
        if normalized_model:
            turn_params["model"] = normalized_model
        session.request("turn/start", turn_params)
        session.wait_for_completion()
        text = _final_agent_text(session.messages)
        if not text:
            raise CodexAppServerError("Codex returned empty text content")
        return text
    finally:
        _close_process(process)

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from yali.ai.protocols import ProviderHealth, TextGenerationRequest, TextGenerationResponse


DEFAULT_TIMEOUT_SECONDS = 300.0
MCP_PROTOCOL_VERSION = "2025-11-25"
MCP_TOOL_NAME = "generate_text"
_END = object()


class CodexMcpError(RuntimeError):
    pass


def process_creation_kwargs(platform_name: str | None = None) -> dict[str, int]:
    if (platform_name or os.name) != "nt":
        return {}
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)}


def _process_environment(cwd: Path) -> dict[str, str]:
    environment = os.environ.copy()
    roots = [str(cwd)]
    existing = environment.get("PYTHONPATH", "").strip()
    if existing:
        roots.append(existing)
    environment["PYTHONPATH"] = os.pathsep.join(roots)
    return environment


def _start_process(cwd: Path) -> subprocess.Popen[str]:
    kwargs: dict[str, Any] = {
        "cwd": str(cwd),
        "env": _process_environment(cwd),
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
            [sys.executable, "-m", "yali.ai.codex_mcp_bridge"], **kwargs
        )
    except OSError as exc:
        raise CodexMcpError("Could not start the local Codex MCP bridge") from exc


def _read_stream(stream: Any, name: str, events: queue.Queue[tuple[str, object]]) -> None:
    try:
        for line in iter(stream.readline, ""):
            events.put((name, line))
    finally:
        events.put((name, _END))


class _Session:
    def __init__(self, process: subprocess.Popen[str], timeout_seconds: float) -> None:
        self.process = process
        self.timeout_seconds = timeout_seconds
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.next_id = 1
        for name, stream in (("stdout", process.stdout), ("stderr", process.stderr)):
            threading.Thread(
                target=_read_stream, args=(stream, name, self.events), daemon=True
            ).start()

    def send(self, message: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise CodexMcpError("Codex MCP bridge input is unavailable")
        try:
            self.process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
        except (OSError, ValueError) as exc:
            raise CodexMcpError("Could not communicate with Codex MCP bridge") from exc

    def _next(self, deadline: float) -> dict[str, Any]:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CodexMcpError("Codex MCP bridge request timed out")
            try:
                stream, value = self.events.get(timeout=remaining)
            except queue.Empty as exc:
                raise CodexMcpError("Codex MCP bridge request timed out") from exc
            if stream == "stderr":
                continue
            if value is _END:
                raise CodexMcpError("Codex MCP bridge exited before responding")
            try:
                message = json.loads(str(value))
            except json.JSONDecodeError as exc:
                raise CodexMcpError("Codex MCP bridge returned invalid JSON") from exc
            if not isinstance(message, dict):
                raise CodexMcpError("Codex MCP bridge returned invalid data")
            return message

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        request_id = self.next_id
        self.next_id += 1
        self.send(
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        )
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            message = self._next(deadline)
            if message.get("id") != request_id:
                continue
            if message.get("error") is not None:
                raise CodexMcpError("Codex MCP bridge request failed")
            result = message.get("result")
            if not isinstance(result, dict):
                raise CodexMcpError("Codex MCP bridge returned an invalid response")
            return result

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.send({"jsonrpc": "2.0", "method": method, "params": params})


def _close_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    stdin = getattr(process, "stdin", None)
    try:
        if stdin is not None:
            stdin.close()
    except (OSError, ValueError):
        pass
    try:
        process.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        try:
            process.terminate()
            process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            try:
                process.kill()
                process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                pass


def _initialize_and_discover(session: _Session) -> None:
    initialized = session.request(
        "initialize",
        {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "yali-short-form-studio",
                "title": "Yali Short-form Studio",
                "version": "1.0.0",
            },
        },
    )
    if initialized.get("protocolVersion") != MCP_PROTOCOL_VERSION:
        raise CodexMcpError("Codex MCP protocol version is unsupported")
    if not isinstance(initialized.get("capabilities"), dict):
        raise CodexMcpError("Codex MCP returned invalid capabilities")
    session.notify("notifications/initialized", {})
    tools = session.request("tools/list", {}).get("tools")
    if not isinstance(tools, list) or not any(
        isinstance(tool, dict) and tool.get("name") == MCP_TOOL_NAME for tool in tools
    ):
        raise CodexMcpError("Codex MCP generate_text tool is unavailable")


def check_connection(
    cwd: str | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    """Perform MCP initialize/tool discovery without calling generate_text."""
    working_directory = Path(cwd or Path.cwd()).resolve()
    process = _start_process(working_directory)
    session = _Session(process, timeout_seconds)
    try:
        _initialize_and_discover(session)
    finally:
        _close_process(process)


def _tool_text(result: dict[str, Any]) -> str:
    content = result.get("content")
    if not isinstance(content, list):
        raise CodexMcpError("Codex MCP returned invalid tool content")
    parts = [
        item["text"]
        for item in content
        if isinstance(item, dict)
        and item.get("type") == "text"
        and isinstance(item.get("text"), str)
    ]
    text = "\n".join(parts).strip()
    if result.get("isError"):
        raise CodexMcpError("Codex MCP generation failed")
    if not text:
        raise CodexMcpError("Codex MCP returned empty text content")
    return text


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
        _initialize_and_discover(session)
        arguments = {"prompt": prompt}
        if model_name.strip():
            arguments["model_name"] = model_name.strip()
        if cwd is not None:
            arguments["cwd"] = cwd
        result = session.request(
            "tools/call", {"name": MCP_TOOL_NAME, "arguments": arguments}
        )
        return _tool_text(result)
    finally:
        _close_process(process)


class CodexMcpProvider:
    name = "codex_mcp"

    def __init__(
        self,
        *,
        model: str = "",
        cwd: str | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.model = model
        self.cwd = cwd
        self.timeout_seconds = timeout_seconds

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse:
        model = (request.model_name or self.model).strip()
        text = generate_text(
            request.prompt,
            model_name=model,
            cwd=self.cwd,
            timeout_seconds=self.timeout_seconds,
        )
        return TextGenerationResponse(text=text, provider=self.name, model=model or None)

    def health(self) -> ProviderHealth:
        from yali.ai.providers.codex_app_server import CodexAppServerError, resolve_codex_command

        try:
            resolve_codex_command()
        except CodexAppServerError:
            return ProviderHealth(
                provider=self.name,
                available=False,
                message="Codex CLI is not available",
                requires_api_key=False,
            )
        return ProviderHealth(
            provider=self.name,
            available=True,
            message="Codex CLI is available",
            requires_api_key=False,
        )

    def test_connection(self) -> ProviderHealth:
        from yali.ai.providers.codex_app_server import check_connection as check_app_server_connection

        try:
            check_connection(cwd=self.cwd, timeout_seconds=self.timeout_seconds)
            check_app_server_connection(cwd=self.cwd, timeout_seconds=self.timeout_seconds)
        except Exception:
            return ProviderHealth(
                provider=self.name,
                available=False,
                message="Codex MCP 연결을 확인할 수 없습니다.",
                requires_api_key=False,
            )
        return ProviderHealth(
            provider=self.name,
            available=True,
            message="Codex MCP와 app-server 연결이 확인되었습니다.",
            requires_api_key=False,
        )

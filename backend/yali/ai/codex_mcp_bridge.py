from __future__ import annotations

import base64
import json
import sys
from typing import Any, Callable

from yali.ai.providers.codex_app_server import generate_text as generate_codex_text
from yali.ai.providers.codex_image import generate_image as generate_codex_image


MCP_PROTOCOL_VERSION = "2025-11-25"
MCP_TOOL_NAME = "generate_text"
MCP_IMAGE_TOOL_NAME = "generate_image"


def _result(request_id: Any, value: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": value}


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _tool() -> dict[str, Any]:
    return {
        "name": MCP_TOOL_NAME,
        "description": "Generate text with the locally signed-in Codex subscription.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string"},
                "model_name": {"type": "string"},
                "cwd": {"type": "string"},
            },
            "required": ["prompt"],
            "additionalProperties": False,
        },
    }


def _image_tool() -> dict[str, Any]:
    return {
        "name": MCP_IMAGE_TOOL_NAME,
        "description": "Generate one PNG image with the locally signed-in Codex ImageGen capability.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string"},
                "model_name": {"type": "string"},
                "cwd": {"type": "string"},
            },
            "required": ["prompt"],
            "additionalProperties": False,
        },
    }


def _arguments(value: Any) -> tuple[str, str, str | None]:
    if not isinstance(value, dict):
        raise ValueError("generate_text arguments must be an object")
    unknown = set(value) - {"prompt", "model_name", "cwd"}
    if unknown:
        raise ValueError("generate_text received unsupported arguments")
    prompt = value.get("prompt")
    model = value.get("model_name", "")
    cwd = value.get("cwd")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("generate_text requires a non-empty prompt")
    if not isinstance(model, str):
        raise ValueError("model_name must be a string")
    if cwd is not None and not isinstance(cwd, str):
        raise ValueError("cwd must be a string")
    return prompt, model, cwd


def _image_arguments(value: Any) -> tuple[str, str, str | None]:
    if not isinstance(value, dict):
        raise ValueError("generate_image arguments must be an object")
    unknown = set(value) - {"prompt", "model_name", "cwd"}
    if unknown:
        raise ValueError("generate_image received unsupported arguments")
    prompt = value.get("prompt")
    model = value.get("model_name", "")
    cwd = value.get("cwd")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("generate_image requires a non-empty prompt")
    if not isinstance(model, str):
        raise ValueError("model_name must be a string")
    if cwd is not None and not isinstance(cwd, str):
        raise ValueError("cwd must be a string")
    return prompt, model, cwd


def handle_request(
    message: dict[str, Any],
    *,
    generate_text: Callable[..., str] = generate_codex_text,
    generate_image: Callable[..., bytes] = generate_codex_image,
) -> dict[str, Any] | None:
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        request_id = message.get("id") if isinstance(message, dict) else None
        return _error(request_id, -32600, "Invalid JSON-RPC request")
    request_id = message.get("id")
    method = message.get("method")
    if not isinstance(method, str):
        return _error(request_id, -32600, "JSON-RPC method is required")
    if method.startswith("notifications/"):
        return None
    if method == "initialize":
        params = message.get("params") or {}
        if not isinstance(params, dict):
            return _error(request_id, -32602, "initialize params must be an object")
        version = params.get("protocolVersion")
        if version not in (None, MCP_PROTOCOL_VERSION):
            return _error(request_id, -32602, "Unsupported MCP protocol version")
        return _result(
            request_id,
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "yali-codex-bridge", "version": "1.0.0"},
            },
        )
    if method == "tools/list":
        return _result(request_id, {"tools": [_tool(), _image_tool()]})
    if method == "tools/call":
        params = message.get("params")
        if not isinstance(params, dict):
            return _error(request_id, -32602, "tools/call params must be an object")
        tool_name = params.get("name")
        if tool_name not in {MCP_TOOL_NAME, MCP_IMAGE_TOOL_NAME}:
            return _error(request_id, -32602, "Unknown tool")
        if tool_name == MCP_IMAGE_TOOL_NAME:
            try:
                prompt, model, cwd = _image_arguments(params.get("arguments"))
                image = generate_image(prompt=prompt, model_name=model, cwd=cwd)
            except ValueError as exc:
                return _error(request_id, -32602, str(exc))
            except Exception:
                return _result(
                    request_id,
                    {
                        "content": [{"type": "text", "text": "Codex ImageGen failed."}],
                        "isError": True,
                    },
                )
            if not isinstance(image, bytes) or not image:
                return _result(
                    request_id,
                    {
                        "content": [{"type": "text", "text": "Codex ImageGen returned empty image data."}],
                        "isError": True,
                    },
                )
            return _result(
                request_id,
                {
                    "content": [
                        {
                            "type": "image",
                            "data": base64.b64encode(image).decode("ascii"),
                            "mimeType": "image/png",
                        }
                    ],
                    "isError": False,
                },
            )

        try:
            prompt, model, cwd = _arguments(params.get("arguments"))
        except ValueError as exc:
            return _error(request_id, -32602, str(exc))
        try:
            text = generate_text(prompt=prompt, model_name=model, cwd=cwd)
        except Exception:
            return _result(
                request_id,
                {
                    "content": [{"type": "text", "text": "Codex generation failed."}],
                    "isError": True,
                },
            )
        if not isinstance(text, str) or not text.strip():
            return _result(
                request_id,
                {
                    "content": [{"type": "text", "text": "Codex returned empty text."}],
                    "isError": True,
                },
            )
        return _result(
            request_id,
            {"content": [{"type": "text", "text": text.strip()}], "isError": False},
        )
    return _error(request_id, -32601, "Method not found")


def _write(response: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="strict")
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            value = json.loads(line)
            response = handle_request(value)
        except json.JSONDecodeError:
            response = _error(None, -32700, "Parse error")
        except Exception:
            response = _error(None, -32603, "Internal MCP server error")
        if response is not None:
            _write(response)


if __name__ == "__main__":
    main()

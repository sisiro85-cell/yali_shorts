from __future__ import annotations

import base64

from yali.ai.codex_mcp_bridge import handle_request


def test_bridge_lists_text_and_image_generation_tools() -> None:
    response = handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})

    assert response is not None
    tools = response["result"]["tools"]
    assert {tool["name"] for tool in tools} == {"generate_text", "generate_image"}


def test_bridge_returns_generated_png_as_image_content() -> None:
    png = b"\x89PNG\r\n\x1a\nreal-image"

    response = handle_request(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "generate_image",
                "arguments": {"prompt": "a blue circle"},
            },
        },
        generate_image=lambda **_: png,
    )

    assert response is not None
    content = response["result"]["content"]
    assert content[0]["type"] == "image"
    assert content[0]["mimeType"] == "image/png"
    assert content[0]["data"] == base64.b64encode(png).decode("ascii")

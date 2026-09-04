from __future__ import annotations

from pathlib import Path

import pytest

from yali.ai import protocols
from yali.ai.providers import codex_image
from yali.ai.providers.codex_image import CodexImageError, CodexImageProvider, _find_generated_png, _image_prompt


def test_image_prompt_forbids_placeholder_output() -> None:
    prompt = _image_prompt("스마트폰 화면에 구체적인 AI 답변이 표시된 장면")

    assert "GPT Image 2" in prompt
    assert "Do not create SVG" in prompt
    assert "스마트폰 화면에 구체적인 AI 답변이 표시된 장면" in prompt


def test_find_generated_png_uses_only_the_current_codex_thread(tmp_path: Path) -> None:
    thread = tmp_path / "thread-current"
    thread.mkdir()
    expected = thread / "exec-new.png"
    expected.write_bytes(b"new")

    assert _find_generated_png(thread) == expected


def test_find_generated_png_rejects_empty_thread_directory(tmp_path: Path) -> None:
    thread = tmp_path / "thread"
    thread.mkdir()

    try:
        _find_generated_png(thread)
    except RuntimeError as exc:
        assert "PNG" in str(exc)
    else:
        raise AssertionError("expected a missing generated PNG error")


class _CompletedProcess:
    returncode = 0

    def __init__(self, stdout: str) -> None:
        self.stdout = stdout

    def communicate(self, timeout: float | None = None) -> tuple[str, str]:
        return self.stdout, ""

    def poll(self) -> int:
        return self.returncode


def test_generate_image_reads_png_from_reported_thread(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    codex_home = tmp_path / "codex-home"
    thread_id = "thread-image-1"
    generated = codex_home / "generated_images" / thread_id
    generated.mkdir(parents=True)
    expected = generated / "exec-image.png"
    expected.write_bytes(b"\x89PNG\r\n\x1a\nreal-image")
    calls: list[tuple[list[str], dict[str, object]]] = []

    def fake_popen(command: list[str], **kwargs: object) -> _CompletedProcess:
        calls.append((command, kwargs))
        return _CompletedProcess(
            '{"type":"thread.started","thread_id":"thread-image-1"}\n'
            '{"type":"turn.completed"}\n'
        )

    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    monkeypatch.setattr(codex_image, "resolve_codex_command", lambda: "codex")
    monkeypatch.setattr(codex_image.subprocess, "Popen", fake_popen)

    result = codex_image.generate_image("스마트폰 화면", cwd=str(tmp_path))

    assert result == expected.read_bytes()
    assert calls[0][0][:7] == ["codex", "exec", "--ephemeral", "--json", "--sandbox", "read-only", "--cd"]
    assert calls[0][1]["stdin"] is codex_image.subprocess.DEVNULL
    assert calls[0][1]["creationflags"] != 0


def test_generate_image_rejects_non_png_result(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    codex_home = tmp_path / "codex-home"
    generated = codex_home / "generated_images" / "thread-image-2"
    generated.mkdir(parents=True)
    (generated / "exec-image.png").write_bytes(b"not-an-image")

    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    monkeypatch.setattr(codex_image, "resolve_codex_command", lambda: "codex")
    monkeypatch.setattr(
        codex_image.subprocess,
        "Popen",
        lambda *_args, **_kwargs: _CompletedProcess(
            '{"type":"thread.started","thread_id":"thread-image-2"}\n'
        ),
    )

    with pytest.raises(CodexImageError, match="유효한 PNG"):
        codex_image.generate_image("테스트 이미지", cwd=str(tmp_path))


def test_codex_image_provider_returns_png_response(monkeypatch: pytest.MonkeyPatch) -> None:
    content = b"\x89PNG\r\n\x1a\nprovider-image"
    monkeypatch.setattr(codex_image, "generate_image", lambda *args, **kwargs: content)
    provider = CodexImageProvider(model="subscription-model", cwd="C:/workspace")
    request = protocols.ImageGenerationRequest(
        prompt="도시 장면",
        model_name=None,
        metadata=protocols.GenerationMetadata(
            request_id="request-image-1",
            project_id="project-1",
            cut_id="cut-1",
            operation=protocols.Operation.REGENERATE_CUT,
            model="subscription-model",
        ),
    )

    response = provider.generate(request)

    assert response.content == content
    assert response.media_type == "image/png"
    assert response.provider == "codex_image"
    assert response.model == "subscription-model"

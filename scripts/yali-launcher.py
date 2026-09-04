"""Windows GUI-subsystem launcher for Yali Short-form Studio.

The packaged executable delegates to the existing VBS launcher.  Keeping the
service orchestration in one place means the desktop entry point and the
developer launcher follow the same startup/stop behavior.
"""

from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
MB_OK = 0x00000000
MB_ICONERROR = 0x00000010
FRONTEND_URL = "http://127.0.0.1:5173/"


def show_error(message: str) -> None:
    """Show an error without relying on stdout, which is unavailable in GUI mode."""

    try:
        ctypes.windll.user32.MessageBoxW(0, message, "얄리 숏폼 스튜디오", MB_OK | MB_ICONERROR)
    except (AttributeError, OSError):
        # The packaged target is Windows, but keeping this fallback makes the
        # source script harmless to invoke from a non-Windows test runner.
        pass


def _candidate_roots() -> list[Path]:
    candidates: list[Path] = []

    configured_root = os.environ.get("YALI_HOME")
    if configured_root:
        candidates.append(Path(configured_root).expanduser())

    executable = Path(sys.executable).resolve()
    candidates.extend((executable.parent, executable.parent.parent))

    source_file = globals().get("__file__")
    if source_file:
        source_path = Path(source_file).resolve()
        candidates.append(source_path.parent.parent)

    candidates.append(Path.cwd())

    unique: list[Path] = []
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved not in unique:
            unique.append(resolved)
    return unique


def find_project_root() -> Path | None:
    for candidate in _candidate_roots():
        if (candidate / "scripts" / "start-yali.vbs").is_file():
            return candidate
    return None


def find_wscript() -> str:
    system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    system_wscript = system_root / "System32" / "wscript.exe"
    if system_wscript.is_file():
        return str(system_wscript)
    return shutil.which("wscript.exe") or "wscript.exe"


def find_powershell() -> str | None:
    return (
        shutil.which("pwsh.exe")
        or shutil.which("powershell.exe")
        or str(Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe")
    )


def missing_project_requirements(root: Path) -> list[str]:
    """Return project artifacts that must exist before services can start."""

    missing: list[str] = []
    if not (root / "frontend").is_dir():
        missing.append("frontend folder")
    if not (root / "backend").is_dir():
        missing.append("backend folder")

    frontend_bins = (
        root / "frontend" / "node_modules" / ".bin" / "vite.cmd",
        root / "frontend" / "node_modules" / ".bin" / "vite",
    )
    if not any(path.is_file() for path in frontend_bins):
        missing.append("frontend dependencies (vite)")

    if not (root / "render-worker" / "dist" / "index.js").is_file():
        missing.append("render worker build")
    return missing


def show_missing_requirements(missing: list[str]) -> None:
    details = "\n".join(f"- {item}" for item in missing)
    show_error(
        "실행에 필요한 구성요소가 없습니다.\n"
        f"{details}\n\n"
        "README.md의 Windows 개발 순서대로 의존성을 설치하고 다시 실행하세요."
    )


def hidden_process_options(root: Path) -> dict[str, object]:
    options: dict[str, object] = {
        "cwd": str(root),
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "creationflags": CREATE_NO_WINDOW,
    }
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = 0
        options["startupinfo"] = startupinfo
    return options


def run_validation(root: Path) -> int:
    missing = missing_project_requirements(root)
    if missing:
        show_missing_requirements(missing)
        return 1

    script = root / "scripts" / "start-yali.vbs"
    completed = subprocess.run(
        [find_wscript(), str(script), "/validate"],
        check=False,
        **hidden_process_options(root),
    )
    if completed.returncode:
        show_error(
            "실행환경 검증에 실패했습니다.\n"
            "PowerShell에서 scripts\\start-yali.vbs /validate를 실행해 자세한 내용을 확인하세요."
        )
    return completed.returncode


def stop_services(root: Path) -> int:
    script = root / "scripts" / "stop-yali.ps1"
    powershell = find_powershell()
    if not powershell or not Path(powershell).is_file():
        show_error("PowerShell 실행 파일을 찾을 수 없습니다.")
        return 1

    completed = subprocess.run(
        [
            powershell,
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
        ],
        check=False,
        **hidden_process_options(root),
    )
    if completed.returncode:
        show_error("얄리 숏폼 스튜디오 프로세스를 종료하지 못했습니다.")
    return completed.returncode


def wait_for_frontend(timeout_seconds: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(FRONTEND_URL, timeout=1) as response:
                if 200 <= response.status < 500:
                    return True
        except (OSError, urllib.error.URLError):
            time.sleep(0.25)
    return False


def open_frontend() -> bool:
    if not wait_for_frontend():
        show_error(
            "백그라운드 서비스는 시작했지만 작업 화면을 열지 못했습니다.\n"
            f"브라우저에서 {FRONTEND_URL} 주소를 직접 열어보세요."
        )
        return False

    try:
        os.startfile(FRONTEND_URL)  # type: ignore[attr-defined]
    except (AttributeError, OSError) as error:
        show_error(f"작업 화면을 열지 못했습니다.\n{error}")
        return False
    return True


def start_services(root: Path) -> int:
    missing = missing_project_requirements(root)
    if missing:
        show_missing_requirements(missing)
        return 1

    script = root / "scripts" / "start-yali.vbs"
    try:
        subprocess.Popen(
            [find_wscript(), str(script)],
            **hidden_process_options(root),
        )
    except OSError as error:
        show_error(f"프로그램을 시작하지 못했습니다.\n{error}")
        return 1
    open_frontend()
    return 0


def main() -> int:
    root = find_project_root()
    if root is None:
        show_error(
            "프로젝트 폴더를 찾을 수 없습니다.\n"
            "실행 파일은 프로젝트의 release 폴더에 둔 상태로 실행하세요."
        )
        return 1

    arguments = {argument.lower() for argument in sys.argv[1:]}
    if arguments.intersection({"/validate", "--validate"}):
        return run_validation(root)
    if arguments.intersection({"/stop", "--stop"}):
        return stop_services(root)
    return start_services(root)


if __name__ == "__main__":
    raise SystemExit(main())

# Codex ImageGen/GPT Image 2 연동 검증 기록

검증일: 2026-09-04

## 검증 범위

- 디자인 단계의 컷별 이미지 생성 및 재생성
- 상단 전체 이미지 생성 요청의 `image_only` 옵션 전달
- 로컬 MCP 브리지의 `generate_image` 도구
- Codex CLI가 생성한 실제 PNG의 저장·미리보기 경로
- Codex ImageGen을 사용할 수 없을 때 SVG placeholder로 조용히 대체하지 않는 실패 처리

## 실행 결과

| 검사 | 결과 |
| --- | --- |
| Backend pytest | `31 passed` |
| Frontend unit | `43 passed` |
| Frontend build | 성공 |
| 컷 구성 Playwright E2E | `9 passed` |
| 실제 MCP image smoke | PNG signature `true`, `840060 bytes`, `1254x1254` |

실제 smoke test는 `CodexImageProvider`에서 로컬 MCP 브리지를 호출하고, 브리지가 현재 로그인된 Codex CLI의 ImageGen을 실행한 뒤 MCP image content를 반환하는 경로로 수행했습니다. 생성된 파일은 PNG 시그니처와 이미지 크기를 확인했습니다.

## 실행 환경

- Codex CLI: `codex-cli 0.153.0-alpha.5`
- Codex feature: `image_generation stable true`
- 운영체제: Windows
- 인증: 로컬 Codex 로그인 세션
- OpenAI API key: 이미지 smoke 및 앱 provider에 사용하지 않음

## 안전성 확인

- 테스트와 검증 기록에는 API key, 인증 토큰, 원문 프롬프트를 저장하지 않았습니다.
- 브리지와 Codex CLI 프로세스는 Windows 콘솔 창 없이 실행됩니다.
- 생성 실패 시 작업 상태를 `failed`로 남기고 오류를 표시합니다.
- 검증 중 확인된 경고는 Starlette/httpx deprecation warning 1건이며 이미지 생성 결과에는 영향을 주지 않았습니다.

## 관련 구현

- `backend/yali/ai/providers/codex_image.py`
- `backend/yali/ai/providers/codex_mcp.py`
- `backend/yali/ai/codex_mcp_bridge.py`
- `backend/yali/jobs/processor.py`
- `frontend/src/pages/ScriptPage.tsx`

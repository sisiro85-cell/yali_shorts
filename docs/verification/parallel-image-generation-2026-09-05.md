# 디자인 전체 이미지 병렬 생성 검증

검증일: 2026-09-05<br>
대상: 디자인 단계의 전체 이미지 생성

## 구현 범위

- 프런트가 컷별 이미지 작업 요청을 `Promise.all`로 동시에 등록한다.
- 작업 상태는 컷마다 따로 추적하되, 공통 polling으로 완료 수를 집계한다.
- 백엔드 worker 기본 동시 작업 수를 1개에서 4개로 늘렸다.
- Codex ImageGen 호출은 작업마다 기존 MCP 브리지 프로세스를 별도로 시작하므로 컷별 요청 ID와 세션이 분리된다.
- 병렬 작업이 같은 프로젝트를 갱신해도 최신 프로젝트에 대상 컷 하나만 원자적으로 병합한다. 다른 컷의 이미지나 버전은 덮어쓰지 않는다.
- 전체 생성 중 모든 컷 카드의 생성 버튼을 잠그고 `완료/전체` 진행률을 표시한다.

## TDD 증거

- 구현 전 프런트 테스트는 첫 번째 컷 polling이 끝나기 전 두 번째 컷 요청을 보내지 않아 실패했다.
- 구현 전 백엔드 테스트는 worker 한 개가 barrier를 통과하지 못하고 작업이 실패했다.
- 구현 후 두 테스트 모두 통과했으며, 백엔드 fake provider의 동시 호출 peak가 2이고 두 컷 모두 `completed`/`ready`로 저장됨을 확인했다.

## 검증 명령

| 범위 | 명령 | 결과 |
|---|---|---:|
| 병렬 백엔드 회귀 | `.venv\\Scripts\\python.exe -m pytest backend/tests/test_cut_image_generation.py -q` | 8 passed |
| 병렬 프런트 회귀 | `npm exec vitest run src/pages/ScriptPage.test.tsx` | 6 passed |
| Backend 전체 | `.venv\\Scripts\\python.exe -m pytest backend/tests -q` | 40 passed |
| Frontend unit | `npm run unit` | 44 passed |
| Frontend typecheck | `npm run lint` | exit 0 |
| Frontend browser E2E | `npm run e2e` | 24 passed |
| 실제 FastAPI 통합 E2E | `npm run integration` | 1 passed |

실제 Codex 구독 호출은 이 자동 테스트에서 실행하지 않았다. 실제 MCP ImageGen smoke와 사용량을 소비하는 검증은 별도 명시적 실행으로 남겨 둔다. 동시 작업 수 4개는 rate limit과 로컬 자원 사이의 기본값이며, 실제 사용 중 제한이 확인되면 다음 단계에서 설정값으로 노출한다.

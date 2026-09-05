# QA 기준선 — 2026-09-05

## 범위와 판정

검사 대상은 `C:\프로그램\쇼츠자동화`, 소스 기준 커밋은 `b5a28aa`이다. 검사 시작 시 `main...origin/main`이었고 작업 트리는 깨끗했다. 프로그램 코드는 수정하지 않았다. 이 기록은 **현재 존재하는 검사 통과 및 일부 결함 재현**에 대한 보고이며, 제품 전체의 정상 동작 인증이 아니다.

- 실행함: 기존 백엔드 테스트, 프론트 단위 테스트, Playwright 테스트, 타입 검사, 프론트/워커 빌드, 임시 저장소 API QA 관찰.
- 코드로 확인함: 라우팅, 디자인 생성 흐름, 큐, 저장소 충돌 방어, AI 설정, 출력 API, 렌더러, Windows 실행/압축 스크립트.
- 실행하지 않음: 실제 Codex 구독 텍스트/이미지 호출, 실제 HyperFrames MP4 렌더, 집 PC/깨끗한 VM 실행, 새 수동 시각 검수, 보안 침투 테스트.
- 실제 사용자 `storage`, 인증, 프로젝트 미디어는 QA 재현용으로 변경하지 않았다.

## 이번에 실행한 검사

아래 명령은 저장소 루트 기준이다. `npm.cmd`를 사용하면 PowerShell의 npm.ps1 실행 정책 영향을 피할 수 있다.

| 검사 | 명령 | 결과 |
|---|---|---|
| 백엔드 | `.\.venv\Scripts\python.exe -m pytest backend/tests -q` | 34 passed, 경고 1개 |
| 프론트 단위 | `npm.cmd --prefix frontend run unit` | 9 files / 44 passed |
| 브라우저 | `npm.cmd --prefix frontend run e2e` | 24 passed |
| 프론트 타입 | `npm.cmd --prefix frontend run lint` | 종료 코드 0 |
| 프론트 빌드 | `npm.cmd --prefix frontend run build` | 종료 코드 0, Vite production build 성공 |
| 워커 단위/빌드 | `npm.cmd --prefix render-worker run unit` | TypeScript build 및 10 passed |
| 워커 타입 | `npm.cmd --prefix render-worker run lint` | 종료 코드 0 |
| QA 관찰 | `.\.venv\Scripts\python.exe docs/verification/qa-probes-2026-09-05.py` | 아래 3개 현상 재현 |

`lint`라는 스크립트의 실제 내용은 두 패키지 모두 `tsc --noEmit`이다. ESLint/접근성 lint를 수행한 결과로 해석하면 안 된다. 워커 unit 스크립트에는 워커 빌드가 포함되어 있다.

첫 실행에서 문서 작성자가 존재하지 않는 `test:unit` 스크립트를 호출하여 프론트와 워커 명령이 실패했다. 실제 package.json의 `unit`으로 수정하여 다시 실행한 결과가 위 표이다. 이것은 프로그램 기능 실패가 아니다.

백엔드 경고는 Starlette TestClient의 httpx 사용 deprecation 안내다. 의존성 교체는 별도 호환성 검증 후 수행하며, 이번에 자동 업그레이드하지 않았다. Playwright의 NO_COLOR/FORCE_COLOR 경고는 테스트 실패가 아니다.

## 재현 관찰

[재현 스크립트](qa-probes-2026-09-05.py)는 기존 `backend/tests/test_api_mvp.py`의 fake provider fixture를 재사용하고 임시 디렉터리에만 데이터를 쓴다. worker는 비활성화하며 실제 AI/영상 생성은 수행하지 않는다. 결함 수정 이후에는 아래와 다른 결과가 나오는 것이 정상이다. 이 스크립트를 회귀 테스트의 성공 기준으로 그대로 사용하지 않는다.

### Q01. 제작물이 없는 프로젝트를 완료로 생성 가능

요청: `POST /api/projects`, `{"title":"QA lifecycle probe","stage":"completed"}`.

관찰: HTTP 201, `stage=completed`, 씬 0개. 프로젝트 생성/단계 변경에 실제 결과물 준비 조건 검사가 없다.

목표: 일반 프로젝트 생성은 idea만 허용한다. completed는 검증된 결과 파일의 최종 저장 후 내부에서만 설정한다. UI에서 다음 버튼을 막는 것만으로 끝내지 않는다.

### Q02. 실패한 렌더 접수가 출력 기록을 변경

준비: fake로 아이디어·대본·컷까지 만들고 이미지가 없는 상태. 요청: `POST /api/projects/{id}/output/render`, `{"format":"shorts"}`.

관찰: HTTP 422로 거절되지만 `output_variants`가 0개에서 1개로 증가한다. `_prepare_manifest`가 기록을 저장한 후 `_validate_render_sources`가 실패하기 때문이다.

목표: 모든 검증 후 접수·저장한다. 거절된 요청은 프로젝트, 출력 기록, 큐를 변경하지 않는다. 미리보기용 manifest 계산도 저장 부작용과 분리한다.

### Q03. 잘못된 비율을 출력 API에 직접 접수 가능

준비: 모든 컷에 1×1 PNG fixture를 연결하고 ready로 표시. 요청: shorts 출력 렌더 접수.

관찰: HTTP 202, queued. 프론트에서 표시하는 비율 검사와 달리 출력 API는 원본 비율을 차단하지 않는다. 실제 렌더는 실행하지 않았다. 1×1은 검증 경계 확인용 fixture이며, 이것만으로 실제 이미지의 시각 품질을 평가하지 않았다.

목표: 컷/출력 형식별 준비 상태를 백엔드가 판정한다. 비율이 다른 원본은 명시적으로 승인된 contain/cover 배치가 있거나 해당 형식의 생성 자산이 있어야 출력 가능하다. 임의 늘리기/잘라내기로 통과시키지 않는다.

## 테스트 공백과 추가 관찰

| 항목 | 확인된 사실 | 해석/제한 |
|---|---|---|
| 브라우저 테스트 | `frontend/e2e/*.spec.ts`의 주요 API는 `page.route`/`route.fulfill` 사용 | 브라우저 UI 흐름 검증이다. 실제 백엔드·큐·Codex·renderer를 관통하는 E2E가 아니다. |
| 백엔드 테스트 추적 | `backend/tests` 6개 파일 모두 Git 추적 중 | 테스트가 전혀 백업되지 않는 것은 아니다. |
| 신규 테스트 ignore | `git check-ignore -v backend/tests/test_new_qa.py` → `.gitignore`의 `test_*.py` | 이후 추가 테스트는 예외 규칙 없으면 백업에서 빠질 수 있다. |
| CI | 현재 `git ls-files .github` 결과 없음 | 추적 중인 GitHub Actions workflow가 없다. 원격 다른 설정까지 감사한 것은 아니다. |
| 테스트 0개 | unit/e2e에 `--passWithNoTests`, `--pass-with-no-tests` | 테스트 수집 누락도 성공할 수 있다. CI에서는 제거 필요. |
| 렌더 시간 제한 | Python HTTP 기본 30초, Node subprocess 기본 10분 | worker는 완료까지 HTTP 응답을 지연한다. 30초 초과 실제 렌더에서 불일치 위험. 이번에 장시간 렌더를 재현하지는 않았다. |
| 전체 이미지 생성 | `ScriptPage.tsx`의 브라우저 루프가 컷을 하나씩 접수 | 페이지 종료 시 아직 접수되지 않은 컷은 서버 큐에 존재하지 않는다. |
| 병행 컷 요청 | 큐 payload에 project 전체 updated_at 저장, processor가 동일 revision 요구 | 같은 revision으로 여러 컷을 접수하면 먼저 완료한 컷 때문에 후속 요청이 stale이 될 수 있다. 코드 관찰, 동시성 재현 테스트는 다음 단계. |
| 포터블 의존성 | worker는 실행 중 `npx --yes hyperframes@0.8.26`, composition은 GSAP CDN 참조 | ZIP이 있다는 사실만으로 오프라인 렌더 가능하다고 할 수 없다. |
| 과거 실연동 | 별도 [2026-09-04 기록](codex-image2-2026-09-04.md)에 이미지 1건 실연동 결과 있음 | 이번 검사 결과가 아니며, 현재 9:16 생성·7컷 일괄·집 PC의 증거로 대체할 수 없다. |

## 결과 사용 방법

다음 구현은 [QA 기반 구현지시서](../plans/2026-09-05-qa-implementation.md)의 T00부터 진행한다. 단위 테스트 통과와 제품 시나리오 통과를 구분하고, 각 단계마다 실패 재현 → 최소 수정 → 회귀 검사 → 필요한 UI 검수 → GitHub 백업 순서를 지킨다.

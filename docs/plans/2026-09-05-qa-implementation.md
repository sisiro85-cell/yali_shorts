# 얄리 숏폼 스튜디오 — QA 기반 단계별 구현지시서

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 사용자의 현재 요청 범위와 UI 시안 승인 조건이 우선한다. 이 문서를 작성했다는 이유만으로 구현을 시작하지 않는다.

**Goal:** 기존 프로젝트를 보존하면서, 사용자가 집 PC에서 실행해 아이디어 → 대본 → 컷 → 실제 이미지 → 편집 미리보기 → 저장 가능한 쇼츠·릴스 또는 카드뉴스까지 완주하는 프로그램을 만든다.

**Architecture:** 현재 React/Vite 프론트, FastAPI 백엔드, JSON ProjectStore/PersistentJobQueue, 로컬 Codex MCP 브리지, 독립 HyperFrames Node worker를 확장한다. 브라우저는 입력과 표시를, 백엔드는 작업·준비 조건·영속 상태를, worker는 렌더 실행을 책임진다. DB·Electron·새 프론트 프레임워크로 재작성하지 않는다.

**Tech Stack:** 현재 저장소의 Python/Pydantic/FastAPI, React/TypeScript, Vitest/Playwright, HyperFrames renderer. 버전은 각 lockfile을 기준으로 한다. `hyperframes@0.8.26`은 현재 구현의 고정값이지 최신 버전 권고가 아니다.

**Spec:** 사용자 요구사항, 현재 README 및 [실측 QA 기준선](../verification/qa-baseline-2026-09-05.md), [Codex 이미지 연동 명세](../specs/codex-image2-integration.md). 본문의 ‘신규 계약’은 앞으로 구현할 목표이며 현재 API 기능 설명이 아니다.

**기준:** 2026-09-05, 애플리케이션 소스 `b5a28aa`. 본 문서 작성 중 애플리케이션 동작은 변경하지 않았다.

## 1. 결론과 범위

현재 프로그램은 화면만 있는 상태는 아니다. 프로젝트·아이디어·대본·컷·개별 이미지 생성의 골격과 일부 테스트가 존재한다. 그러나 **사용자 화면에서 완성 파일을 내보내는 전체 제작 흐름은 아직 완성되지 않았다.** 메뉴에 보이는 모든 기능이 구현되어 있는 것도 아니다.

다음 개발의 최우선 목표는 메뉴를 더 늘리는 것이 아니라 다음 세 가지다.

1. 이미 되는 기능을 신뢰할 수 있게 만든다: 준비 상태, 오류 안내, 중복/취소/재시작, 원본·버전 보호.
2. 하나의 프로젝트를 실제 파일로 끝낸다: 영상은 우선 무음 MP4, 이후 음성·자막 동기화; 카드뉴스는 별도 PNG/ZIP 출력.
3. 다른 PC에서도 같은 절차로 실행·검증한다: 재현 가능한 패키지, 로그인/의존성 진단, 실제 통합 테스트.

발행 예약·DM 자동화·성과·커뮤니티는 제작 완주 이후 별도 단계다. 이번 로드맵을 핑계로 이 기능들을 한꺼번에 만들지 않는다.

## 2. Global Constraints

- [ ] 매 작업 시작에 branch/status/관련 diff를 확인한다. 사용자의 미커밋 변경을 되돌리지 않는다.
- [ ] 한 번에 아래 T 작업 하나를 구현한다. 하위 체크리스트를 끝내고 검사 증거를 남긴 뒤 다음 T로 이동한다.
- [ ] 새로운 화면/구조 변경은 **시안 → 사용자 검수 → 구현** 순서다. 기존 승인된 뉴트럴 미니멀 디자인, 좌측 공간/상단 흐름/중앙 작업/우측 상세 역할을 유지한다.
- [ ] UI의 모노톤 스타일을 미디어에 적용하지 않는다. 원본 색상·비율을 보존하고 최종 출력용 배치와 원본 보기를 구분한다.
- [ ] Codex 구독 기반 MCP가 기본이다. API는 별도 선택지다. 구독을 API 키처럼 취급하지 않으며 API 과금으로 조용히 전환하지 않는다.
- [ ] 실제 이미지가 없으면 대기/실패로 표시한다. SVG·그라디언트·임시 이미지를 실제 AI 생성 성공으로 기록하지 않는다. fake는 테스트 전용이다.
- [ ] 사용자가 요청한 단계만 생성한다. 페이지 진입만으로 전체 이미지 재생성·유료 호출을 시작하지 않는다.
- [ ] 별도 사용자 채팅/작업을 반복 생성하는 방식으로 연결하지 않는다. CLI 내부 세션과 앱 사이드바에 노출되는 작업을 구분해 검증한다.
- [ ] 실행·이미지 생성·렌더 중 CMD 창을 띄우지 않는다. 숨김 실행 실패는 로그와 한국어 안내로 알린다.
- [ ] `C:\프로그램\쇼츠참고자료`는 참고 소스다. 재사용 시 라이선스·종속성·시험을 확인하고 필요한 모듈만 가져온다. 해당 폴더를 런타임 의존성으로 만들지 않는다.
- [ ] 각 단계 검증 후 관련 코드·테스트·문서만 commit/push한다. 성공한 원격 커밋을 확인한다. 인증·실제 storage·ZIP을 Git에 무심코 추가하지 않는다. force push/저장소 재초기화는 하지 않는다.
- [ ] 브라우저 API mock 테스트, 실제 백엔드 통합 테스트, 실 Codex smoke, 깨끗한 PC 검증을 서로 다른 증거로 기록한다.

## 3. QA 발견 목록

‘재현’은 이번 임시 저장소 검사에서 관찰한 결과, ‘코드’는 소스로 확인한 동작/위험, ‘공백’은 아직 검증되지 않은 범위다. P0는 해당 기능 경로를 출시하기 전에 반드시 막을 데이터/실행 신뢰성 문제, P1은 제작 MVP 완주 문제, P2는 확장 기능이다. 렌더 P0는 출력 연결 전, 패키징 P0는 배포 전의 통과 조건으로 적용한다.

| ID | 우선 | 근거 | 문제 / 영향 | 담당 작업 |
|---|---|---|---|---|
| Q01 | P0 | 재현 | 빈 프로젝트를 completed로 생성 가능. 단계 표기가 실제 결과물과 무관해짐 | T01 |
| Q02 | P0 | 재현 | 렌더 요청 422 후에도 output_variants 증가. 실패 요청의 저장 부작용 | T01 |
| Q03 | P0 | 재현 | 1:1 이미지를 9:16 렌더로 API 직접 접수 가능. UI 비율 방어 우회 | T01, T07 |
| Q04 | P0 | 코드 | 전체 생성 순서를 브라우저 루프가 소유. 새로고침 시 미접수 컷 유실 | T04 |
| Q05 | P0 | 코드 | 큐가 프로젝트 전체 revision에 묶임. 서로 다른 컷 완료/편집도 stale 유발 가능 | T03 |
| Q06 | P0 | 코드 | cutJob 단일 로컬 상태, 재진입 시 복구 부족, job 미발견 polling 종료 조건 부족 | T03, T04 |
| Q07 | P0 | 코드 | HTTP 렌더 timeout 30초 vs worker 10분, worker는 렌더 후 응답 | T08 |
| Q08 | P0 | 코드/공백 | 런처가 전체 서비스 식별/준비를 보장하지 못함. 다른 PC 실행 증거 부족 | T12 |
| Q09 | P1 | 코드 | output 화면은 StagePlaceholder. 렌더·다운로드 UI 미연결 | T09 |
| Q10 | P1 | 코드 | AI/설정/작업 큐/라이브러리 등 사이드바 hash 링크. 빠른 시작은 알림만, 전체 보기는 핸들러 없음 | T04, T05, T06, T13 |
| Q11 | P1 | 코드 | 설정은 환경 변수 + GET/test만 존재. 이미지 provider는 별도 Codex 고정 | T05 |
| Q12 | P0 | 코드 | API 설정이 있으면 Codex 실패 시 자동 fallback. 명시적 과금 전환 설정 부재 | T02, T05 |
| Q13 | P1 | 코드 | 대본/컷 계획은 긴 동기 HTTP 요청. 저장 충돌은 막지만 사용자가 다시 시도할 근거 부족 | T02, T04 |
| Q14 | P1 | 코드 | 이미지 dimensions 미상도 ready 집계. 비율은 프론트/백엔드 중복 계산, 요청 형식별 배치 부족 | T01, T07 |
| Q15 | P1 | 코드 | 카드뉴스도 현재 output 경로는 MP4 처리. PNG 여러 장/ZIP 계약 없음 | T11 |
| Q16 | P0 | 코드/공백 | 신규 test_*.py ignore, 테스트 0개 성공 옵션, 추적된 CI 없음 | T00 |
| Q17 | P1 | 공백 | 주요 Playwright API mock. 실제 큐→이미지→영상 완주 회귀가 없음 | T00, T09, T12 |
| Q18 | P1 | 코드 | 출력 composition은 GSAP CDN, 렌더는 npx 동적 취득. 포터블 오프라인 보장 불가 | T08, T12 |
| Q19 | P1 | 코드 | 일부 이미지/제공자 오류를 일반 문구로 축약, 비구조화 LLM 응답을 기본 모양으로 보정 | T02 |
| Q20 | P1 | 코드 | 참고자료 업로드 실패 후 restore는 revision 회피 복구 경로. 동시 변경 보존 여부 추가 시험 필요 | T03 |

현재 구현도 보존한다: ProjectStore의 파일 잠금·원자적 JSON 저장·revision 비교, 출력 staged file/rollback, 큐의 idempotency/terminal-state 보호, 컷 잠금·버전, 이미지 비율 검사를 제거하지 않는다. 문제 해결은 이 장치들의 빈틈을 메우는 방향이다.

## 4. 단계 순서와 제품 완료 범위

| 순서 | 작업 | 작업 끝에서 사용자가 얻는 것 | 진행 조건 |
|---|---|---|---|
| 0 | T00 | 누락 없이 수집되는 테스트와 자동 검사 기준 | 기준선 기록 |
| 1 | T01 → T02 → T03 | 거짓 완료/잘못된 접수 차단, 원인을 아는 오류, 개별 생성 안정화 | P0 회귀 통과 |
| 2 | T04 → T05 → T06 | 재진입해도 이어지는 생성, 실제 설정·작업 목록·탐색 | 해당 UI 시안 승인 |
| 3 | T07 → T08 → T09 | 디자인 설정과 일치하는 무음 쇼츠/릴스 MP4 저장 | 실제 로컬 렌더 완주 |
| 4 | T10 | 음성·자막·길이가 맞는 영상 저장 | 오디오 동기화 검수 |
| 5 | T11 | 카드뉴스 PNG 세트/ZIP 저장 | 카드뉴스 별도 출력 검수 |
| 6 | T12 | 집 PC에서 실행·작업·재패키징 가능한 배포본 | 깨끗한 Windows 환경 검증 |
| 7 | T13 → T14 | 자료·브랜드·캐릭터 재사용, 승인 기반 발행 확장 | 제작 MVP 완료 |

T12의 런처 진단·의존성 목록 정리는 T00 후 병행 가능하지만 **최종 배포 승인**은 T09~T11 결과를 포함해서 다시 검사한다. 작업 일수는 아직 추정하지 않는다. 특히 외부 이미지/렌더 환경의 불확실성을 먼저 측정한다.

## 5. 공통 계약: 구현에 적용할 제안 기준

### 5.1 준비 상태와 오류

신규 `GET /api/projects/{id}/workflow`는 결과물을 검사해 단계별 준비 상태를 반환한다. `ready`는 단순 stage 숫자가 아니다. 출력 형식마다 `output/validate`를 추가하여 같은 검증 함수를 재사용한다.

```json
{
  "project_id": "UUID",
  "stage": "design",
  "can_enter": {"idea": true, "script": true, "cuts": true, "design": true, "output": false},
  "blockers": [{"code": "IMAGE_ASPECT_MISMATCH", "cut_id": "UUID", "field": "media", "message": "씬 2 · 컷 1의 이미지 비율을 확인해 주세요."}]
}
```

기존 `{code,message,details}` 오류 envelope를 유지한다. `details`에 `request_id`, `retryable`, `action`, `cut_id`, `errors`를 선택적으로 추가한다. 예상 가능한 잘못된 입력은 422, 현재 데이터와 충돌은 409, 의존성 미준비는 503, 외부 생성 실패는 502로 구분한다. 접수 후 실패는 job의 error_code와 같은 안전한 사용자 메시지로 조회한다.

UI는 필드 옆/컷 카드/작업 큐에 구체적인 수정 방법을 보여준다. 전체 화면 하단에 ‘요청 값을 확인해 주세요’만 남기지 않는다. 원시 prompt·API 키·auth.json·전체 stderr를 오류 응답에 싣지 않는다.

### 5.2 상태와 데이터 보호

- 현재 stage/status 동기화 모델을 T01에서 전면 교체하지 않는다. backward navigation은 허용하되 데이터 삭제 없이 이동한다. 일반 create/PATCH로 completed를 만들 수 없게 한다.
- `completed`는 결과 파일 검증 및 원자적 저장 후에만 설정한다. 제작 단계 방문과 제작 성공을 구분한다.
- active version은 성공적으로 완성한 불변 snapshot이다. 생성 중 임시 결과는 그 snapshot을 변경하지 않는다. 실패/취소/출처 충돌 때 이전 미디어와 버전은 유지한다.
- 긴 작업에는 source script/cut version, prompt digest, 대상 비율, provider/model, 요청 ID를 스냅샷으로 남긴다. 결과 채택 시 해당 컷의 출처를 확인한다.
- 변경하지 않은 다른 컷까지 덮어쓰지 않는다. 파일 쓰기 직전에는 최신 ProjectStore 상태에 해당 컷만 병합하고 revision CAS를 수행한다.
- 저장소 형식을 바꿀 때 schema_version과 idempotent migration을 추가한다. 마이그레이션 전 프로젝트별 복구본을 만들고 원본이 손상되면 자동 덮어쓰지 않는다. 실제 사용자의 데이터 복구/삭제는 범위를 알린다.

### 5.3 작업/재시도

- 일반 job status는 기존 queued/running/completed/failed/cancelled를 유지한다. 결과가 불확실한 재시작은 `failed + error_code=INTERRUPTED_UNKNOWN_RESULT`로 표현해 enum을 불필요하게 늘리지 않는다.
- 같은 논리 요청의 네트워크 재전송에는 같은 Idempotency-Key를 쓴다. 사용자가 새로 생성하기로 누른 재생성은 새 키다. 기존 요청 조회보다 현재 mutable revision을 먼저 hash해 재전송을 다른 요청으로 오판하지 않는다.
- 프로세스 재시작 후 running을 무조건 다시 호출하지 않는다. 저장된 결과/artifact가 있으면 검증해 연결하고, 원격 완료 여부를 모르면 불확실 상태를 보여 사용자 재시도를 받는다. 중복 구독 사용량/API 비용을 피한다.
- UI는 projectId+jobId로 상태를 복구한다. 화면 이탈은 구독/polling만 중단하며 작업 취소와 동일시하지 않는다.
- percent를 제공하지 않는 AI는 임의 진행률을 꾸미지 않는다. ‘대기/이미지 생성 중/파일 검증 중’과 컷 완료 수로 표시한다.

### 5.4 UI 공통 검수 기준

- 화면 너비 1920/1440/1280/1024/768/390 CSS px, 브레이크포인트 전후 1px, Windows 배율 100/125/150%를 검사한다. viewport 테스트를 실제 OS 배율 검증이라고 부르지 않는다.
- 좁은 폭에서는 우측 상세를 접거나 본문 아래로 이동한다. 본문을 덮지 않고 전역 가로 스크롤이 생기지 않아야 한다. 긴 제목·오류·한글 줄바꿈도 포함한다.
- 모든 `?`는 hover와 focus로 설명, touch는 탭으로 표시한다. 툴팁은 잘리지 않고 Escape로 닫힌다.
- 버튼은 hover/active/focus/disabled/loading 상태와 비활성 이유를 제공한다. 클릭했는데 아무 반응 없는 활성 컨트롤을 두지 않는다.
- dialog는 이름, focus trap, Escape/취소, 닫은 뒤 원래 버튼 focus 복귀를 제공한다. destructive 작업 중 중복 요청을 막는다.
- 프리뷰의 이미지 불러오기 실패도 정상 ready로 보이지 않아야 한다. 깨진 이미지에 대한 안내·재조회·원본 확인 동작을 둔다.

## 6. 상세 실행 작업

### T00. 테스트 수집·기준선·CI부터 고정

**변경:** `.gitignore`, `frontend/package.json`, `frontend/playwright.config.ts`, `README.md`.

**신규:** `.github/workflows/qa.yml`, `backend/tests/conftest.py`, `frontend/playwright.integration.config.ts`, `frontend/e2e-integration/`.

**입출력:** 기존 테스트 명령 유지. 모의 UI 검사와 실제 서버 연결 검사를 별도 명령/설정으로 분리한다. 통합 테스트는 임시 data_root와 테스트 전용 provider_factory/image_provider_factory를 사용한다. production 환경 변수만 바꿔 fake를 켜지 않는다.

- [ ] `.gitignore`에 backend/tests의 test 파일 예외를 추가하고 새 테스트가 `git status --untracked-files=all`에 잡히는지 확인한다. 기존 6개 테스트는 이미 추적 중이다.
- [ ] CI용 unit/e2e에서 ‘테스트 없음도 성공’ 옵션을 제거한다. `lint`를 typecheck로 분명히 표기한다. ESLint를 도입한다면 별도 변경 사유와 최소 규칙부터 제시한다.
- [ ] Windows runner에서 Python 환경, npm ci, unit/type/build/UI E2E를 순서대로 실행한다. 테스트 수 0개나 누락 패키지는 실패한다. 실제 사용자 auth/storage/AI 호출을 CI에 넣지 않는다.
- [ ] 기존 `create_app(data_root, provider_factory, image_provider_factory, enable_worker=True)` 확장점을 이용해 통합 fixture를 만든다. port는 개발용 5173/8000과 분리하고 reuseExistingServer를 끈다. 다른 앱을 종료해서 포트를 비우지 않는다.
- [ ] browser→실제 FastAPI→실제 큐/저장소→test provider까지 통과하는 `project-flow.spec.ts` 한 개를 추가한다. `/api/**` route.fulfill을 사용하지 않는다. 새로고침 후 저장 복원을 검증한다.
- [ ] 실패 시 테스트별 스크린샷·trace·서버 로그를 저장하되 민감한 입력을 지운다. 실패 재현 command를 docs/verification에 남긴다.

**통과 조건:** 기존 34/44/24/10 기준 테스트가 누락 없이 실행되고 신규 통합 fixture가 실 저장소와 다른 경로임을 assertion으로 검증한다. 테스트 수는 최소 기준이며 영구 고정 숫자로 박지 않는다.

### T01. 단계·이미지 준비 조건과 실패 요청의 무변경 보장

**변경:** `backend/yali/api/routes/{projects.py,outputs.py}`, `backend/yali/rendering/manifest.py`, `backend/yali/api/app.py`, `frontend/src/app/api.ts`, `frontend/src/features/design/DesignBoard.tsx`.

**신규:** `backend/yali/content/readiness.py`, `backend/tests/test_workflow_readiness.py`, `backend/tests/test_output_validation.py`.

**입출력:** §5.1의 workflow, `POST .../output/validate` → `{ready, blockers}`. 기존 `output/render`도 동일한 검증을 거친다. manifest를 계산하는 함수는 파일/ProjectStore를 쓰지 않는 순수 함수로 유지한다.

- [ ] Q01~03을 원하는 동작으로 검사하는 실패 테스트부터 작성한다. 아래 예제는 기존 fixture를 임시로 재사용하고 T00 후 conftest로 옮긴다.

```python
from test_api_mvp import _client, _complete_idea
from yali.storage.project_store import ProjectStore

def test_rejected_render_does_not_create_a_variant(tmp_path):
    client, project = _client(tmp_path)
    _complete_idea(client, project)
    base = f"/api/projects/{project.id}"
    assert client.post(f"{base}/script/generate", json={}).status_code == 200
    assert client.post(f"{base}/cuts/generate", json={}).status_code == 200
    store = ProjectStore(tmp_path)
    before = store.get(project.id).model_dump(mode="json")
    rejected = client.post(f"{base}/output/render", json={"format": "shorts"})
    assert rejected.status_code == 422
    assert store.get(project.id).model_dump(mode="json") == before
```

- [ ] 프로젝트 생성은 idea 시작만 허용한다. 앞으로 단계 이동 시 현재 출처와 결과물을 검증한다. completed는 일반 입력으로 거절한다. 뒤로 이동해도 기존 결과물을 지우지 않는다.
- [ ] 현재 아이디어/대본, 최신 컷 계획, 활성 이미지, 파일 존재·읽기·크기·비율을 판정한다. 크기 미상을 ready로 처리하지 않고 probe 후 판정하며, 실패하면 해당 컷의 blocker를 반환한다.
- [ ] T07의 명시적 화면 맞춤 설정이 없을 때는 비율 불일치를 422로 처리한다. 나중에 contain/cover를 허용해도 승인되지 않은 원본 배치를 몰래 보정하지 않는다.
- [ ] `output/manifest`의 저장 부작용을 제거한다. render는 전체 검증 후 variant/queue를 연결해 저장한다. 한쪽 저장 실패 시 고아 기록을 남기지 않는다. 파일 잠금을 잡은 채 외부 생성/렌더링을 수행하지 않는다.
- [ ] 미리보기·준비 건수·다음 버튼이 같은 서버 판정을 사용하도록 한다. 오래된 컷 보드에서는 이전 이미지가 ready여도 다음으로 진행하지 못하게 한다.
- [ ] ProjectRevisionConflict를 안전한 409와 재조회 안내로 변환한다. 저장 충돌 방어를 일반 500 오류에 묻히게 하지 않는다.

**검증:** 신규 두 파일의 pytest, 기존 API tests, DesignBoard unit. 빈 프로젝트/크기 미상/비율 불일치/사라진 파일/오래된 대본/직접 API/거절 시 revision 불변을 포함한다. Q01~03 수정 확인 후 다음 작업으로 간다.

### T02. AI 응답·오류·과금 전환을 명확하게 처리

**변경:** `backend/yali/ai/{gateway.py,config.py,protocols.py}`, `backend/yali/ai/providers/codex_image.py`, `backend/yali/content/service.py`, `backend/yali/jobs/processor.py`, `backend/yali/api/app.py`, `frontend/src/app/api.ts`.

**신규 시험:** `backend/tests/test_ai_failures.py`. 기존 `frontend/src/app/api.test.ts` 확장.

**입출력:** 기존 GenerationResult를 유지하고 operation별 Pydantic 결과 모델로 성공 여부를 판정한다. 공개 오류에는 code/retryable/action을 둔다. API 전환 설정 `allow_api_fallback=false`를 기본값으로 추가한다.

- [ ] CLI 미발견, 로그인 없음, 이미지 도구 미지원, 사용량 제한, 시간 초과, 잘못된 JSON, PNG 없음/손상, 비율 불일치를 구분한다. 제공자별 예외를 공통 오류 코드로 변환한다.
- [ ] 비정상 응답을 빈 scenes/cut으로 보정해 성공 처리하지 않는다. 기존 content service의 보정은 순서 정리 등 안전한 정규화에 한정한다. 필수 스키마가 틀리면 저장하지 않는다.
- [ ] 자동 재시도는 호출 전 실패처럼 안전한 일시 실패에만 적용하고 대기 간격·횟수 상한을 둔다. 시간 초과 후 실제 생성 완료 여부가 불명확하면 자동 재생성하지 않는다.
- [ ] API 설정이 있다는 이유만으로 전환하지 않는다. 사용자가 전환을 허용하고 API용 모델이 설정된 경우에만 사용한다. Codex용 모델 이름을 그대로 API에 넘기지 않는다.
- [ ] request_id로 UI·작업·민감정보를 제거한 로그를 추적한다. 실제 사용한 provider/model을 표시하며 실생성 테스트가 사용량을 소비함을 알린다.

**통과 조건:** 비정상 응답/CLI 누락 시 이전 활성 버전 유지. 비밀값이 든 예외도 응답/로그에 유출 없음. 전환 불허 상태의 API stub 호출 0회, 허용한 경우만 호출 1회.

### T03. 개별 컷 생성·재생성·저장·복귀 안정화

**변경:** `backend/yali/jobs/{models.py,queue.py,processor.py,runner.py}`, `backend/yali/storage/project_store.py`, `backend/yali/api/routes/{cuts.py,ideas.py,jobs.py}`, `frontend/src/app/api.ts`, `frontend/src/pages/ScriptPage.tsx`, `frontend/src/features/design/DesignBoard.tsx`.

**신규:** `frontend/src/features/jobs/useProjectJobs.ts`, `backend/tests/test_job_lifecycle.py`, `frontend/src/features/jobs/useProjectJobs.test.tsx`.

**입출력:** 기존 job에 출처 스냅샷을 추가하고 cut/job 관계를 ID로 관리한다. `GET /api/jobs/{job_id}`를 추가한다. UI busy 상태는 컷 ID별 작업 목록과 서버 상태에서 계산한다.

- [ ] 지연 fake provider로 A 생성 중 B 자막 편집, A 재생성 연타, 생성 중 잠금/버전 복원/프로젝트 전환을 재현한다.
- [ ] 프로젝트 전체 revision만으로 출처 충돌을 판단하지 않는다. 대상 컷의 version/prompt/duration/lock, source script와 최신 plan을 검사하고 무관한 변경은 보존해 결과를 병합한다.
- [ ] 동일 컷의 중복 생성은 나중 결과로 덮어쓰지 않고 현재 작업을 반환하거나 409로 거절한다. 기본 worker 수 1은 유지하며 병렬화는 이 보호가 통과한 뒤 검토한다.
- [ ] 생성 성공 전 active version을 확정하지 않는다. 파일/metadata 저장 실패·취소 시 신규 임시 파일만 정리하고 기존 이미지는 보존한다.
- [ ] `store.restore(previous_project)`가 동시 작업의 성공 결과를 덮어쓰는지 시험한다. 무조건 과거 스냅샷으로 되돌리지 말고 해당 작업의 변경만 복구한다.
- [ ] useProjectJobs는 진입 시 미종료 작업을 조회하고 프로젝트 변경 시 구독을 해제한다. 늦게 도착한 응답으로 다른 프로젝트 화면을 바꾸지 않는다. 저장/버전 활성화에도 같은 방어를 적용한다.
- [ ] 작업 404는 소실 안내, 통신 오류는 재연결 안내, 종료 상태는 polling 중단으로 처리한다. 브라우저 대기 시간 초과를 서버 작업 취소로 취급하지 않는다.
- [ ] 디자인 화면에서도 기존 이미지 버전 복원을 재사용한다. UI 추가는 시안 승인 후 진행한다.

**통과 조건:** 서로 다른 두 컷을 동시에 접수해 둘 다 올바르게 저장된다. 같은 컷 중복 실행 없음, 다른 컷 편집 유지, 잠금 우선, 실패/취소 후 기존 이미지 유지, 새로고침 후 실제 상태 복원. 외부 API 없이 지연 fake 시험으로 반복 재현한다.

### T04. 서버가 관리하는 전체 생성과 작업 큐 화면

**변경:** `backend/yali/jobs/{models.py,queue.py,runner.py,processor.py}`, `backend/yali/api/routes/{cuts.py,scripts.py,jobs.py}`, `frontend/src/pages/ScriptPage.tsx`, `frontend/src/app/{api.ts,router.tsx}`, `frontend/src/components/layout/Sidebar.tsx`.

**신규:** `backend/yali/jobs/batch.py`, `frontend/src/pages/JobsPage.tsx`, `frontend/src/features/jobs/`, `backend/tests/test_batch_jobs.py`, `frontend/e2e-integration/batch-recovery.spec.ts`.

**신규 계약 표기:**

```text
POST /api/projects/{id}/image-batches
  Idempotency-Key: <같은 논리 batch에 고정한 UUID>
  { mode: "missing" | "failed" | "all_unlocked", cut_ids?: UUID[] }
  -> 202 { batch_id, total, skipped_locked, status }
GET /api/projects/{id}/image-batches/{batch_id}
  -> { batch_id, status, total, completed, failed, cancelled, skipped_locked,
       items: [{cut_id, job_id, status, error_code}] }
POST /api/projects/{id}/image-batches/{batch_id}/cancel
POST /api/jobs/{job_id}/cancel
POST /api/jobs/{job_id}/retry -> 202 {job_id, status}
  # 새로운 자식 작업을 만들고 원래 기록은 유지한다.
```

batch는 기존 jobs.json의 kind=image.batch 부모 기록과 자식 연결로 표현한다. 별도의 영속 큐를 만들지 않는다. partial_failed는 집계 응답의 상태로만 두고 일반 job enum은 유지한다. 부모는 자식들의 종료 상태가 확정된 후 종료한다. 현재 JobRunner의 handler 반환 후 자동 completed 처리를 부모에는 그대로 적용하지 않는다. 잠금으로 제외한 컷은 처리 대상 total에서 빼고 별도 표시한다.

- [ ] 한 번의 HTTP 요청으로 대상 컷과 출처 스냅샷을 영속화한다. 브라우저의 for 루프와 waitForJobCompletion 연결을 제거한다.
- [ ] 기본은 미생성/부적합 이미지 대상이다. all_unlocked는 대상 건수와 이전 버전 보존을 알려 명시 실행한다. 서버에서도 잠금을 제외한다.
- [ ] 한 건 실패해도 나머지는 처리하고 마지막에 ‘7건 중 5건 성공·2건 실패’를 반환한다. 실패한 컷만 재시도할 수 있어야 한다.
- [ ] 취소는 미시작 자식을 중지하고 실행 중 요청도 provider/worker까지 전달한다. 외부 생성 중지가 불가능하면 이를 알리고 늦게 받은 결과를 활성화하지 않는다.
- [ ] 재시작 후 부모·자식 관계를 복원한다. 외부 결과가 불확실하면 자동 호출하지 않고 §5.3 방침으로 사용자가 재시도하도록 한다.
- [ ] JobsPage 시안을 먼저 제시한다. 상태 필터, 프로젝트/씬/컷, 시작·경과 시간, 실패 이유, 재시도/취소, 해당 컷 이동을 구현한다.
- [ ] 대본 생성/컷 계획도 job kind를 추가해 202 계약으로 옮긴다. 프론트와 백엔드를 같은 작업 단위에서 변경하고 기존 200 응답 테스트도 명시적으로 갱신한다.
- [ ] batch 조정자가 단일 worker를 점유한 채 자식 완료를 기다리지 않게 한다. 자식을 순차 접수하고 완료 이벤트에서 다음 자식을 진행하거나 runner와 분리된 짧은 조정 단계로 처리한다.

**통과 조건:** 7컷 중 세 번째가 한 번 실패 → 브라우저 종료 후에도 나머지 계속 → 재진입 시 6성공 1실패 → 실패 1건만 재시도 → 7성공. 취소된 작업이 completed로 바뀌지 않고 같은 batch 키는 같은 부모를 반환한다.

### T05. Codex MCP / API 설정과 실행 준비 진단

**변경:** `backend/yali/ai/{config.py,gateway.py}`, `backend/yali/api/routes/settings.py`, `backend/yali/api/app.py`, `frontend/src/app/{router.tsx,api.ts}`, Sidebar.

**신규:** `backend/yali/ai/settings_store.py`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/features/settings/`, `backend/tests/test_settings_persistence.py`.

**계약:** `PATCH /api/settings/llm`은 provider, codex_cli_path, codex_model, api_base_url, api_model, allow_api_fallback을 저장한다. `GET /api/settings/capabilities`는 text/image/render 각각을 `ready|missing|unknown`과 설명으로 반환한다. API 키 응답은 `api_key_configured: boolean`만 제공한다.

- [ ] 시안에서 ‘텍스트: Codex MCP’와 ‘이미지: Codex ImageGen’을 구분한다. HTTP API와 MCP를 혼동시키지 않는다. 모델 공란은 설치된 runtime의 기본 모델이라는 의미를 표시한다.
- [ ] 읽기 전용 진단은 CLI 경로·버전·로그인·이미지 도구·렌더 의존성을 확인하되 생성 호출은 하지 않는다. 텍스트 성공을 이미지 가능으로 단정하지 않는다. 확인 불가능한 항목은 unknown이다.
- [ ] ‘연결 진단’과 ‘실제 생성 테스트’를 분리한다. 후자는 사용량이 발생함을 표시하고 명시 클릭에만 실행한다. image2 이용 가능 여부는 집 PC의 실제 runtime에서 검증한다.
- [ ] 비밀이 아닌 설정은 storage 설정으로, 비밀은 Windows 사용자 단위 보호 저장소로 분리한다. 표준 OS API로 가능한지 확인하고 추가 라이브러리가 필요하면 이유를 먼저 설명한다. 평문 키를 저장소/ZIP에 넣지 않는다.
- [ ] 키를 저장하는 별도 쓰기 계약을 정한다: `PUT /api/settings/api-key`는 입력만 받고 비밀을 돌려주지 않으며, `DELETE`는 해당 저장 키만 제거한다. GET은 존재 여부만 반환한다.
- [ ] 설정 쓰기와 생성 API도 localhost 수신, 허용 Host/Origin, 앱 세션 확인으로 보호한다. 다른 웹사이트가 로컬 설정을 바꾸거나 생성 사용량을 소비할 수 없게 시험한다. OS 사용자 인증을 대체하는 온라인 계정 시스템을 새로 만들지는 않는다.
- [ ] 설정 변경은 다음 작업에 적용하고 실행 중 작업은 시작 시 스냅샷을 유지한다. 잘못된 설정은 기존 값을 보존한 채 422를 반환한다.
- [ ] API 이미지 provider가 미구현이면 ‘API 이미지: 미지원’으로 표시한다. 텍스트를 API로 바꿨다고 이미지도 API로 바뀐 것처럼 보이지 않게 한다. 추가 시 동일 ImageProvider 계약을 충족한다.
- [ ] README/포터블의 설정 안내를 실제 화면과 일치시킨다. 현재 ZIP에 Codex CLI가 없다면 설치와 로그인 모두 필요하다고 쓴다.

**통과 조건:** 저장→재시작→복원, CLI 누락/미로그인/이미지 미지원/API 키 없음, 전환 허용/불허, 응답·로그·내보내기에서 비밀 비노출. 실 Codex smoke는 별도 기록하며 실패 원인을 표시한다.

### T06. 실제로 동작하는 탐색·메뉴·프로젝트 관리

**변경:** `frontend/src/pages/HomePage.tsx`, `frontend/src/app/{router.tsx,navigation.ts}`, `frontend/src/components/layout/{Sidebar.tsx,QuickStartBar.tsx,TopWorkflow.tsx}`, `frontend/src/features/home/{ProjectRow.tsx,HomePage.test.tsx}`.

**신규:** `frontend/src/pages/ProjectsPage.tsx`, `frontend/src/pages/NotFoundPage.tsx`, 관련 CSS/tests.

**입출력:** 프로젝트 목록은 기존 GET/list, 이름 변경은 기존 PATCH title을 사용한다. `projectStagePath`를 이동 경로의 단일 기준으로 한다.

- [ ] 컨트롤 목록에 화면/문구/이동 위치/활성 조건/시험명을 기록한다. 전체 보기 2개, 빠른 시작 5개, 사이드바 전 항목을 포함한다.
- [ ] 새 프로젝트/AI 아이디어는 새 입력 화면, 작업 큐는 T04 화면, 전체 보기는 ProjectsPage에 연결한다. 미구현 라이브러리 등은 비활성 이유를 표시하고 hash만 바꾸지 않는다.
- [ ] 최근 프로젝트의 버튼은 idea를 포함해 선택/이동 의미를 통일한다. 현재 idea만 목록 선택으로 처리하는 방식이 문구와 맞는지 확인한다.
- [ ] 상단 선택기에 검색/현재 선택/새 프로젝트를 표시하고 유효한 마지막 제작 단계로 이동한다. 없는 ID는 404 안내와 목록 복귀를 제공한다.
- [ ] 직접 URL, 브라우저 뒤로/앞으로, 새로고침, 저장 중 프로젝트 전환을 시험한다. 미저장 편집은 이탈 확인을 하되 진행 작업을 화면 이탈만으로 취소하지 않는다.
- [ ] 이름의 공백/길이를 검증한다. 삭제 확인창에는 관련 데이터와 취소될 작업 건수를 표시하고 확인 후에만 실행한다. 작업 완료가 삭제된 프로젝트를 복구시키지 않는 시험을 추가한다. 휴지통 기능은 별도 사양 승인 없이 추가하지 않는다.
- [ ] 새 목록/관리창은 시안 승인 후 구현하고 §5.4를 통과한다.

**통과 조건:** 활성 버튼은 모두 동작하거나 이유를 설명한다. 이어서 작업/선택기/전체 보기가 일관된 프로젝트와 단계로 이동한다. 삭제 프로젝트의 작업이 데이터를 재생성하지 않는다.

### T07. 디자인 편집과 출력 비율 일치

**변경:** `frontend/src/features/design/{DesignBoard.tsx,design.css}`, `backend/yali/domain/models.py`, `backend/yali/rendering/manifest.py`, `backend/yali/media/aspect.py`, `render-worker/src/{types.ts,composition.ts}`.

**신규:** `frontend/src/features/design/{DesignInspector.tsx,CompositionPreview.tsx}`, `backend/yali/api/routes/design.py`, `backend/tests/test_design_settings.py`, `frontend/e2e-integration/design-preview.spec.ts`.

**계약:** `GET/PATCH /api/projects/{id}/design`으로 출력 형식, 전체 자막 스타일, 컷별 재정의·fit_mode·위치·모션을 저장한다. 기존 SubtitleStyle을 확장하고 중복 타입을 만들지 않는다. 허용값/범위를 Pydantic/TS에 일치시킨다.

- [ ] 시안: 간결한 컷 격자, 선택 컷의 오른쪽 상세, 원본/출력 미리보기 전환, 상단 전체 생성, 하단 이전/다음. 390px에서는 상세를 아래에 둔다. 지나치게 긴 카드 문제를 반복하지 않는다.
- [ ] 씬 번호, 프로젝트 전체 컷 번호, 씬 안의 컷 번호를 구분한다. ‘컷 1’이 반복돼도 어느 이미지인지 알 수 있어야 한다.
- [ ] 원본 보기는 contain과 필터 없음이 기본이다. 출력 보기는 1080×1920 또는 1080×1080 좌표계를 비례 축소한다. UI의 CSS px를 출력 글자 크기로 그대로 사용하지 않는다.
- [ ] fit_mode는 contain(여백)과 cover(잘라 채우기)만 제공한다. 기본 contain, cover는 잘리는 부분을 확인하고 저장하게 한다. 이미지를 찌그러뜨리는 stretch는 제공하지 않는다.
- [ ] AI 생성 목표 비율을 프롬프트와 작업 스냅샷에 고정한다. PNG의 4% 비율 허용뿐 아니라 실제 크기·손상도 검사한다. 거절 후 무한 자동 재생성하지 않는다.
- [ ] 1:1/9:16 혼합 프로젝트는 output_format을 명시 선택한다. 처음에는 공통 원본+형식별 디자인 설정으로 시작한다. 다른 비율의 생성 이미지가 필요하면 variant별 asset 참조를 추가해 서로 덮어쓰지 않는다.
- [ ] 자막 위치/크기/색/외곽선/배경/줄바꿈/안전 영역/모션에 같은 정의를 사용해 미리보기와 렌더를 일치시킨다. UI 설정을 원본 이미지에 덮어 굽지 않는다.
- [ ] 이미지 프롬프트에 미저장 변경이 있으면 전체 생성 전에 사용할 내용을 확인한다. 로컬 수정값과 서버 저장값이 실행 순서에 따라 뒤바뀌지 않게 한다.
- [ ] T01 readiness가 명시적 fit 승인 여부를 판단하도록 확장한다. 단순히 프론트의 비율 경고만 없애지 않는다.

**통과 조건:** 동일 manifest의 미리보기/렌더 정지 프레임에서 주요 요소 위치 오차가 1080 기준 2px 이내. 원본 hash 불변. 형식 전환 시 다른 variant 보존. 긴 자막·이미지 로딩 실패·화면 경계 크기에서 겹침 없음. 코덱 색 변화와 UI 필터 문제를 구분해서 검수한다.

### T08. 렌더 시간 제한·취소·의존성 정비

**변경:** `backend/yali/media/render_client.py`, `backend/yali/jobs/processor.py`, `render-worker/src/{server.ts,renderer.ts,composition.ts}`, `render-worker/package.json` 및 lockfile, renderer/server tests.

**초기 계약:** 기존 백엔드 큐+동기 worker HTTP 구조를 유지한다. worker는 성공 완료 후 HTTP 200 `{status:"completed", output_path}`를 반환한다. 현재 ‘처리 완료 후 202 accepted’ 응답을 바로잡고 별도의 영속 큐를 추가하지 않는다.

- [ ] 45초짜리 fake renderer HTTP 시험으로 Python 기본 30초의 불일치를 재현한다. 시간만 길게 늘리기보다 렌더 예산과 정리 시간을 정의한다.
- [ ] worker 기본 600초일 때 client는 정리 여유를 포함해 660초 이상으로 설정한다. 상한/잘못된 입력 처리를 통일하고 모순된 환경 변수 조합은 진단 오류로 반환한다.
- [ ] 요청에 백엔드 job_id를 넣어 worker의 실행 건을 식별한다. 취소 endpoint는 백엔드에서만 사용하도록 보호하고 소유한 자식 프로세스 트리를 Windows에서도 종료한다. 이름만으로 모든 node/chrome을 종료하지 않는다.
- [ ] 시간 초과/연결 종료/취소 뒤 늦게 기록되는 임시 MP4를 정리한다. 기존 완성 파일은 실패해도 보존한다. 프로세스 종료를 확인한 뒤 임시 작업 공간을 해제한다.
- [ ] 현재 고정 HyperFrames를 로컬 의존성으로 잠그고 GSAP/글꼴/필요 브라우저를 패키징 때 확보한다. 렌더 도중 npx 다운로드/CDN 의존을 없애거나 온라인 필수로 분명하게 검사한다. 추가 포함물·용량·라이선스를 먼저 설명한다.
- [ ] health를 살아 있음과 렌더 준비 완료로 구분한다. CLI/browser/font/storage 진단을 추가하고 HTTP 200만으로 렌더 가능하다고 하지 않는다.
- [ ] 경로 경계/realpath/junction 방어를 유지하고 출력 경로의 reparse-point 우회도 시험한다. localhost만 수신하고 Host/Origin/입력 타입을 검증한다. CORS만 접근 통제로 취급하지 않는다.

**통과 조건:** 30초 초과 렌더 성공, 시간 초과 시 자식 트리 잔존 없음, 취소 후 기존 결과 불변, 동일 결과물의 동시 렌더 충돌 방지, 의존성 누락 진단. 실 MP4의 메타데이터와 재생까지 확인한다.

### T09. 출력 화면 연결: 먼저 무음 동영상 한 편 완성

**변경:** `frontend/src/app/{router.tsx,api.ts}`, `frontend/src/pages/ScriptPage.tsx`, `backend/yali/api/routes/outputs.py`, `backend/yali/domain/models.py`.

**신규:** `frontend/src/pages/OutputPage.tsx`, `frontend/src/features/output/`, `backend/tests/test_output_lifecycle.py`, `frontend/e2e-integration/output.spec.ts`.

**계약:** 기존 manifest/render/file API를 재사용한다. `GET /api/projects/{id}/output/variants`로 결과 이력·출처·상태·다운로드 URL을 제공한다. 작업 완료와 파일 검증 완료를 일치시킨다.

- [ ] 시안에 형식/해상도/fps/예상 길이/준비 진단/미리보기/출력 버튼/진행/결과 이력을 표시하고 승인받는다. T07 스타일을 다른 곳에서 다시 정의하지 않는다.
- [ ] 첫 구현은 쇼츠·릴스 1080×1920/30fps MP4·무음으로 명시한다. 음성이 없는데 내레이션까지 완료됐다고 표시하지 않는다.
- [ ] T01 검증이 ready일 때만 접수한다. job_id를 저장해 새로고침 후 같은 작업을 추적하고 중복 클릭은 같은 요청으로 취급한다.
- [ ] 완료 후 video 플레이어, 다운로드, 재생성, 이전 단계 수정을 제공한다. 출처가 변경된 과거 영상은 이전 버전으로 보존한다.
- [ ] 로컬 절대 경로 대신 file endpoint를 사용한다. 빈 파일/손상/소실/미완료를 다운로드 성공으로 처리하지 않는다. 프로젝트명·형식·버전을 안전한 파일명으로 만든다.
- [ ] 최종 파일 검증 뒤에만 completed를 설정한다. 실패하면 디자인/출력으로 복귀할 위치와 기존 결과물을 유지한다.
- [ ] 렌더 품질·길이·스타일·오디오를 바꾸면 결과 식별에 반영한다. 기존 variant ID가 같은 컷 버전만 보고 다른 결과를 덮어쓰지 않는지 검사한다.

**통과 조건:** 시험 provider로 7컷 준비→실 HyperFrames MP4→다운로드→해상도/길이/재생 확인. 기대 길이 오차는 1프레임 이내를 기준으로 한다. 별도 실 Codex 1컷 smoke를 기록하며 모의 검사만으로 전체 자동 제작 완료라고 말하지 않는다.

### T10. 음성·자막 타임라인

**재사용:** `Cut.audio_asset_id`, `ManifestCut.audio_asset_id`, composition의 renderAudio, 기존 SubtitleStyle.

**변경:** domain/manifest, worker composition, 디자인 상세 패널.

**신규:** `backend/yali/media/audio.py`, `backend/yali/api/routes/audio.py`, `frontend/src/features/audio/`, `backend/tests/test_audio_timeline.py`.

**계약:** `POST /api/projects/{id}/cuts/{cut_id}/audio`는 업로드 후 검증된 asset을 반환한다. narration.generate는 사용자가 TTS provider를 설정했을 때만 작업으로 접수한다. TTS 미설정 시 음성 파일 업로드 또는 무음을 선택한다. Codex 텍스트/이미지 지원에서 TTS 가능 여부를 추측하지 않는다.

- [ ] 음성 업로드→컷 연결→실제 길이 추출→미리보기와 MP4 재생부터 완료한다. TTS 제공자와 비용 선택은 이후 별도 승인 항목이다.
- [ ] 대본과 음성 asset의 출처 버전을 연결한다. 텍스트 변경 시 음성/자막이 오래됐다고 표시하고 자동으로 다시 읽지 않는다.
- [ ] 길이 부족/초과 시 자동 자르기·속도 왜곡 대신 음성에 맞춤/대본 축약/무음을 제시한다. 길이 변경은 새 스냅샷으로 저장해 이전 영상을 보존한다.
- [ ] 자막은 `{start_ms,end_ms,text}`로 저장하며 0<=start<end<=cut_duration, 순서와 중첩을 검증한다. 문장부호·긴 한글·한 글자 줄·이모지·여러 줄을 시험한다.
- [ ] BGM은 전체 트랙으로 추가해 볼륨/페이드를 저장한다. 내레이션과 분리하고 출력 피크와 소리 깨짐을 시험한다. 음악 출처와 이용 권한을 기록한다.

**통과 조건:** 음성 유/무/파일 소실, 컷 재생성 후 이전 음성 경고, 자막 경계 전환, 7컷 연결 시 누적 동기 오차 100ms 이내. 수치 검사와 사람의 청취 확인을 따로 기록한다.

### T11. 카드뉴스를 이미지 세트로 출력

**변경:** `backend/yali/domain/models.py`, `backend/yali/rendering/manifest.py`, `backend/yali/api/routes/outputs.py`, `backend/yali/jobs/processor.py`, worker renderer/types, OutputPage.

**신규:** `render-worker/src/card-renderer.ts`, `frontend/src/features/cards/`, `backend/tests/test_card_outputs.py`, `render-worker/src/card-renderer.test.ts`.

**계약:** output variant에 artifact_kind(video/image_set)와 files metadata를 추가한다. 기존 variant는 video로 읽는다. card_news는 순서 있는 PNG와 개별/ZIP 다운로드를 제공한다. 기존 video file 계약을 설명 없이 이미지 타입으로 바꾸지 않는다.

- [ ] 1080×1080 표지→본문→마무리의 페이지 편집 시안을 승인받는다. 처음에는 1컷=1페이지로 시작하고 표지/마지막 페이지를 명시적으로 추가한다.
- [ ] 같은 대본·이미지를 참조하되 페이지 순서/문장/강조/여백은 카드 variant에 저장한다. 영상 시간 정보를 페이지 수로 사용하지 않는다.
- [ ] 같은 HTML/CSS/글꼴의 정지 프레임 캡처를 우선한다. 지원되는 렌더 방법은 구현 시 설치된 CLI/help로 확인하며 다른 엔진 추가가 필요하면 이유를 제시한다.
- [ ] 01-cover.png, 02-page.png 등의 순서를 고정하고 ZIP에는 안전한 상대 파일명만 포함한다. 중간 실패는 완료로 표시하지 않고 이전 완성 세트를 보존한다.
- [ ] 전체 페이지와 선택 페이지 재생성을 구분한다. 이미지 생성과 문장/레이아웃 편집은 별도 조작이다.

**통과 조건:** 5/10페이지 PNG 실체, 1080×1080, 순서, ZIP 검사, 긴 글 overflow, 누락 페이지, 영상 variant 보존. 카드뉴스를 선택했는데 MP4만 반환하는 상태를 끝낸다.

### T12. Windows 숨김 실행·포터블 배포·자택 인계

**변경:** `scripts/{yali-launcher.py,start-yali.vbs,stop-yali.ps1,check-yali.ps1,build-yali-exe.ps1,package-yali-home.ps1}`, `backend/yali/api/routes/health.py`, `docs/portable-bundle.md`, `README.md`.

**신규:** `backend/tests/test_portable_package.py`, `scripts/verify-yali-bundle.ps1`.

**입출력:** ZIP에 소스 커밋/runtime 버전/포함 목록/hash/외부 전제의 manifest를 넣는다. verify 스크립트는 JSON 결과와 종료 코드를 반환한다. health에는 서비스 식별·build·비식별 데이터 경로 ID를 제공하고 비밀 경로는 노출하지 않는다.

- [ ] 더블클릭→해당 프로젝트 서비스 식별→준비 확인→브라우저 실행 순서로 만든다. 자기 인스턴스면 재사용하고 다른 앱이 같은 포트를 쓰면 종료시키지 말고 원인과 대처를 표시한다.
- [ ] 실제 PID/시작 시각/명령 식별자를 기록한다. 비동기 WshShell.Run 반환값을 PID로 사용하지 않는다. stop은 소유 프로세스만 종료한다.
- [ ] stdout/stderr를 버리지 말고 크기 상한이 있는 로컬 로그에 저장한다. 브라우저 실패는 서비스 성공과 분리해 결과/URL 복사 안내를 제공한다.
- [ ] 비대화식 /validate는 cscript 또는 런처 JSON 진단으로 완료한다. 검증 중 WScript 대화창 대기 때문에 멈추지 않아야 한다. CMD 비노출은 수동으로도 확인한다.
- [ ] 패키징은 전용 임시 staging을 만들고 정리 전에 절대 경로/배포 작업 폴더 하위 여부/reparse를 검사한다. 임의 OutputPath를 무조건 삭제하지 않는다. 같은 ZIP은 명시 덮어쓰기 또는 별도 버전명을 사용한다.
- [ ] exe/프론트/워커는 같은 소스에서 빌드한다. exe가 있다는 이유만으로 옛 실행 파일을 사용하지 않는다. Python/npm은 lock/고정 목록에서 깨끗한 staging에 설치해 회사 PC의 불필요한 환경을 그대로 옮기지 않는다.
- [ ] 가능하면 빌드된 정적 UI를 배포한다. Vite dev server를 교체할 경우 FastAPI의 SPA fallback과 /api 예약 경로를 설계하고 API 404가 HTML로 바뀌지 않게 시험한다. 새 서버 프레임워크는 필요하지 않다.
- [ ] 인증·.env·API 키·로그·.git를 제외한다. storage 동봉은 명시 모드로 두고 대상 프로젝트를 표시한다. 복사 중 JSON/작업 일관성은 스냅샷 또는 소유 서비스 정지로 보장한다.
- [ ] Python/Node/git/Codex 없음, 빈 npm 캐시, 한글·공백이 있는 임의 해제 경로에서 시험한다. Codex가 없어도 홈/기존 프로젝트는 열리고 AI 실행 전에 설치/로그인을 안내한다.
- [ ] AI 생성의 온라인 필요와 로컬 편집/기존 미디어 렌더의 오프라인 가능 여부를 구분한다. 동봉하지 않은 CLI/browser/font를 포함됐다고 쓰지 않는다.
- [ ] 집에서 소스를 수정하고 재빌드/재압축하는 절차도 검사한다. 현재 .venv/pyvenv.cfg 전제를 없애거나 집 PC의 개발 venv 생성 절차를 검증해 안내한다.

**통과 조건:** 새 해제 경로에서 시작, 프로젝트 복원, 설정 진단, 기존 이미지의 실 MP4/PNG 출력, 종료→재실행, exe 연타, 포트 충돌, 권한 거절, 디스크 부족을 확인한다. 회사 PC의 다른 폴더에서 해제한 것만으로 집 PC 검증 완료라고 하지 않는다.

### T13. 자료·브랜드·캐릭터·템플릿

**시작 조건:** T09/T11의 저장 기능 완료. 화면별 시안 승인 후 다음을 각각 별도 작업으로 진행한다.

1. **자료/미디어:** `backend/yali/api/routes/media.py`를 조회에서 업로드/검색/연결까지 확장한다. 기존 ideas/assets 업로드를 공통 미디어 서비스로 옮기고 실체/hash/metadata를 한곳에서 관리한다. `frontend/src/pages/MediaPage.tsx`를 추가한다. 파일 형식 위장·용량 상한·같은 이름·참조 중 삭제를 검사한다.
2. **브랜드:** BrandPreset(id,name,font,colors,subtitle_style,logo_asset_id)을 추가하고 적용 시 프로젝트에 스냅샷을 저장한다. 브랜드 수정으로 과거 결과물을 자동 변경하지 않는다. `frontend/src/features/brand/`와 백엔드 route/tests를 추가한다.
3. **캐릭터:** CharacterPreset(id,name,description,reference_asset_ids)을 만들고 지원 provider에만 참조 이미지를 전달한다. 기존 ImageGenerationRequest를 확장해 capabilities와 일치시킨다. 미지원 제공자에서는 텍스트만으로 인물 일관성을 보장하지 않는다. 실제 이미지 3컷을 사용자가 비교 검수한다.
4. **템플릿:** 버전이 있는 디자인/카드 preset을 저장·복제·선택한다. 임의 코드를 실행하는 형태 대신 허용된 layout/schema로 시작한다. 기존 프로젝트가 이전 템플릿을 계속 열 수 있는지 검사한다.

각 항목마다 API/unit/실 UI 검사와 백업 후 다음으로 넘어간다. 참고자료 폴더에서 가져오면 모듈명·채택 이유·라이선스·이식 시험을 `docs/verification/reference-reuse.md`에 기록한다.

### T14. 발행·예약·운영 기능은 마지막에 별도로 구현

**시작 조건:** 로컬 결과물을 반복해서 만들 수 있고 사용자가 SNS/계정/자동 공개 범위를 지정한 후. 사양을 모르는 외부 API를 추측해서 구현하지 않는다.

- [ ] 우선 결과물+제목/설명/해시태그 내보내기와 수동 게시 보조를 만든다. 생성 완료만으로 자동 공개하지 않는다.
- [ ] 플랫폼별 API 권한/로그인/이용 조건/재전송 방식을 공식 문서로 확인한다. 인증은 백업에서 제외한다.
- [ ] PublishJob에 승인, 예약 시각/시간대, 대상 계정, 고정 결과물 hash, 게시 ID, 재시도 키를 둔다. 대본 수정으로 예약된 결과물을 무단 교체하지 않는다.
- [ ] 재시도/PC 재시작으로 중복 게시하지 않는다. 공개 전 최종 미리보기/취소, 게시 후 결과와 실패 이력을 제공한다.
- [ ] 성과·DM·커뮤니티는 각각 별도 요구사항을 받는다. 이 계획을 근거로 연락처 수집/자동 발송을 시작하지 않는다.

**통과 조건:** mock connector로 예약/취소/재시작/중복 방지를 검사하고 실제 게시 검증은 사용자가 승인한 테스트 게시만 수행한다. 발행 완료를 제작 MVP 조건에 섞지 않는다.

## 7. 필수 QA 시나리오 목록

| 시험 ID | 입력/조작 | 기대 결과 | 검사층 |
|---|---|---|---|
| E01 | 빈 프로젝트의 단계/완료를 API로 지정 | 422/409, 저장 불변 | API |
| E02 | 대본 생성 중 원본 아이디어 수정 | 과거 결과 자동 활성화 없음, 재시도 이유 표시 | worker+UI |
| E03 | 대본 저장/버전 복원 후 컷·디자인 재방문 | 오래된 출처 경고, 기존 컷/이미지 보존 | 통합 |
| E04 | 같은 컷 연타, 다른 컷 동시 생성 | 중복 없음, 다른 컷은 정상 저장 | worker |
| E05 | 7컷 전체 생성 중 새로고침/프로젝트 전환 | 서버 계속 처리, 재방문 시 진행 복원 | 통합 |
| E06 | 1컷 실패 후 해당 컷만 재시도 | 성공 6컷 hash/버전 불변 | worker+UI |
| E07 | 잠금/취소/삭제와 생성 완료의 경합 | 잠금/취소/삭제 우선, 복구·덮어쓰기 없음 | worker+저장소 |
| E08 | CLI 없음/미로그인/이미지 미지원/시간 초과 | 원인별 안내, 가짜 이미지/무단 API 전환 없음 | stub+실연동 |
| E09 | 16:9 원본→9:16 목표, 크기 미상 | 명시적 배치 승인 또는 재생성 요청, 원본 불변 | API+시각 |
| E10 | 하단 자막/긴 문장/이모지/글꼴 미설치 | 넘침 없음, 대체 글꼴 안내, 미리보기/출력 일치 | 시각+렌더 |
| E11 | 출력 검증 실패 | variant/queue/project revision 불변 | API |
| E12 | 45초 렌더/시간 초과/취소/워커 정지 | 올바른 종료, 고아 프로세스/임시 파일 없음 | 워커 통합 |
| E13 | 영상 완료 후 원본 수정 | 이전 결과 보존·구버전 표시, 새 출력은 별도 | 통합 |
| E14 | 음성 유/무/BGM/컷 길이 수정 | 동기 오차 기준 이내, 이전 음성 경고 | 실렌더+청취 |
| E15 | 5/10페이지 출력, 한 페이지 실패 | 순서/크기/ZIP 정상, 실패 세트를 완료 표시하지 않음 | 실렌더 |
| E16 | 모든 메뉴/빠른 시작/선택기/이동 이력 | 정상 이동 또는 비활성 이유, 무반응 없음 | UI |
| E17 | 390~1920 폭, 경계 ±1px, OS 배율 | 겹침/잘림/전역 가로 스크롤 없음 | UI+수동 |
| E18 | 집 PC 상당 환경, CLI/Python/Node 없음 | 홈 실행, 부족 의존성 안내 | 새 Windows |
| E19 | 디스크 부족/권한/손상 JSON/인덱스 누락 | 원본 보존, 복구 가능 범위와 오류 설명 | 저장소 장애 주입 |
| E20 | 로그/ZIP/Git 비밀 fixture 혼입 검사 | API 키/auth token/password 없음 | 패키징/보안 |

시험 데이터는 3프로젝트, 정상 7컷, 부분 실패 7컷, 성능 확인용 40컷, 세로/가로/정사각/크기 미상/손상 이미지, 긴 한글, 빈 출처, 읽기 지연으로 구성한다. 전부 임시 시험 저장소에 만들고 실제 사용자 프로젝트를 fixture로 사용하지 않는다.

## 8. 단계별 검증 명령과 백업

먼저 해당 작업의 신규 시험만 실행해 수정 전 원하는 실패가 발생하는지 확인한다. 최소 수정 후 아래를 실행한다. 새로운 통합 시험 명령은 T00에서 README에 추가한다.

```powershell
# 저장소 루트 기준
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm.cmd --prefix frontend run unit
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run e2e
npm.cmd --prefix render-worker run unit
npm.cmd --prefix render-worker run lint
git diff --check
git status --short --untracked-files=all
```

이후 해당 작업에 필요한 실서비스/실렌더/실Codex/실PC 검사만 수행한다. 외부 생성은 사용량을 소비하므로 모든 자동 시험에서 매번 호출하지 않는다. fake 검사 수치를 실제 생성 성능으로 보고하지 않는다.

각 작업의 완료 기록 `docs/verification/Txx-YYYY-MM-DD.md`에는 다음을 남긴다.

```text
작업 ID / 기준 커밋 / 변경 파일
재현 조건과 근본 원인
구현한 계약과 아직 구현하지 않은 계약
실행 명령 / 통과·실패·생략 수 / 종료 코드
실제 API·렌더러·새 PC 사용 여부
UI 시안 승인 기록 / 실제 화면 크기 / 스크린샷
기존 프로젝트·이미지·버전 보존 증거
미확인 사항 / 다음 작업으로 진행 가능한지
백업 커밋 / 원격 반영 확인
```

커밋은 `fix: validate workflow readiness`처럼 변경에 맞는 단위로 관련 파일만 명시적으로 stage한다. `git add -A`를 무조건 사용하지 않는다. push 후 `git rev-parse HEAD`와 `git ls-remote origin refs/heads/main`을 비교한다. 다른 브랜치에서 작업했다면 해당 브랜치를 확인하고 승인 없이 main에 병합하지 않는다. push 실패는 ‘로컬 저장 완료/외부 백업 미완료’로 정확히 보고한다.

## 9. 제작 MVP 최종 수락 조건

다음을 충족했을 때만 제작 MVP 완료로 판정한다.

- [ ] 새 프로젝트에서 7컷 쇼츠/릴스를 만들고 원하는 1컷만 실제 이미지 재생성해 나머지를 보존한 채 MP4를 저장한다.
- [ ] 음성·자막 사용 모드는 미리보기와 결과가 일치하고, 미사용 모드는 무음/자막 없음을 명시한다.
- [ ] 같은 출처로 카드뉴스를 선택해 PNG 개별/ZIP 일괄 저장한다.
- [ ] 실패/취소/새로고침/재시작으로 이전 결과가 소실되지 않고 실제 이어서 작업할 수 있다.
- [ ] 원본 비율/색상을 유지하며 부적절한 출력 배치는 검증 또는 명시적 승인으로 처리한다.
- [ ] 구현한 메뉴는 동작하고 미구현 메뉴는 이유를 설명한다. 다음 단계 진입 불가 시 원인과 복귀 경로가 있다.
- [ ] 새 Windows에서 ZIP을 해제해 CMD 없이 실행하고 의존성/로그인 부족을 이해할 수 있다.
- [ ] 단위/API/UI 모의/실제 통합/실Codex/실렌더/새 PC 검증의 증거를 구분해 보관한다.
- [ ] 관련 코드/시험/문서를 지정 GitHub에 백업하고 비밀 및 실제 storage가 의도 없이 들어가지 않는다.

## 10. 다음 구현 담당자에게 전달할 지시문

> 이 구현지시서와 QA 기준선을 읽고 우선 T00만 구현한다. 현재 브랜치/변경/추적 파일/시험 명령을 확인한다. 전체 앱을 다시 만들지 말고 기존 fixture·ProjectStore·JobRunner·API 계약을 재사용한다. 신규 시험 파일의 ignore와 시험 0개 성공 설정을 바로잡고 기존 검사를 자동 실행하게 한다. 이후 별도 작업으로 T01의 재현된 세 문제를 실패 시험부터 수정한다. UI 변경은 먼저 시안을 승인받는다. 각 단계의 실검사·결과 기록·GitHub 백업을 끝낸 뒤 다음으로 넘어가며, 검증하지 않은 실이미지/렌더/집 PC 실행을 성공으로 보고하지 않는다.

**처음 진행할 내용:** 새 메뉴 추가가 아니라 T00의 검증 기반과 T01의 단계 진입 조건이다. 다음으로 T03/T04에서 페이지를 닫아도 사라지지 않는 이미지 생성 흐름을 고정한다. 이 순서로 기본 동작을 신뢰할 수 있게 만든 뒤 실제 완성 파일까지 연결한다.

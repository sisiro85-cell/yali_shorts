# 얄리 숏폼 스튜디오 — 인스타툰·카드뉴스·상품 쇼츠 기능구현 설계서

> 상태: **검토용 설계안**. 아래 신규 모델·API·화면은 구현 목표이며 현재 구현 완료를 뜻하지 않는다. 이번 요청은 폴더 분석과 문서 작성이다. 애플리케이션 코드, 사용자 프로젝트 데이터, 실행 설정은 변경하지 않았다.
>
> **For agentic workers:** 승인된 구현은 ForgeGate의 현재 중앙 Governor와 이 프로젝트의 실제 검사 기준을 우선 적용한다. 여러 의존 Task는 Project Orchestrator, 작은 수정은 단일 Task loop를 사용한다. `superpowers:executing-plans`의 작업 분해 방식을 참고하되 별도 실행 흐름을 중복 시작하지 않는다. 체크박스는 실제 증거가 생겼을 때만 완료한다.

**Goal:** 하나의 제작 자료에서 인스타툰, 정보형 카드뉴스, 상품 소개 콘텐츠를 기획하고, 컷·페이지별로 검수·수정하여 영상 MP4 또는 캐러셀 PNG 세트를 저장하는 개인용 로컬 제작 프로그램을 완성한다.

**Architecture:** 기존 React/Vite + FastAPI + JSON ProjectStore/PersistentJobQueue + Codex MCP + HyperFrames worker를 유지한다. 콘텐츠의 의미 구조, 편집 가능한 화면 구성, 최종 출력 스냅샷을 분리하고 현재 모듈에 순차 연결한다.

**Tech Stack:** 현재 lockfile의 Python/FastAPI/Pydantic, React/TypeScript, Vitest/Playwright, Node render-worker를 기준으로 한다. 현재 코드의 `hyperframes@0.8.26`, GSAP `3.14.2`는 조사한 고정값이지 최신 버전 권고가 아니다.

**Spec:** 현재 사용자 요청, [기존 QA 구현지시서](2026-09-05-qa-implementation.md), [음성·자막 설계](2026-09-05-video-settings-design.md), [Codex 이미지 연동 명세](../specs/codex-image2-integration.md), [README](../../README.md).

**조사 기준:** 2026-09-11 / `C:\프로그램\쇼츠자동화` / branch `main` / commit `478b14dce648d438731b0340eaa195de5cb98376`. 시작 시 working tree는 깨끗했다. 다른 프로젝트에 해당한다고 사용자가 정정한 블로그 분석은 본 설계의 요구사항에 포함하지 않았다.

## 1. 권장 제품 구조

핵심은 **콘텐츠 유형과 출력 형식을 따로 선택하는 것**이다. 지금의 `shorts/reels/card_news` 목록에 `instatoon/product_shorts`를 계속 추가하면, 내용과 화면 비율과 파일 형식이 뒤섞인다.

| 구분 | 선택지 | 결정하는 것 |
|---|---|---|
| 콘텐츠 유형 `content_kind` | `general`, `instatoon`, `information`, `product` | 질문 항목, 대본 구조, 참조 자료, 캐릭터·상품 규칙 |
| 매체 `medium` | `video`, `carousel` | 타임라인·음성 사용 또는 페이지 순서·PNG 세트 |
| 출력 프로필 `profile_id` | `video_9_16`, `carousel_1_1`, `carousel_4_5` | 캔버스 크기, 안전 영역, 템플릿 배치 |
| 게시 대상 힌트 `platform_hint` | `youtube_shorts`, `instagram_reels`, `instagram_carousel`, `none` | 파일 묶음 이름과 게시용 문구 안내; 자동 게시와 분리 |

예: `instatoon + carousel + carousel_4_5`, `instatoon + video + video_9_16`, `product + video + video_9_16`, `information + carousel + carousel_1_1`.

1080×1920, 1080×1080, 1080×1350은 앱이 제공할 제작 프리셋이다. 플랫폼의 현재 최대 길이·장수·지원 비율을 보장하는 수치로 취급하지 않는다. 자동 게시 개발 때 공식 플랫폼 문서로 제한을 별도 검증한다.

### 대안 비교

| 방식 | 장점 | 문제 / 결정 |
|---|---|---|
| 콘텐츠 유형별로 독립 프로그램·편집기를 만든다 | 초기 분기가 단순하다 | 생성·음성·출력·버전 코드가 중복됨. 채택하지 않음 |
| 현재 범용 화면에 프롬프트 선택지만 추가한다 | 빠르게 외형을 늘릴 수 있다 | 말풍선·페이지·상품 보존·형식별 편집을 표현하지 못함 |
| **공통 제작 기반 + 콘텐츠별 입력·템플릿 + 형식별 출력** | 기존 기능을 재사용하며 필요한 차이를 구현할 수 있다 | 모델 이행이 필요하지만 범위를 나눌 수 있음. 권장 |

첫 제품 범위는 로컬 파일 완성까지다. SNS 자동 발행·예약·성과·DM·커뮤니티는 별도 확장으로 둔다. 범용 영상 편집기 전체, 다중 사용자 협업, 클라우드 저장소, 새 데스크톱 프레임워크도 초기 범위에 넣지 않는다.

## 2. 현재 폴더 분석

### 2.1 유지할 구조

```text
frontend/src
  app/                 API 타입·클라이언트·라우팅
  pages/               홈·아이디어·대본/컷/디자인·영상 설정
  features/            기존 폼·컷 보드·이미지 보드
  components/layout/   승인된 앱 셸·사이드바·상단 단계
backend/yali
  domain/              Project·Scene·Cut·CutVersion·영상 설정
  content/             구조화 대본·컷 계획 생성
  ai/                  텍스트 gateway·Codex MCP·이미지·Edge TTS
  jobs/                영속 큐·4 worker 실행·결과 처리
  storage/             파일 잠금·원자적 JSON 저장·버전 충돌 검사
  rendering/           출력 manifest
render-worker/src      HTML/GSAP 구성·HyperFrames 실행·로컬 HTTP 서버
scripts/               숨김 실행·상태 확인·종료·EXE/포터블 패키징
docs/                  기획·QA·라이선스·이전 검증 이력
storage/               사용자 데이터; 설계 조사에서 변경하지 않음
```

### 2.2 코드에서 확인한 구현과 공백

아래 ‘있음’은 소스 연결을 확인했다는 뜻이다. 실 Codex·실 TTS·실 영상 생성까지 이번에 다시 검증했다는 뜻이 아니다.

| 영역 | 현재 확인 | 다음에 필요한 것 | 주요 근거 파일 |
|---|---|---|---|
| 프로젝트 | 생성·목록·삭제·이어가기·단계 경로 있음 | 콘텐츠 유형, 출력 대상별 상태, 서버 준비 조건 | `domain/models.py`, `api/routes/projects.py`, `frontend/src/app/navigation.ts` |
| 아이디어·대본 | 입력·참고자료 등록·버전·생성 있음 | 유형별 brief와 검증 가능한 응답, 자료 내용 추출 | `content/models.py`, `content/service.py`, `ai/gateway.py` |
| 컷 | 씬·컷, 잠금, 버전 선택, 재생성 있음 | 추가·삭제·순서 이동, 매체별 페이지 연결, 부분 수정 | `api/routes/cuts.py`, `features/cuts/` |
| 이미지 | 실제 PNG provider, 개별/전체 요청, 비율 검사 있음 | 서버 batch, 참조 이미지·마스크·세션 결과 식별, 타깃별 이미지 | `ai/protocols.py`, `ai/providers/codex_image.py`, `jobs/processor.py` |
| 병렬 작업 | `JobRunner(max_workers=4)`, 파일 큐 있음 | 이미지/TTS/렌더 자원 분리, batch 재진입·재시도 | `jobs/runner.py`, `jobs/queue.py` |
| 디자인 | 컷 이미지 카드·프롬프트·재생성 UI 있음 | 글상자·말풍선·상품 오버레이·페이지 템플릿 | `features/design/DesignBoard.tsx` |
| 음성·자막 | 프로젝트 기본값·컷 예외·한글 글꼴·설정 저장 있음 | TTS 버튼 활성 연결·오디오 업로드·실측 길이·자막 cue | `pages/VideoSettingsPage.tsx`, `api/routes/tts.py`, `domain/video_settings.py` |
| 출력 | manifest·렌더 요청·MP4 다운로드 API 있음 | 실제 출력 화면·사전검증·렌더 상태·캐러셀 파일 묶음 | `api/routes/outputs.py`, `rendering/manifest.py` |
| 영상 엔진 | HyperFrames HTML 구성·미디어·음성 태그·모션 있음 | 설정 해석 일치·취소·timeout·최종 파일 검사 | `render-worker/src/composition.ts`, `renderer.ts`, `server.ts` |
| 라이브러리·운영 메뉴 | 상당수가 `#자료` 같은 링크 | 실제 화면 연결 또는 준비 중 표시 | `components/layout/Sidebar.tsx` |
| QA | backend/unit/mock E2E/별도 API 통합 설정·CI 있음 | 실출력·새 PC·유형별 완주 시나리오 | `backend/tests`, `frontend/e2e*`, `.github/workflows/qa.yml` |

표의 백엔드 상대 경로는 `backend/yali/`, 프론트 feature 경로는 `frontend/src/`를 기준으로 한다.

### 2.3 이번 설계에서 우선 처리할 실제 연결 문제

1. `ScriptPage.tsx`의 출력 분기는 여전히 `StagePlaceholder`다. 출력 API 존재와 사용자가 파일을 만들 수 있는 상태는 다르다.
2. `VideoSettingsPage.tsx`의 ‘선택 컷 음성 미리듣기’ 버튼은 상시 `disabled`다. `upload` 옵션은 보이지만 현재 TTS 라우트는 연결된 provider 이름과 다르면 거부한다.
3. `composition.ts`는 자막 문자열·오디오 asset 존재로 출력 태그를 만들며, 저장된 `subtitle.enabled`, `audio.enabled`, 자막 정렬·최대 줄 수를 완전히 해석하지 않는다. 현재 미리보기의 글자 크기도 `font_size / 3.5`와 clamp를 사용해 캔버스 축소 비율과 다를 수 있다.
4. `card_news`는 1080×1080 설정이 있지만 렌더 클라이언트·job 경로·다운로드 MIME은 MP4다. PNG 페이지/ZIP 출력은 없다.
5. `ImageGenerationRequest`에는 prompt/model/metadata/aspect ratio만 있다. 캐릭터·상품 참조 이미지 전달과 편집 모드는 정의되어 있지 않다. 업로드한 자료의 ID가 있다는 사실만으로 모델이 이미지 내용을 봤다고 판단하면 안 된다.
6. `media/aspect.py`는 카드뉴스만 선택하면 1:1, 혼합 선택이면 9:16이다. 한 컷 보드에 여러 출력 형식이 섞이면 목표 이미지가 충돌한다.
7. 전체 이미지 접수는 프론트 `Promise.all`과 로컬 진행 상태로 관리한다. backend에서 이미 접수한 job은 남지만 전체 batch의 소유권·부분 접수·재방문 복구는 별도 계약이 필요하다.
8. `content/service.py`의 `DeterministicContentService`는 provider/파싱 실패에 로컬 대본·컷 계획을 반환한다. AI 성공과 로컬 초안 생성의 출처를 구분해야 한다. `GatewayFactory`는 API 설정이 있으면 Codex 실패 시 fallback provider를 구성한다.
9. `RenderWorkerClient` 기본 timeout은 30초인데 worker는 렌더가 끝나야 응답하고 기본 제한시간은 10분이다. 출력 연결 전에 계약을 맞춰야 한다.
10. `_prepare_manifest()`가 variant를 저장한 뒤 `/render`에서 source 검사를 수행한다. 검증 실패가 프로젝트 변경을 남기는 경로를 먼저 수정·시험해야 한다.
11. 일반 프로젝트 PATCH는 단계 enum을 저장하지만 결과 준비 조건을 검사하지 않는다. `CutBoard`의 `3 / 5` 같은 고정 표기와 실제 6단계도 일치시켜야 한다.
12. 렌더 HTML은 GSAP CDN을, 실행은 `npx --yes hyperframes@0.8.26`을 사용한다. 현재 ZIP만으로 오프라인 렌더 가능하다고 보장할 수 없다.

이 항목들은 코드 조사에 근거한 현 상태다. 기존 QA 문서의 Q 번호 전체를 현재 미해결로 복사하지 않는다. 예를 들어 테스트 추적/CI와 컷별 병렬 저장 관련 수정은 이미 존재한다.

## 3. 사용자별 제작 흐름

### 3.1 공통 시작

`새 프로젝트 → 콘텐츠 유형 → 영상/캐러셀 → 제목·대상 독자·목적·자료 → 기획 초안`

처음에는 출력 대상 하나를 편집한다. 두 형식을 원하면 첫 편집본을 만든 뒤 ‘다른 형식으로 만들기’로 파생 대상을 추가한다. 서로 다른 비율을 한 컷의 단일 이미지 슬롯에 덮어쓰지 않는다.

### 3.2 콘텐츠별 차이

| 유형 | 입력 | AI가 만드는 초안 | 사용자가 반드시 수정할 수 있는 것 | 기본 템플릿 |
|---|---|---|---|---|
| 인스타툰 | 사연, 장르, 대사형/내레이션형, 등장인물, 그림체 | 도입·상황·갈등·전환·마무리, 컷별 인물·표정·대사 | 말풍선, 화자, 표정·의상 기준, 컷/패널 순서 | 한 컷 한 장, 상단 내레이션, 2분할 패널 |
| 정보형 카드뉴스 | 주제, 원문, 독자, 핵심 정보, 출처 | 표지·문제·핵심 항목·요약·행동 안내 | 페이지별 제목/본문/강조/출처, 순서, 표/비교 표현 | 표지, 핵심 한 가지, 목록, 좌우 비교, 마무리 |
| 상품 콘텐츠 | 상품명·원본 사진·확인한 특징·대상 고객·CTA | 관심 유도·사용 상황·특징 설명·선택 기준·CTA | 실물 사진, 근거 있는 제품 문구, 로고·가격 표시 여부 | 상품 히어로, 특징 3개, 디테일, 선택 가이드 |
| 일반 숏폼 | 주제·대본·이미지/영상 | 도입·전개·마무리, 컷 계획 | 내레이션·자막·컷 길이·미디어 | 이미지+자막, 이미지+키워드 |

상품 링크 분석은 추가 옵션으로 설계한다. 첫 상품 MVP는 사진 업로드와 수동 상품 정보 입력만으로 완주해야 한다. 링크 접근 실패 때문에 전체 제작이 막히면 안 된다. 리뷰·사용 효과·가격을 모델이 지어내지 않도록 확인한 사실과 제안 문구를 구분한다.

### 3.3 상단 단계

```text
영상:    기획 → 대본 → 컷 구성 → 디자인 → 음성·자막 → 출력
캐러셀:  기획 → 문안 → 페이지 구성 → 디자인 → 출력
```

현재 저장된 `/idea`, `/script`, `/cuts`, `/design`, `/video-settings`, `/output` 경로는 유지한다. 캐러셀에서도 초기에는 동일한 script/cuts 내부 경로를 쓰고 사용자 표시명을 문안/페이지 구성으로 바꾼다. 단계 수·이동 가능 조건은 공통 workflow 응답에서 계산한다. 캐러셀에서는 TTS 설정을 통과 조건으로 요구하지 않는다.

## 4. 기능 상세 요구사항

### 4.1 기획·문안·컷 구성

- `ContentBrief`에 목표, 독자, 톤, 핵심 메시지, 금지 표현, 예상 길이 또는 페이지 수, CTA, 참조 자료 ID를 저장한다.
- 초안 생성과 확정 상태를 구분한다. 수정은 새 버전으로 저장하고 downstream의 출처를 표시한다.
- AI 응답은 콘텐츠 유형별 schema로 검증한다. 정보형은 페이지 메시지, 인스타툰은 등장인물·대사, 상품형은 사용한 사실 ID를 포함한다.
- 대본과 컷 생성도 영속 job으로 접수한다. 재방문 시 진행을 조회하고 오래된 입력의 결과가 최신 원고를 자동 교체하지 않게 한다.
- 컷/페이지의 추가·복제·삭제·순서 이동을 제공한다. 삭제는 편집 revision에서 제외하는 방식으로 이전 버전에서 복원 가능하게 한다.
- 전체 다시 구성 전에 유지할 잠금 컷과 변경되는 대상 목록을 보여준다. 이미지·음성·수정 문안을 경고 없이 초기화하지 않는다.
- 컷 제목, 이미지 프롬프트, 대사, 내레이션, 화면 문구를 별도 필드로 둔다. 현재 `subtitle` 한 필드에 카드 본문과 말풍선을 모두 넣지 않는다.

### 4.2 디자인 보드와 확대 편집

- 보드는 썸네일 그리드로 유지한다. 카드에는 번호·짧은 제목·상태·생성/재생성·잠금만 우선 노출하고 긴 프롬프트는 상세 편집에서 연다.
- 카드 번호는 전체 표시 순서로 계산한다. 내부 `scene.order/cut.order`는 유지하되 여러 카드가 모두 ‘컷 1’로 보이지 않게 한다.
- 상단에 ‘미생성 전체 생성’, ‘실패만 재시도’, 선택 개수·진행률을 둔다. ‘전체 재생성’은 별도 명확한 동작으로 표시한다.
- 클릭하면 큰 캔버스와 우측 속성 패널로 편집한다. 원본 보기/출력 보기, 확대/축소/맞춤, 이전·다음 컷 이동을 제공한다.
- 텍스트·이미지·말풍선 위치·크기·정렬·겹침 순서를 수정한다. MVP는 템플릿과 제한된 편집을 우선하고 무제한 벡터 편집기는 만들지 않는다.
- 현재 승인된 뉴트럴 UI와 원본 미디어 색상을 유지한다. 원본에 grayscale, 자동 cover, 임의 stretch를 적용하지 않는다.
- 390/768/1024/1280/1440/1920px 및 실제 breakpoint ±1px에서 버튼·패널·그리드가 겹치지 않아야 한다. 작은 화면에서는 상세 패널을 아래로 배치하고 보드 열 수를 줄인다.
- 새 레이아웃은 시안으로 검수받은 뒤 구현한다. 이 문서의 구조 설명은 UI 시안 승인 기록이 아니다.

### 4.3 인스타툰 전용

- 캐릭터는 이름, 외형 특징, 기준 이미지, 의상, 대표 표정, 말투를 가진 버전 자산이다.
- 처음에 캐릭터 기준 이미지를 검수한 후 컷 생성에 동일한 기준 이미지와 style snapshot을 전달한다. 컷마다 새로운 인물을 만드는 prompt만 반복하지 않는다.
- 캐릭터 ID로 화자를 연결한다. 말풍선 텍스트와 꼬리 방향·표정 지시는 편집 가능한 데이터로 저장한다.
- 그림 생성에는 대사 글자를 굽지 않는 방식을 기본으로 한다. 한국어 대사는 프로그램에서 조판해 오탈자와 길이 수정 시 이미지를 재생성하지 않게 한다.
- 컷 단독 재생성은 다른 컷·캐릭터 기준·대사를 유지한다. 캐릭터 기준 변경 시 기존 결과를 자동 교체하지 않고 영향받는 컷을 표시한다.
- 일관성은 완전 보장 기능으로 홍보하지 않는다. 대표 컷 → 나머지 컷 생성 → 인물/의상/그림체 비교 검수 순서를 제공한다.
- 1페이지 1패널을 기본으로 하고 2패널·4패널은 템플릿으로 제공한다. 페이지와 영상 컷을 동일한 객체로 강제하지 않는다.

### 4.4 카드뉴스·캐러셀 전용

- 표지, 본문, 비교, 요약, CTA 등 역할을 가진 페이지를 만들고 한 페이지의 핵심 메시지를 명확하게 분리한다.
- 같은 캐러셀의 페이지는 하나의 출력 크기를 공유한다. 중간 한 장만 비율이 달라지는 것은 검증 오류다.
- 1:1과 4:5를 지원할 때 프롬프트·검증·캔버스·내보내기까지 함께 확장한다. 화면 옵션만 추가하지 않는다.
- 제목·본문·출처·페이지 번호·브랜드 표시는 각각 별도 레이어로 편집한다.
- 긴 문장은 자동 축소의 최소 크기에서 멈추고 분할 또는 문안 축약을 제안한다. `overflow:hidden`으로 글자를 잘라놓고 정상이라고 처리하지 않는다.
- PNG 개별 저장, 순서 있는 ZIP, 표지 PNG, 게시용 문구 TXT를 제공한다. JPEG는 품질 검증 후 선택 포맷으로 추가한다.
- 기본 페이지 수 제안은 5~10장, 첫 편집기 시험 상한은 20장으로 둔다. 플랫폼 최대 허용 장수라는 뜻은 아니다.

### 4.5 상품 콘텐츠 전용

- 실물 자산에 `role=product`와 보존 속성(형태·색상·상표·패키지 문구)을 둔다. 원본 사진을 그대로 배치하는 모드를 기본값으로 제공한다.
- 배경 합성과 이미지 전체 재생성을 분리한다. 배경만 생성할 때 제품 영역을 교체하지 않도록 foreground 자산을 따로 합성한다.
- 참조 기반 생성이 가능한 provider에서만 제품 참조를 전달한다. 지원하지 않으면 업로드 원본 배치 모드로 진행하며 조용히 다른 제품을 그리지 않는다.
- 상품 정보는 값·출처·확인 상태를 가진 사실 목록으로 보관한다. 대본의 판매 문구에 사용한 사실 ID를 연결해 수정 위치를 찾을 수 있게 한다.
- 가격·할인·옵션은 선택 입력이며 값과 기준일이 있을 때만 사용한다. 실제 사용하지 않은 후기와 입증되지 않은 효과는 자동 생성 승인 대상에서 제외한다.
- 특정 쇼핑몰 자동 수집은 이 설계의 구현 확정 범위가 아니다. 공개 페이지 수집을 추가할 때 접속 제한, 이미지 이용 범위, 리다이렉트·내부 주소 접근 방지와 수동 입력 대체 경로를 함께 설계한다.

### 4.6 음성·자막·모션

- 기존 프로젝트 기본값 + 컷별 sparse override를 유지한다. 화면의 provider 목록은 실제 연결 가능 상태와 일치시킨다.
- 선택 컷 미리듣기, 전체 음성 생성, 실패만 재시도, 음성 파일 직접 연결을 제공한다.
- 미리듣기 job은 임시 미리듣기 asset을 반환하고 활성 출력 음성을 자동 교체하지 않도록 분리한다. ‘이 음성 사용’ 또는 정식 생성 완료 시 연결한다.
- Edge TTS의 오디오 외 boundary/cue 정보를 보존할 수 있는지 adapter 시험으로 확인한다. 현재는 audio chunk만 수집한다.
- 음성 파일은 실제 길이를 측정한다. 기본 컷 길이는 `max(사용자 최소 길이, 음성 길이 + 끝 여백 200ms)`로 계산한다. 고정 길이를 선택했다면 음성 잘림 대신 충돌을 표시한다.
- 자막 cue는 컷 기준 `start_ms/end_ms/text`로 저장한다. 정확한 타이밍이 없는 경우 추정이라는 상태를 표시하고 수동 편집을 허용한다.
- 자막 사용 여부·글꼴·색상·크기·외곽선·정렬·위치·줄 수가 미리보기와 출력에서 동일하게 해석되어야 한다. 글꼴 로딩 완료 전에 캡처하지 않는다.
- TTS 합성 단계에서 속도/볼륨을 적용한 파일에 렌더러가 같은 값을 다시 적용하지 않도록 `baked_processing`을 기록한다. 업로드 오디오는 렌더 gain을 한 번만 적용한다.
- 초기 모션은 static, slow_zoom, pan_left/right, fade를 제한된 설정으로 제공한다. BGM은 파일 선택·볼륨·페이드부터 연결하고 자동 덕킹은 이후 확장한다.

## 5. 데이터와 상태 설계

### 5.1 기존 데이터 보존

`Project`, `Scene`, `Cut`, `CutVersion`, `MediaAsset`, `OutputVariant`를 폐기하지 않는다. Project schema version을 추가하고 단계적으로 확장한다. 첫 읽기에서는 변환된 view를 만들고, 실제 저장 전 원본 백업·검증·원자적 교체를 수행한다. 디렉터리 일괄 변환은 하지 않는다.

| 기존 데이터 | 이행 값 |
|---|---|
| 콘텐츠 유형 없음 | `content_kind=general`, 사용자가 이후 명시적으로 변경 |
| `shorts` | `medium=video`, `profile_id=video_9_16`, `platform_hint=youtube_shorts` |
| `reels` | `medium=video`, `profile_id=video_9_16`, `platform_hint=instagram_reels` |
| `card_news` | `medium=carousel`, `profile_id=carousel_1_1` |
| 혼합 formats | 선택 순서대로 별도 target 생성, 기존 이미지·출력은 보존, 크기 불일치는 타깃별 미검수 표시 |
| 기존 MP4 `card_news` 출력 | legacy 동영상 이력으로 유지; PNG 세트 성공으로 재분류하지 않음 |

### 5.2 추가할 모델과 책임

| 제안 모델 | 핵심 필드 | 책임 |
|---|---|---|
| `ContentBrief` | content_kind, audience, goal, tone, key_message, cta, references, type_specific | 기획 입력과 콘텐츠별 규칙 |
| `ProductionTarget` | id, medium, profile_id, platform_hint, source_script_version_id, content_revision, last_visited_stage, cut_bindings, compositions | 하나의 비율·매체에 대한 편집본 |
| target 내부 `CutBinding` | source_cut_id, source_cut_version_id, text/narration snapshot, media/audio asset IDs, duration_ms, settings, input hashes | 원래 컷의 출처를 유지하면서 형식별 편집·생성 결과를 독립 보관 |
| `CompositionPage` | id, order, role, source_cut_ids, layers, duration_ms?, revision | 영상 장면 또는 캐러셀 한 페이지의 배치 |
| `CanvasLayer` | id, type, x, y, width, height, z_index, rotation, locked, payload | image/text/bubble/shape로 제한한 편집 요소 |
| `AssetPlacement` | asset_id, fit, crop?, background, preserve_original | 원본 파일과 화면 배치의 분리 |
| `CharacterProfile` | id, version, name, traits, reference_asset_ids, outfit, style | 인스타툰 기준 인물 |
| `ProductProfile` | id, version, name, source_url?, product_asset_ids, facts, protected_features | 상품 원본과 사실 근거 |
| `GenerationBatch` | id, project_id, target_id, operation, item snapshots, job_ids, counts | 전체 생성의 영속 접수·진행·부분 재시도 |
| `SubtitleCue` | id, target_id, cut_id, start_ms, end_ms, text, timing_source | 시간 정보와 화면 조판 분리 |
| 확장 `MediaAsset` | role, provenance, duration_ms?, source_hash, generation_input_hash? | 캐릭터·상품·생성 이미지·오디오의 출처 |
| 확장 `OutputVariant` | target_id, manifest_hash, source_revision, state, files[], created_at | MP4 또는 PNG 세트의 불변 출력 이력 |

배치 좌표는 출력 캔버스의 논리 px로 저장한다. 화면 미리보기에서는 캔버스 전체를 `표시 폭 / 출력 폭` 비율로 축소한다. 글자·외곽선·안전 영역에도 같은 비율을 적용하고 개별 font-size clamp는 제거한다.

`CutBinding`은 별도 전역 저장소가 아니라 target JSON 내부의 작은 자료형이다. 파생 target은 source ID만 따라가는 live view가 아니라 문안·길이·활성 자산·설정의 스냅샷을 가진다. 이후 이미지/TTS job은 `(project_id, target_id, cut_id)`와 해당 입력 hash로 결과를 적용한다. 기존 `Cut.media_asset_id/audio_asset_id`는 기본 target용 호환 경로로만 사용하며, 여러 target의 활성 결과를 동시에 저장하는 공용 슬롯으로 쓰지 않는다.

레이어 payload는 type별 검증 모델로 제한한다. 사용자 HTML/JS를 저장하고 실행하는 템플릿 방식은 쓰지 않는다. shape/bubble의 결정적 SVG 조판은 허용하지만 이를 AI 이미지 생성 성공으로 표시하지 않는다.

### 5.3 최소 JSON 계약 예시

아래는 신규 계약의 구조 예시이며 기존 API 응답이 아니다. UUID·자산 참조는 실제 프로젝트 안에서 존재 검사를 한다.

```json
{
  "content_kind": "instatoon",
  "target": {
    "medium": "carousel",
    "profile_id": "carousel_4_5",
    "platform_hint": "instagram_carousel"
  },
  "canvas": {"width": 1080, "height": 1350},
  "page": {
    "order": 1,
    "role": "cover",
    "layers": [
      {"id": "title", "type": "text", "x": 72, "y": 80,
       "width": 936, "height": 180, "z_index": 2, "rotation": 0,
       "locked": false, "payload": {"text": "퇴근 5분 전 생긴 일", "font_family": "Pretendard", "font_size": 64}},
      {"id": "bubble", "type": "bubble", "x": 100, "y": 850,
       "width": 720, "height": 200, "z_index": 3, "rotation": 0,
       "locked": false, "payload": {"text": "이것만 확인하고 갈까요?", "tail": "bottom-left"}}
    ]
  }
}
```

### 5.4 버전·무효화 규칙

- 활성 이미지/음성은 성공한 자산이다. 생성 중·실패·취소는 기존 활성 자산과 별도로 표시한다.
- `CutVersion`에 함께 섞인 visual/audio 변경을 처리할 때 이미지 입력 hash와 음성 입력 hash를 각각 비교한다. 같은 컷의 이미지와 TTS가 끝나도 서로의 자산을 덮지 않게 최신 컷에 해당 필드만 병합한다.
- 이미지 입력 hash = prompt + 참조 자산 hash + 인물/상품/style version + 목표 비율 + provider/model + 편집 mode.
- 음성 입력 hash = narration + provider/voice/language + 합성 속도·피치·볼륨. 자막 색상 변경은 음성 재생성 이유가 아니다.
- 출력 hash = target content_revision + 페이지 순서·길이·레이어 + 활성 media/audio hash + subtitle cues/settings + template/font/renderer version. 현재 cut version ID 목록만으로는 부족하다. 마지막 방문 단계·프로젝트 이름 변경은 content_revision을 올리지 않는다.
- 새 대본 확정 시 기존 컷/출력은 남기고 ‘이전 대본 기준’으로 표시한다. 새 결과 자동 적용 여부는 해당 입력 snapshot 일치로 결정한다.
- 프로젝트 stage는 마지막 방문 정보로 호환 유지한다. 실제 준비 상태·완료 여부는 target별로 계산한다. 하나의 캐러셀 완료가 아직 미완성인 영상까지 완료로 만들지 않는다.
- 프로젝트명 변경처럼 출력과 무관한 변경 때문에 완성된 렌더 파일을 버리지 않는다. 반대로 문구·길이·자산 변경은 새 출력 variant를 만든다.

## 6. 서비스와 API 계약

### 6.1 역할 경계

```text
React 입력·편집·표시
       ↓ 검증된 요청
FastAPI workflow / content / assets / jobs / output
       ↓                          ↓
ProjectStore + 파일 잠금       PersistentJobQueue
                                  ↓
                  Codex MCP / API / TTS / render-worker
                                  ↓
                 검증된 자산·출력 → 버전 연결 → UI 상태 조회
```

브라우저가 닫혀도 접수한 작업은 유지된다. 전체 batch와 반복 호출 목록을 브라우저 메모리에만 두지 않는다. JSON 저장소는 단일 로컬 서비스 범위에서 유지하며 DB 전환은 측정된 필요가 생겼을 때 별도 결정한다.

### 6.2 기존 API 재사용

- 프로젝트, 아이디어, 대본, 컷, 영상 설정, TTS, job 조회 endpoint를 유지한다.
- `/cuts/generate`는 **컷 계획 생성**이고 개별 `/cuts/{cut_id}/regenerate`가 이미지 생성 job을 접수한다. 문서·UI의 용어를 이 실제 계약과 일치시킨다.
- `/tts/preview`와 `/tts/generate`를 UI에 연결하면서 목적별 결과 적용 차이를 명확히 한다.
- 기존 output endpoint는 기본 target으로 연결하는 호환 adapter를 둔다. 아직 없는 신규 API를 기존 기능인 것처럼 호출하지 않는다.

### 6.3 추가/확장할 API

공통 prefix는 `/api/projects/{project_id}`이다. 아래 이름은 구현할 계약으로 확정 제안하며 같은 목적의 중복 endpoint를 만들지 않는다.

| API | 요청 / 응답 핵심 | 실패·동시성 규칙 |
|---|---|---|
| `PATCH /brief` | ContentBrief patch + expected_revision → 저장 brief/revision | 422 schema, 409 오래된 revision |
| `POST /targets` | medium/profile/source target? → target | 기존 편집본 삭제 없음 |
| `GET /targets` | target별 마지막 단계·출력 상태 | project 소속 검사 |
| `GET /workflow?target_id=…` | stages, current_stage, blockers, warnings | 읽기만, 자동 생성 없음 |
| `GET /targets/{target_id}/composition` | pages/layers/revision | 저장된 target 스냅샷 반환 |
| `PATCH /targets/{target_id}/composition` | 허용된 편집 operation + expected_revision | schema/소속/순서 검사, 409 충돌; 글 넘침은 초안 저장 허용+경고 |
| `POST /generation-batches` | target_id, operation, selection, item_ids, expected_revision | 전 항목 검증 후 접수; 같은 idempotency key 재사용 |
| `GET /generation-batches/{batch_id}` | counts + item job 상태/오류/기존 자산 | 1컷 실패해도 나머지 결과 조회 가능 |
| `POST /generation-batches/{batch_id}/retry` | 실패/취소 대상 ID → 새 attempt ID 연결 | 성공 컷·잠금 컷 제외 |
| `POST /generation-batches/{batch_id}/cancel` | 미완료 대상 취소 요청 | 완료 자산 보존, 늦은 결과 자동 적용 금지 |
| `POST /targets/{target_id}/output/validate` | 현재 target revision → blockers/warnings | variant/job/파일 생성 금지 |
| `POST /targets/{target_id}/output/render` | 검증 revision + format/quality → job_id | validated snapshot 저장 후 실행 |
| `GET /targets/{target_id}/outputs` | variant 목록·파일·출처 revision | 구버전 결과 표시 |
| `GET /output/{variant_id}/files/{file_id}` | 등록된 파일 stream | 경로 직접 입력 금지, 정확한 MIME |

`operation`은 초기 `images`, `tts`로 제한한다. `selection`은 `missing`, `failed`, `selected`, `all_unlocked` 중 하나다. `selected`일 때만 `item_ids`를 사용한다. 동일 key에 다른 입력을 보내면 409를 반환한다.

API의 `expected_revision`은 해당 편집 대상의 content revision을 뜻한다. GET/화면 이동은 이를 변경하지 않는다. source 참조가 끊어진 레이어는 오류 표시된 초안으로 보존할 수 있지만 새로 추가하는 타 프로젝트 자산 참조는 거부한다.

batch는 접수 대상 스냅샷과 deterministic child ID를 먼저 원자적으로 저장하고, child job이 일부만 만들어졌으면 재시작 때 누락 child만 접수한다. batch 복구가 동일 이미지의 중복 호출을 만들지 않는지 장애 주입으로 검사한다.

초기 진행 전송은 기존 polling을 재사용한다. 화면 활성 시 약 1초 간격, 탭 비활성 시 간격 증가, 종료 상태에서 중지한다. SSE/WebSocket은 우선 도입하지 않는다.

### 6.4 준비 상태와 오류

준비 검사 결과는 단계별 안내와 출력 접수가 함께 사용한다. 화면 열기와 제작 완료 처리를 구분한다. 출력 페이지는 미완성 상태에서도 열어 부족한 항목과 수정 링크를 보여주되, 준비되지 않은 렌더 접수·완료 상태 변경만 거부한다. 캐러셀은 페이지·텍스트·자산·비율, 영상은 여기에 길이·음성·자막 cue를 추가 검사한다.

글 넘침은 폰트 로딩 뒤 실제 DOM 치수를 측정해야 하므로 Pydantic 필드 검사만으로 판정하지 않는다. 브라우저 측 편집 경고와 renderer 측 출력 사전검사를 나누고 같은 조판 fixture로 일치 여부를 확인한다. 사전검사는 임시 메모리 페이지에서 수행할 수 있으나 사용자 project/variant/job/최종 파일을 생성·변경하지 않는다.

```json
{
  "can_export": false,
  "blockers": [
    {"code": "TEXT_OVERFLOW", "page_order": 3, "layer_id": "body", "message": "3페이지 본문이 영역을 벗어납니다.", "action": "open_design"}
  ],
  "warnings": []
}
```

`PROVIDER_UNAVAILABLE`, `AUTH_REQUIRED`, `RATE_LIMITED`, `GENERATION_TIMEOUT`, `INVALID_GENERATION_RESULT`, `IMAGE_ASPECT_MISMATCH`, `REFERENCE_UNSUPPORTED`, `STALE_INPUT`, `ASSET_MISSING`, `TEXT_OVERFLOW`, `AUDIO_TOO_LONG`, `RENDER_FAILED`를 구조화한다. retryable 여부와 수정할 컷/페이지/설정 링크를 제공한다. 원시 prompt·인증·전체 stderr는 UI에 노출하지 않는다.

## 7. AI 연결과 병렬 생성

- 텍스트·이미지·TTS capability를 각각 표시한다. CLI 파일 발견만으로 이미지 생성·로그인·참조 편집까지 가능하다고 표시하지 않는다.
- 기본 텍스트/이미지는 기존 Codex MCP 경로다. API는 사용자가 선택하고 인증한 별도 provider다. 명시적 설정 없는 유료 fallback을 금지한다.
- 이미지 계약에 `reference_asset_ids`, `mode=text_to_image/reference/edit`, `mask_asset_id?`, `target_profile_id`, `generation_input_hash`를 추가한다. 내부 adapter에서만 검증된 로컬 파일 경로로 해석한다.
- 참조/편집 지원은 기존 Codex 설치와 실제 지원 호출을 점검한 뒤 활성화한다. 프롬프트에 ‘참고해’라고 쓰는 것으로 바이너리 참조 전달을 대체하지 않는다. 지원 미확인 상태에서도 원본 업로드·배치 모드로 제작할 수 있어야 한다.
- 컷마다 독립 내부 생성 세션·출력 디렉터리·job ID를 사용한다. 현재 생성 job이 만든 결과만 수집하고 공용 폴더의 가장 최근 PNG를 가져오지 않는다.
- 전체 이미지 병렬 수의 기본 상한은 현재와 같은 4로 두되 provider별 1~4 조절을 제공한다. 4개 병렬이 실제로 4배 빠르다고 보장하지 않는다.
- 이미지와 렌더가 동일 4 worker를 모두 점유하지 않도록 작업 종류별 제한을 둔다. 초기 렌더 동시 수는 1이다. 새 상주 프로그램을 만들지 않고 기존 backend runner에서 조정한다.
- 명확한 429/일시 오류만 지연 재시도한다. timeout 뒤 원격 생성 완료 여부가 불명확하면 자동 재호출보다 결과 존재/세션 상태 확인을 먼저 한다. 재시작도 무조건 재호출하지 않는다.
- Codex 결과가 없으면 실패다. 로컬 초안은 사용자가 선택한 `local_draft` 출처로 구별한다. 그림용 PNG 대신 템플릿 배경을 만들고 ‘이미지 준비됨’으로 표시하지 않는다.

ForgeGate용 별도 Codex 재호출·모델 API는 추가하지 않는다. 제품 기능으로 이미 승인된 Codex MCP adapter와 개발 검수용 실행기를 구분한다.

## 8. 미리보기와 최종 출력

### 8.1 하나의 구성 해석기

현재 프론트 자막 CSS와 worker HTML 생성이 별도이므로 같은 설정인데 다른 결과가 생길 수 있다. 논리 캔버스·레이어·자막을 해석하는 순수 TypeScript 모듈을 `render-worker/src/layout.ts`에 두고, 프론트는 상대 import 또는 현재 Vite 설정의 제한된 alias로 재사용한다. 이 파일은 Node fs/process 의존성을 갖지 않는다.

공유 import를 추가할 때 `frontend/vite.config.ts`의 파일 접근 범위와 양쪽 TypeScript build를 함께 검사한다. 프로젝트 전체 디스크를 허용하거나 두 프로젝트의 tsconfig를 하나로 합치지 않는다. 초기에는 별도 npm 패키지·새 저장소를 만들지 않는다.

`resolvePageLayout(page, canvas)`는 위치·글꼴·배치에 대한 계산만 담당한다. DOM 렌더는 프론트와 worker가 수행하되 같은 입력/계산 결과를 사용하고 고정 fixture로 비교한다. 폰트·CSS·template revision도 출력 manifest에 포함한다.

원본 보기는 contain/no filter다. 최종 배치는 contain, 사용자가 정한 crop, 배경 채움 중에서 선택한다. crop 선택 여부와 좌표를 저장하며 원본 파일은 수정하지 않는다. 안전 영역은 편집 보조로만 보이고 출력 파일에는 넣지 않는다.

### 8.2 캐러셀 렌더

같은 레이어 구성을 애니메이션 없는 HTML로 렌더하고 로컬 Chromium에서 한 페이지씩 PNG로 캡처한다. 현 HyperFrames 버전의 이미지 출력 기능은 이번에 실증하지 않았으므로 가정하지 않는다. 초기 구현은 이미 개발 테스트에서 쓰는 Playwright 계열의 renderer용 런타임 의존성을 명시적으로 추가하는 방식으로 제안한다. 추가 패키지와 Chromium 번들 용량·배포 영향은 D05 착수 시 설명하고 버전을 고정한다.

각 페이지는 폰트 준비, 이미지 decode, 레이아웃 검증이 끝난 뒤 캡처한다. 첫 MVP에서 캐러셀용 텍스트 이미지를 LLM 이미지 생성으로 대신 만들지 않는다.

```text
outputs/<variant-id>/
  001-cover.png
  002-page.png
  003-page.png
  caption.txt
  manifest.json
  carousel.zip
```

파일 순서와 픽셀 크기·decode·hash를 검사한 뒤 variant를 ready로 전환한다. 한 장 실패하면 세트는 partial/failed로 남기고 성공한 장은 보존한다. 완전한 ZIP은 전 페이지가 성공했을 때만 제공한다. 선택 페이지 다운로드는 전체 완료와 구별한다.

### 8.3 영상 렌더

초기에는 현재 HyperFrames를 유지하고 완주를 먼저 검증한다. 렌더 요청은 UI→backend에서 202로 접수하며, backend worker→Node 렌더 서비스 호출은 기존 동기 계약을 유지하되 timeout을 일치시킨다. 기본 renderer 600초, client 630초처럼 정리하고 다른 환경 값에도 `client > renderer`를 검증한다. 기존 client의 300초 clamp도 함께 바꿔야 한다.

취소는 요청 job에 속한 렌더 프로세스와 자식만 종료하고 종료 확인 후 임시 파일을 정리한다. Node 서비스의 ‘렌더 후 accepted’ 응답은 실제 완료 의미와 일치하도록 내부 계약을 정정한다. 고빈도 진행률이 필요해지면 이때 비동기 worker 프로토콜을 검토하며 두 방식을 동시에 만들지 않는다.

출력 스냅샷은 접수 당시의 편집본이다. 파일 생성 후 해상도, codec, duration, audio stream, 파일 크기·decode를 확인한 뒤 원자적으로 최종 경로에 올린다. stale 파일은 이전 편집본 결과로 보존할 수 있지만 최신 편집본 완료로 표시하지 않는다.

실제 청취/시각 검수 기준: 30fps 영상의 컷 전환 누적 오차는 1프레임 이내, 음성 끝 잘림 없음, 선택한 fixture에서 cue 경계 오차 150ms 이내. 자동 전사 정확도 일반 보장이 아니라 이 프로젝트 검수용 수용 기준이다.

## 9. 단계별 구현 계획

각 Task는 아래 파일·계약·검증을 한 단위로 다룬다. 모든 신규 파일 경로는 제안이고, 기존 이름을 재사용할 수 있으면 불필요한 파일을 추가하지 않는다. UI가 포함된 Task는 해당 시안 검수 후 진행한다. 아래 체크박스는 아직 구현하지 않은 작업이다.

아래 축약된 `domain/`, `ai/`, `jobs/`, `media/`, `api/`, `storage/`, `content/`, `rendering/` 경로는 `backend/yali/` 기준이다. 프론트 `app/`, `components/`, `features/`는 `frontend/src/`, renderer의 `src/`는 `render-worker/` 기준이다. 파일명만 있는 항목은 같은 줄에서 명시한 디렉터리를 따른다.

### D00 — 현재 기준선과 실제 개발 계약 연결

**수정/생성 범위:** 기존 `docs/verification/`, `.github/workflows/qa.yml`, 필요 시 프로젝트 전용 ForgeGate Pilot·Task·Project Contract. 중앙 예제 Pilot을 복사하지 않는다.

**계약:** 입력은 승인된 이 설계의 Task 범위와 현재 검사 명령, 출력은 실제 프로젝트 root와 명령을 연결한 preparation/run 기록이다.

- [ ] 기존 9월 5일 T/Q 항목을 현재 코드와 대조하여 완료·남음·미검증으로 매핑한다.
- [ ] 실행 전 중앙 Governor hash, 사용자 승인 범위, 검사 기준과 경로를 기록한다.
- [ ] 단위/API·mock E2E·실백엔드 통합을 구별하여 기준선을 실행한다. 실제 5173 서버와 겹치면 사용자 서버를 종료하지 않고 시험 전용 포트를 사용한다.
- [ ] UI가 필요한 후속 Task의 시안을 모아 사용자 검수 대상으로 제시한다.

**수용:** 검사 0개 성공 없음; fake와 실생성 결과 분리; 정본·실제 명령·run 경로 연결. 문서 등록만으로 Task READY라고 하지 않는다.

### D01 — 콘텐츠 유형·출력 대상·단계 준비 조건

**수정:** `backend/yali/domain/models.py`, `api/routes/projects.py`, `media/aspect.py`, `rendering/manifest.py`, `frontend/src/app/api.ts`, `app/router.tsx`, `components/layout/TopWorkflow.tsx`, `features/idea/FormatSelector.tsx`.

**생성:** `backend/yali/domain/production.py`, `backend/yali/content/workflow.py`, `backend/yali/storage/migrations.py`, `backend/tests/test_production_targets.py`, `backend/tests/test_workflow.py`.

**입출력:** legacy Project → `ProductionTarget[]`; `evaluate_workflow(project, target_id)` → 단계별 가능 여부와 blockers. `target_id`는 이후 작업·레이아웃·출력의 공통 식별자다.

- [ ] legacy shorts/reels/card_news/혼합 fixture의 변환·원본 보존 시험부터 작성한다.
- [ ] `domain/production.py`에 ContentBrief·target·CutBinding 정본 모델을 두고 4:5 비율과 target별 workflow를 추가한다.
- [ ] 빈 프로젝트를 completed로 PATCH하는 요청과 준비되지 않은 렌더 접수를 거부한다. 출력 화면 자체는 부족한 항목을 확인할 수 있게 열어 둔다.
- [ ] 프론트 단계명·분모·링크를 공통 workflow 값에 연결한다.

**검증:** `python -m pytest backend/tests/test_production_targets.py backend/tests/test_workflow.py -q`; 신규 UI integration에서 영상 6단계/캐러셀 5단계, 뒤로 가기·새로고침 확인.

### D02 — 서버 전체 생성·상태 복구·provider 선택

**수정:** `jobs/models.py`, `jobs/queue.py`, `jobs/runner.py`, `jobs/processor.py`, `ai/gateway.py`, `ai/config.py`, `api/routes/settings.py`, `frontend/src/pages/ScriptPage.tsx`, `frontend/src/app/api.ts`.

**생성:** `backend/yali/api/routes/generation_batches.py`, `backend/tests/test_generation_batches.py`, `frontend/src/features/jobs/GenerationProgress.tsx`, `frontend/e2e-integration/generation-batches.spec.ts`.

**입출력:** target + item input hashes → persistent batch/job IDs；조회 응답 → UI 진행 상태. 이미지 입력 변경과 음성 입력 변경을 별도 비교한다.

- [ ] 7컷 중 1컷 실패, 접수 중 재시작, 동일 버튼 연타 시험을 작성한다.
- [ ] batch 원자 저장·누락 child 복구·item별 오류·실패만 재시도·취소를 구현한다.
- [ ] local `Promise.all` 접수·단일 cutJob 상태를 서버 batch 조회에 연결한다.
- [ ] Codex/API 사용 방침·이미지 참조 capability·원인별 오류를 표시한다. 로컬 대본 fallback은 명시적 초안 모드로 분리한다.

**검증:** `python -m pytest backend/tests/test_generation_batches.py backend/tests/test_job_lifecycle.py backend/tests/test_cut_image_generation.py -q`; integration에서 페이지 닫기/복귀 후 동일 job 유지, 성공 6컷 hash 불변.

### D03 — 자료·참조 이미지·콘텐츠별 생성 입력

**수정:** `ai/protocols.py`, `ai/providers/codex_image.py`, `ai/providers/codex_mcp.py`, `ai/codex_mcp_bridge.py`, `content/models.py`, `content/service.py`, `api/routes/media.py`, `frontend/src/features/idea/ReferencePicker.tsx`.

**생성:** `backend/yali/content/briefs.py`, `backend/yali/content/references.py`, `backend/tests/test_reference_inputs.py`.

`content/briefs.py`는 D01의 ContentBrief 모델을 import해 유형별 프롬프트/검증 context를 만드는 서비스다. 동일 이름의 두 번째 도메인 모델을 만들지 않는다.

**입출력:** asset IDs + ContentBrief → 검증된 자료 묶음/유형별 생성 context；image request → 참조 전달 여부가 기록된 asset provenance.

- [ ] 참조 이미지가 실제 요청에 전달되는 adapter contract 시험과 타 프로젝트 asset 거부 시험을 만든다.
- [ ] 업로드 미디어 역할·hash·이미지 치수와 필요한 텍스트 추출 상태를 저장한다. PDF/OCR은 지원 범위를 명시하며 미지원 파일 내용을 분석했다고 표시하지 않는다.
- [ ] general/information/instatoon/product별 응답 schema와 프롬프트 builder를 분리한다.
- [ ] Codex 참조 편집 실지원 확인은 소량 smoke로 별도 기록하고 지원 미확인 시 원본 배치 경로를 제공한다.

**검증:** `python -m pytest backend/tests/test_reference_inputs.py backend/tests/test_codex_image.py backend/tests/test_codex_mcp.py -q`; text-only fake 시험과 참조 이미지 실생성 검수를 분리.

### D04 — 레이어 모델·템플릿·확대 디자인 편집

**수정:** `domain/models.py`, `rendering/manifest.py`, `frontend/src/features/design/DesignBoard.tsx`, `design.css`, `frontend/src/app/api.ts`, `render-worker/src/types.ts`, `composition.ts`.

**생성:** `backend/yali/domain/composition.py`, `backend/yali/api/routes/compositions.py`, `render-worker/src/layout.ts`, `frontend/src/features/design/CanvasEditor.tsx`, `backend/tests/test_composition.py`, `render-worker/src/layout.test.ts`, `frontend/src/features/design/CanvasEditor.test.tsx`.

**입출력:** CompositionPage + canvas → `resolvePageLayout(page, canvas)` 결과；편집 operation + expected_revision → 새 composition revision.

- [ ] image/text/bubble/shape schema와 layer 이동·정렬·잠금·history 시험을 작성한다.
- [ ] 1컷 1페이지 매핑과 표지/본문/CTA 템플릿을 구현한다.
- [ ] 큰 캔버스 편집·원본/출력 보기·동일 좌표 축소·overflow 경고를 연결한다.
- [ ] 모든 편집은 생성 이미지 픽셀을 바꾸지 않고 레이어 데이터에 저장한다.

**검증:** composition API 시험, CanvasEditor unit, renderer layout unit. 1:1/4:5/9:16 동일 fixture의 폰트·경계·이미지 배치 비교와 반응형 시각 검수.

### D05 — 카드뉴스 PNG/ZIP 완주

**수정:** `api/routes/outputs.py`, `jobs/processor.py`, `storage/project_store.py`, `media/render_client.py`, `render-worker/package.json`, `src/server.ts`, `src/renderer.ts`, `frontend/src/app/router.tsx`.

**생성:** `render-worker/src/carousel.ts`, `frontend/src/pages/OutputPage.tsx`, `backend/tests/test_carousel_output.py`, `frontend/e2e-integration/carousel.spec.ts`.

**입출력:** 검증된 target composition → immutable render manifest → `OutputVariant.files[]` PNG/TXT/ZIP.

- [ ] source/overflow 검증 실패 시 project·variant·queue가 변하지 않는 시험부터 만든다.
- [ ] Chromium 캡처, 폰트 로딩 대기, 페이지 번호·정확한 크기·순서 검사를 연결한다.
- [ ] partial 결과·실패 페이지 재시도·완료 ZIP 원자 저장·MIME별 다운로드를 구현한다.
- [ ] OutputPage에서 크기·페이지 목록·경고·렌더·미리보기·다운로드를 제공한다.

**검증:** 캐러셀 5/10/20페이지 실 PNG 생성·ZIP decode·순서·한국어 넘침. 1페이지 실패 fixture에서 전체 완료 금지. 이 Task 종료 시 정보형 캐러셀 하나를 실제 저장할 수 있어야 한다.

### D06 — 음성 미리듣기·생성·자막 시간 연결

**수정:** `ai/protocols.py`, `ai/providers/edge_tts.py`, `media/audio.py`, `domain/video_settings.py`, `api/routes/tts.py`, `jobs/processor.py`, `frontend/src/pages/VideoSettingsPage.tsx`.

**생성:** `backend/yali/content/subtitles.py`, `backend/tests/test_subtitle_timing.py`, `frontend/src/features/video-settings/AudioPreview.tsx`, `frontend/e2e-integration/tts.spec.ts`.

**입출력:** narration/audio settings → audio asset + measured duration + cues；preview result와 active audio 연결 분리.

- [ ] 미리듣기 때문에 활성 자산이 바뀌지 않는 시험, 설정 변경/stale/lock 시험을 작성한다.
- [ ] Edge TTS cue 보존·오디오 길이 측정·업로드 오디오 경로·전체 생성 UI를 구현한다.
- [ ] 긴 자막 문장 분할·cue 수정·고정 컷 길이 충돌·사용 여부를 연결한다.
- [ ] 자막 clipping을 숨기지 않고 편집 또는 분할로 해결한다.

**검증:** `python -m pytest backend/tests/test_tts_jobs.py backend/tests/test_audio_generator.py backend/tests/test_subtitle_timing.py -q`; 한글 긴 문장·무음·마지막 음절·컷별 예외를 실제 청취/화면 검수.

### D07 — 영상 렌더·출력 품질·취소 완주

**수정:** `rendering/manifest.py`, `media/render_client.py`, `jobs/processor.py`, `api/routes/outputs.py`, `render-worker/src/composition.ts`, `src/renderer.ts`, `src/server.ts`, `frontend/src/pages/OutputPage.tsx`.

**생성:** `backend/tests/test_output_validation.py`, `frontend/e2e-integration/video-output.spec.ts`, `render-worker/src/render-smoke.test.ts`.

**입출력:** target snapshot + audio/cue/layout → validated MP4 file + metadata；cancel(job_id) → 해당 renderer 프로세스 종료.

- [ ] 30초 초과 렌더·timeout·취소·프로젝트명 변경·출력 내용 변경 시험을 작성한다.
- [ ] timeout 계약·프로세스 종료·자막/음성 enabled·정렬·모션·duration을 공통 해석 결과에 연결한다.
- [ ] 무음 영상 먼저, 이후 TTS/자막 영상의 실파일을 검사한다. 최종 파일 probe 전에는 완료 표시하지 않는다.
- [ ] 출력과 다른 최신 편집본의 존재를 표시하고 기존 파일을 보존한다.

**검증:** 실제 7컷/30초 이상 MP4, 자막 off/음성 off, 4:5 원본을 9:16 contain 배치, 취소 후 고아 프로세스·최종 파일 부재. 완료/재다운로드·구버전 표시 E2E.

### D08 — 인스타툰 캐릭터·대사·패널 템플릿

**수정:** `content/briefs.py`, `content/models.py`, `ai/protocols.py`, `domain/composition.py`, `features/design/CanvasEditor.tsx`.

**생성:** `backend/yali/domain/characters.py`, `backend/yali/api/routes/characters.py`, `frontend/src/features/characters/CharacterPanel.tsx`, `backend/tests/test_instatoon.py`, `frontend/e2e-integration/instatoon.spec.ts`.

**입출력:** CharacterProfile versions + story brief → cut characters/dialogue → bubble/panel layers.

- [ ] 캐릭터 2명·대화 순서·기준 version 고정·한 컷 재생성 fixture를 만든다.
- [ ] 기준 이미지 선택·의상/그림체 저장·대표 컷 검수·나머지 batch 생성 흐름을 연결한다.
- [ ] 대사 수정은 bubble만, 그림 재생성은 image layer만 변경한다.
- [ ] 2/4패널 템플릿과 화자별 대사·영상 전환용 내레이션을 지원한다.

**검증:** 실제 6페이지 인스타툰에서 인물·의상 일관성 사용자 비교 검수, 말풍선 오탈자 수정 후 이미지 hash 불변, 1컷 재생성 후 다른 컷 불변, PNG와 MP4 각각 출력.

### D09 — 상품 원본 보존·정보 기반 쇼츠

**수정:** `content/briefs.py`, `content/references.py`, `domain/composition.py`, `features/design/CanvasEditor.tsx`.

**생성:** `backend/yali/domain/products.py`, `backend/yali/api/routes/products.py`, `frontend/src/features/products/ProductBriefForm.tsx`, `backend/tests/test_product_content.py`, `frontend/e2e-integration/product-video.spec.ts`.

**입출력:** ProductProfile facts + original assets → fact-linked script + product placements.

- [ ] 원본 제품 hash/로고 보존, 없는 가격·효과 미삽입, source 사실 수정 영향 시험을 만든다.
- [ ] 상품 업로드·특징 입력·CTA·원본/배경 레이어 분리 템플릿을 구현한다.
- [ ] 상품 영역 보존을 검수하고 모델이 만든 가상의 제품을 원본으로 표시하지 않는다.
- [ ] 원본 사진 기반 15~30초 상품 쇼츠와 5페이지 캐러셀을 실제 저장한다.

**검증:** `python -m pytest backend/tests/test_product_content.py -q`; 브랜드/형태 비교, 문구 사실 연결, 참조 provider 미지원일 때 원본 배치 완주. 쇼핑몰 로그인·자동 수집은 이 Task에 넣지 않는다.

### D10 — 형식 파생·라이브러리·작업 탐색

**수정:** `domain/production.py`, `api/routes/projects.py`, `frontend/src/pages/HomePage.tsx`, `components/layout/Sidebar.tsx`, `app/router.tsx`.

**생성:** `frontend/src/features/library/LibraryPage.tsx`, `backend/tests/test_target_derivation.py`, `frontend/e2e-integration/target-derivation.spec.ts`.

**입출력:** source target + 새 medium/profile → 독립 revision의 target；재사용 자산은 project에 고정 snapshot으로 연결.

- [ ] 캐러셀→영상/영상→캐러셀 변환 시 텍스트·순서·참조를 복사하고 배치/길이는 형식별로 재검수하게 한다.
- [ ] 캐릭터·브랜드·템플릿은 version snapshot으로 재사용하고 원본 library 변경이 과거 프로젝트를 바꾸지 않게 한다.
- [ ] 실제 메뉴·작업 큐·오류 위치 이동·검색/필터를 연결한다. 미구현 운영 메뉴는 준비 중 이유를 표시한다.
- [ ] 타입별 홈 필터와 마지막 target/페이지 위치 복귀를 저장한다.

**검증:** 파생 target 편집이 원 target의 레이어/이미지/출력 hash를 바꾸지 않음; 링크 새로고침·브라우저 뒤로 가기·프로젝트 전환 E2E.

### D11 — Windows 실행·포터블·최종 인수 검증

**수정:** `scripts/yali-launcher.py`, `scripts/package-yali-home.ps1`, `scripts/check-yali.ps1`, `docs/portable-bundle.md`, `README.md`, 필요 시 runtime 의존성 고정 파일.

**시험:** 기존 `backend/tests/test_yali_launcher.py` 확장, 포터블 파일 목록·secret 제외 검사 추가.

**입출력:** 검증된 앱 코드+lockfile+런타임 목록 → 버전 표시 ZIP；사용자 데이터 포함 여부는 패키징 선택값으로 분리.

- [ ] GSAP·HyperFrames·Chromium·폰트의 실제 로컬 실행 의존성을 고정한다. CLI 설치 여부와 인증 여부를 따로 진단한다.
- [ ] backend/frontend/renderer의 예상 서비스 식별·준비 상태를 확인하고 CMD 없이 실행한다.
- [ ] 코드 백업, 이동용 프로젝트 데이터, 인증 정보를 구분한다. 비밀과 세션 인증은 번들에 넣지 않는다.
- [ ] 별도 Windows 환경에서 압축 해제→프로젝트 열기→편집→PNG/MP4 출력→재실행을 검증한다.

**수용:** 이 PC의 /validate 성공만으로 집 PC 검증이라고 하지 않는다. offline 편집/로컬 렌더와 online AI 생성 요구를 문서에 명시한다.

### 구현 순서와 첫 완성 지점

`D00 → D01 → D02 → D03 → D04 → D05 → D06 → D07 → D08 → D09 → D10 → D11`

- D05: 정보형 캐러셀을 PNG/ZIP으로 실제 저장.
- D07: 기존 일반 숏폼을 음성·자막 포함 MP4로 실제 저장.
- D08: 기준 캐릭터와 편집 가능한 말풍선이 있는 인스타툰 완주.
- D09: 원본 상품 모습을 유지한 상품 콘텐츠 완주.
- D11: 다른 Windows PC에서 동일 경로 재현.

이 순서는 공통 조판·출력을 먼저 완성해 콘텐츠별 기능이 모두 ‘안내용 화면’에 머무르지 않도록 정한 것이다. D08/D09의 실제 캐릭터/상품 생성 품질은 단위 테스트 수로 대신 승인하지 않는다.

## 10. 검증 체계와 수용 시나리오

### 현재 사용할 수 있는 검사 명령

저장소 루트에서 실행한다. 명령 존재와 실행 결과를 구분하고 개별 Task마다 관련 검사부터 실행한다.

```powershell
& .venv/Scripts/python.exe -m pytest backend/tests -q
npm.cmd --prefix frontend run unit
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run e2e
npm.cmd --prefix frontend run integration
npm.cmd --prefix render-worker run unit
npm.cmd --prefix render-worker run lint
git diff --check
```

현재 프론트 `lint`는 `tsc --noEmit`이다. 코드 스타일 ESLint 검사가 실행됐다고 부르지 않는다. renderer unit script는 시험 파일 3개를 명시하므로 신규 `layout.test.ts`/`render-smoke.test.ts`를 추가할 때 script도 확장해야 한다. 실렌더 smoke는 일반 unit와 명령을 분리한다.

| 시나리오 | 합격 기준 | 증거 |
|---|---|---|
| 기존 프로젝트 이행 | 기존 ID·자산·대본·컷 버전·출력 보존, 재이행으로 target 중복 없음 | 임시 legacy fixture API 검사 |
| 혼합 매체 | 9:16 target과 4:5 target의 이미지/레이어가 서로 덮이지 않음 | target API·브라우저 통합 |
| 7컷 전체 생성 | 1컷 실패 후 성공 6컷 보존, 실패만 재시도 | queue·asset hash·UI |
| 생성 중 새로고침 | batch/job 식별자·완료 수 복원, 미접수 항목 복구 | 실백엔드 fake 통합 |
| 동일 컷 이미지+음성 | 서로 다른 결과가 정상 병합, 오래된 입력은 적용 안 됨 | 동시성 테스트 |
| 잠금·취소·삭제 경합 | 늦은 결과가 현재 편집본/삭제 프로젝트를 복구하거나 교체하지 않음 | 장애 주입 |
| 캐러셀 한 페이지 실패 | 완전한 세트로 표시하지 않음, 성공 페이지 재생성 안 함 | 실제 PNG/ZIP |
| 말풍선/한글 편집 | 텍스트 오탈자 수정 가능, 영역 넘침 표시, 그림 hash 불변 | 캔버스·이미지 비교 |
| 상품 원본 배치 | 제품 외형·색·로고 보존, 생성 배경과 구분 | 원본/출력 비교 |
| 음성·자막 off | 파일에 해당 트랙·텍스트 없음, 미리보기와 일치 | 실제 MP4 probe·시각·청취 |
| 자막 긴 문장 | 숨겨진 잘림 없이 분할/수정 안내, 선택 글꼴 적용 | 3비율·8개 번들 한글 글꼴 fixture |
| render 검증 실패 | variant/queue/프로젝트 변경 없음 | API snapshot 비교 |
| 30초 초과/취소 | 잘못된 client timeout 없음, 소유 프로세스만 종료 | 실렌더·프로세스 기록 |
| 다른 PC 실행 | 인증 복사 없이 실행·로그인 안내·로컬 출력 재현 | 별도 Windows 실행 기록 |

기본 시험 데이터는 가짜 7컷 프로젝트, 2인 캐릭터 이야기, 상품 사진 fixture, 5/10/20페이지 카드, 40컷 부하 fixture, 긴 한국어·영문·숫자·이모지, 가로/세로/정사각·손상 이미지로 구성한다. 사용자 `storage`를 자동 QA fixture로 쓰지 않는다.

## 11. 참고자료 폴더 재사용 계획

`C:\프로그램\쇼츠참고자료`의 루트 `LICENSE`는 MIT 표기다. 직접 가져오는 파일의 고지와 추가 의존성·에셋 라이선스는 이식 시 각각 확인한다. 이번에는 코드를 복사하지 않았다.

| 후보 | 이번에 확인한 내용 | 재사용 방향 |
|---|---|---|
| `app/services/voice.py` | Edge cue를 원고 문장에 묶는 `_build_subtitle_items_from_edge_cues`, provider 함수들 | cue/원고 매칭 개념과 관련 테스트를 참고해 현재 EdgeTTSProvider에 필요한 부분만 이식 |
| `app/services/video.py` | 자막 bbox·배경·글꼴 지원 검사 함수 목록, MoviePy 기반 구성 | 자막 경계 시험 사례를 참고; HyperFrames를 통째로 교체하지 않음 |
| `app/services/material_cache.py` | hash·TTL·lock·원자 저장, source 메타데이터 정리 | 자산 provenance/cache 설계 참고; 기존 ProjectStore/atomic_json 중복 구현 금지 |
| `test/services/test_voice.py`, `test_subtitle.py`, `test_subtitle_background_settings.py` | 파일 존재 확인 | 이식 단계에서 실제 내용을 읽고 관련 회귀 fixture를 선별 |

참고 프로그램의 전체 config, API 인증, provider 목록, webui, `.venv`를 복사하지 않는다. `voice.py`는 여러 엔진·MoviePy·전역 config에 의존하므로 통째 import하지 않는다. 실제 채택 내용과 시험은 `docs/verification/reference-reuse.md`에 단계별 기록한다.

## 12. 이번 조사에서 실행한 검증과 한계

| 검사 | 이번 결과 | 해석 |
|---|---|---|
| backend `pytest backend/tests -q` | **63 passed**, 1 warning, exit 0 | API/도메인/provider stub 등의 기존 시험 통과 |
| frontend `npm run unit` | **55 passed / 11 files**, exit 0 | 기존 UI 단위 시험 통과; 실제 브라우저 렌더 성공 증거는 아님 |
| renderer `npm run unit` | **12 passed**, exit 0 | TypeScript build와 HTML/경로/서버 등의 시험 통과; HyperFrames 실영상 출력 시험은 아님 |
| 실제 Codex/TTS 생성 | 이번 미실행 | 기존 성공 기록을 현재 계정/기능 지원 보장으로 사용하지 않음 |
| E2E·실backend 브라우저 통합·실렌더 | 이번 미실행 | 설정과 시험 파일만 조사; 새 기능 구현 때 실행 필요 |
| 새 Windows PC·모든 반응형 화면 | 이번 미실행 | 기존 실행파일·이미지의 존재로 합격 처리하지 않음 |

backend warning은 Starlette TestClient의 httpx 사용 deprecation이다. 이번 문서 작업에서 dependency를 변경하지 않았다.

### ForgeGate 참조 기록

- `governor_path`: `C:/프로그램/코딩시스템/skills/ai-dev-governor/SKILL.md`
- `governor_version`: `1.7`
- `governor_sha256`: `C4BD7046CFDDBB4663B2550A32F369B00E682960FE6791B1B16341203F2185AE`
- `read_at`: `2026-09-11T19:25:16+09:00`
- 전역 진입점: `C:/Users/sisir/.agents/skills/forgegate/SKILL.md`
- 대상 root: `C:/프로그램/쇼츠자동화`
- 이번 tracked/숨김 프로젝트 파일 조사에서 실제 Pilot·Task/Project Contract·Run 연결을 찾지 못했다. 미연결 상태는 구현 착수 시 D00에서 구체화하며 중앙 프로젝트의 Pilot로 대체하지 않는다.
- 이번은 설계 요청이므로 Governor 구현 loop/bootstrap은 시작하지 않았다. Run·Receipt·READY를 생성하거나 주장하지 않는다. 위 hash는 참고 기록이며 구현 시작 시 다시 읽어야 한다.

## 13. 다음 구현 착수 지시

이 설계의 구현이 승인되면 D00부터 시작한다. 현재 코드에서 이미 해결된 기존 QA 항목을 재구현하지 말고, 새 콘텐츠 분류·target·workflow 계약을 먼저 확정한다. 공통 레이어와 출력 기반을 만든 뒤 캐러셀, 영상, 인스타툰, 상품형 순서로 실제 결과물을 검수한다.

각 Task의 완료 조건은 **버튼 존재가 아니라 새 프로젝트에서 입력 → 편집 → 저장된 결과물까지 이어지는 동작**이다. 단위 시험 PASS, 실파일 검사, 시각/청취 검수, ForgeGate 상태를 분리해서 기록한다. 승인된 여러 Task 사이에는 매번 진행 허락을 요청하지 않으며, 새로운 UI 시안·범위·권한·필수 검토 연결이 필요한 지점만 구체적인 결과와 함께 제시한다.

GitHub 백업은 사용자가 기존에 요청한 단계별 백업 범위를 유지하되, 실제 변경 파일만 명시적으로 stage하고 정상 push 결과를 확인한다. 기존 데이터·인증·배포 ZIP·관계없는 다른 작업 파일은 포함하지 않는다. 이 설계 작성은 신규 기능 전체의 구현 승인이나 자동 게시 승인으로 간주하지 않는다.

# 얄리 숏폼 스튜디오

Yali Short-form Studio는 쇼츠·릴스·카드뉴스 제작을 위한 로컬 데스크톱 스튜디오입니다. 기본 UI 언어는 한국어입니다.

## QA와 다음 구현 기준

- [QA 기반 단계별 구현지시서](docs/plans/2026-09-05-qa-implementation.md): 우선순위, 변경 파일, API 계약, UI 승인, 검증·완료 조건을 작업별로 정리했습니다.
- [2026-09-05 실측 QA 기준선](docs/verification/qa-baseline-2026-09-05.md): 실행한 테스트, 재현한 문제, 실연동·배포 검증의 남은 범위를 구분합니다.

이 문서들은 향후 구현 지시이며, 기재된 신규 기능이 이미 구현됐다는 뜻은 아닙니다.

## Windows 개발 순서

저장소 위치는 `C:\프로그램\쇼츠자동화`입니다. PowerShell에서 저장소로 이동한 뒤 다음 순서로 실행합니다.

```powershell
cd C:\프로그램\쇼츠자동화
& .venv\Scripts\python.exe -m pip install -e ".[dev]"
npm --prefix frontend install
npm --prefix render-worker install
npm --prefix render-worker run build
```

별도 터미널에서 백엔드는 `http://127.0.0.1:8000`, 프론트엔드는 `http://127.0.0.1:5173`, 렌더 워커는 `http://127.0.0.1:8010`으로 실행합니다. 렌더 워커는 독립 Node 패키지이며 백엔드가 Node 모듈을 직접 import하지 않습니다.

```powershell
& .venv\Scripts\python.exe -m uvicorn yali.api.app:create_app --factory --reload --port 8000
npm --prefix frontend run dev
npm --prefix render-worker run start
```

세 서비스를 별도 CMD 창 없이 시작하려면 다음을 실행합니다.

```powershell
cscript //nologo scripts\start-yali.vbs /validate
wscript.exe scripts\start-yali.vbs
# 상태 확인
pwsh -File scripts\check-yali.ps1
# 종료
pwsh -File scripts\stop-yali.ps1
```

`start-yali.vbs`는 자신의 위치를 기준으로 저장소를 찾고, 백엔드·frontend·렌더 워커 프로세스를 숨김 상태로 실행합니다. `/validate`는 서버를 시작하지 않고 경로, Python·Node·npm·렌더 워커 빌드와 Codex CLI 발견 여부를 검사합니다.

더블클릭으로 실행할 수 있는 Windows 실행 파일을 만들려면 다음 명령을 실행합니다. 결과물은 `release\YaliShortformStudio.exe`이며, 실행 파일 자체도 GUI 모드로 패키징되어 CMD 창을 띄우지 않습니다. 실행 후 프론트엔드가 준비되면 기본 브라우저에서 작업 화면을 자동으로 엽니다. 실행 파일은 프로젝트 폴더의 `release` 위치에 둔 상태로 사용해야 합니다.

```powershell
& .venv\Scripts\python.exe -m pip install "pyinstaller>=6,<7"
pwsh -File scripts\build-yali-exe.ps1
```

실행 파일에 `/validate` 또는 `/stop` 인수를 전달하면 각각 실행환경 검증과 백그라운드 서비스 종료를 수행합니다.

집이나 다른 Windows PC에서 바로 실행할 포터블 번들을 만들려면 다음 명령을 실행합니다. ZIP 안에는 소스, 현재 `storage` 프로젝트 데이터, Python·Node.js 실행 파일과 설치된 런타임 의존성이 함께 들어가며, 압축을 푼 뒤 루트의 `YaliShortformStudio.exe`를 더블클릭하면 됩니다. Codex 구독 인증은 포함하지 않으므로 집 PC에서 Codex CLI 로그인이 한 번 필요합니다.

```powershell
pwsh -File scripts\package-yali-home.ps1
```

생성된 파일은 `release\YaliShortformStudio-home-YYYYMMDD.zip`입니다. 자세한 사용법은 `docs\portable-bundle.md`를 참고하세요.

Codex 연동 단계에서는 Codex CLI 로그인이 선행되어야 하며, 구독 인증은 로컬 MCP를 통해 처리합니다. `C:\프로그램\쇼츠참고자료`는 런타임 의존성이 아닙니다.

## 현재 구현 단계

현재는 아이디어 → 대본 → 컷 구성 → 디자인 이미지 생성까지의 MVP 흐름을 구현하고 검증한 상태입니다. 각 단계는 검증과 GitHub 백업을 마친 뒤 다음 단계로 진행합니다.

### 사용자 화면에서 동작하는 기능

- 홈 프로젝트 목록·프로젝트 생성·반응형 작업 공간
- 아이디어 입력·임시 저장·생성 요청·취소·참고자료 업로드
- 아이디어 결과를 바탕으로 한 대본 생성·대본 개요 표시·내레이션 라인 표시
- 대본 버전 저장·활성 버전 선택
- 씬·컷 보드와 컷별 visual prompt 표시
- Codex 구독 provider를 통한 실제 대본 생성 및 API fallback
- 디자인 단계의 컷별 이미지 생성·재생성·상단 전체 이미지 생성
- Codex ImageGen/GPT Image 2가 만든 실제 PNG 저장 및 미리보기

### 다음 단계에서 구현할 기능

- 컷 잠금·버전 선택 UI 확장
- 자막·모션·음성 설정과 출력 미리보기
- HyperFrames 렌더·완료 파일 다운로드 UI

`output` 경로는 다음 단계 구현 대상으로 남아 있습니다. 영상 모션, TTS, 카드뉴스 레이아웃 렌더링은 이미지 생성 단계와 분리해 순차적으로 연결합니다.

## 백엔드 MVP 계약

현재 백엔드 MVP는 다음 흐름을 제공합니다.

- 아이디어 입력과 버전 저장: `/api/projects/{project_id}/ideas`
- Codex 구독 기반 MCP text gateway와 OpenAI-compatible API fallback
- 대본 생성·버전 저장: `/api/projects/{project_id}/script/generate`
- 씬·컷 계획 생성과 컷별 버전/잠금/재생성: `/api/projects/{project_id}/cuts`
- 디자인 이미지 생성 큐: `/api/projects/{project_id}/cuts/generate` 및 `/api/projects/{project_id}/cuts/{cut_id}/regenerate`
- 컷마다 Codex ImageGen/GPT Image 2가 생성한 실제 PNG를 고유한 버전별 시각 자산으로 저장·연결
- 이미지 생성 실패는 작업을 `failed`로 기록하며 SVG나 임시 그라디언트로 대체하지 않음
- 선택적 컷별 오디오 트랙, 모션 프리셋·자막 타이밍
- 원본 이미지 미디어 preview URL과 색상 프로필 보존
- HyperFrames용 출력 manifest: `/api/projects/{project_id}/output/manifest`
- 영속 큐 기반 HyperFrames 렌더 요청: `/api/projects/{project_id}/output/render`
- 렌더 완료 파일 다운로드: `/api/projects/{project_id}/output/{variant_id}/file`

디자인 단계의 이미지 생성은 로컬에 로그인된 Codex CLI를 기존 MCP 브리지의 `generate_image` 도구로 호출합니다. 생성된 PNG는 브리지에서 base64 MCP 이미지 콘텐츠로 전달된 뒤 프로젝트 자산으로 저장됩니다. 등록한 원본 이미지·영상은 프로젝트 참고자료와 미리보기에서 원본 색상으로 유지됩니다.

디자인 탭에서 전체 이미지 생성을 시작하면 컷마다 고유한 작업과 Codex MCP 세션을 만들고 최대 4개까지 병렬 처리합니다. 각 컷의 결과는 최신 프로젝트에 개별 병합하므로 한 컷의 저장이 다른 컷의 결과를 덮어쓰지 않습니다.

Codex text/image provider는 API 키가 필요 없습니다. 먼저 Codex CLI에 현재 ChatGPT 계정으로 로그인해야 합니다. Codex CLI가 PATH에 없으면 `CODEX_CLI_PATH`에 `codex.exe`의 절대 경로를 지정할 수 있고, 모델을 고정할 때는 선택적으로 `YALI_CODEX_MODEL`을 지정합니다. API fallback을 사용할 때는 다음 환경 변수를 설정합니다. API 키는 응답이나 trace metadata에 포함되지 않습니다.

```powershell
$env:YALI_API_BASE_URL = "https://api.openai.com/v1"
$env:YALI_API_MODEL = "your-model"
$env:YALI_API_KEY = "your-api-key"
# 기본값은 codex_mcp이며, API를 primary로 쓸 때만 변경
$env:YALI_LLM_PROVIDER = "codex_mcp"
# 비워 두면 현재 Codex 구독의 기본 모델 사용
# $env:YALI_CODEX_MODEL = "your-enabled-codex-model"
# 렌더 워커 기본값은 http://127.0.0.1:8010
# 필요할 때만 별도 워커 주소를 지정
# $env:YALI_RENDER_URL = "http://127.0.0.1:8010"
# 렌더 작업 제한시간(밀리초)은 10분이 기본이며 1초~30분으로 제한됨
# $env:YALI_RENDER_TIMEOUT_MS = "600000"
```

실제 앱 실행 시에는 영속 작업 큐 worker가 대기 중인 아이디어·컷 재생성 작업을 복구합니다. 테스트에서 임시 `data_root`를 지정하면 worker는 기본 비활성화되어 기존 큐 계약을 결정적으로 검증합니다.

## 테스트 및 검사

```powershell
& .venv\Scripts\python.exe -m pytest backend/tests -q
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend run unit
npm --prefix frontend run e2e
npm --prefix frontend run integration
npm --prefix render-worker run build
npm --prefix render-worker run lint
npm --prefix render-worker run unit
npx --yes hyperframes@0.8.26 check <composition-dir> --json --at-transitions
```

`e2e`는 화면과 모의 API 흐름을 검사하고, `integration`은 테스트 전용 FastAPI·영속 JSON 저장소·fake provider를 실제로 연결해 브라우저 흐름을 검사합니다. 실 Codex 구독, 사용자 `storage`, 실제 렌더러는 자동 QA에서 호출하지 않습니다. GitHub Actions의 `QA` workflow는 Windows 환경에서 두 범위를 구분해 실행합니다.

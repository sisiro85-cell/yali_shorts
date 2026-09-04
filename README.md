# 얄리 숏폼 스튜디오

Yali Short-form Studio는 쇼츠·릴스·카드뉴스 제작을 위한 로컬 데스크톱 스튜디오입니다. 기본 UI 언어는 한국어입니다.

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

Codex 연동 단계에서는 Codex CLI 로그인이 선행되어야 하며, 구독 인증은 로컬 MCP를 통해 처리합니다. `C:\프로그램\쇼츠참고자료`는 런타임 의존성이 아닙니다.

## 현재 구현 단계

현재는 전체 제작 파이프라인 중 **1단계 대본 생성·조회 화면**까지 구현하고 검증한 상태입니다. 다음 단계는 이전 단계의 검증과 GitHub 백업이 끝난 뒤 순서대로 진행합니다.

### 사용자 화면에서 동작하는 기능

- 홈 프로젝트 목록·프로젝트 생성·반응형 작업 공간
- 아이디어 입력·임시 저장·생성 요청·취소·참고자료 업로드
- 아이디어 결과를 바탕으로 한 대본 생성·대본 개요 표시·내레이션 라인 표시
- Codex 구독 provider를 통한 실제 대본 생성 및 API fallback

### 다음 단계에서 구현할 기능

- 대본 편집·버전 저장·이전 버전 활성화
- 씬·컷 보드와 컷별 이미지/영상 미리보기
- 컷 잠금·재생성·버전 선택
- 자막·모션·음성 설정과 출력 미리보기
- HyperFrames 렌더·완료 파일 다운로드 UI

현재 `cuts`, `design`, `output` 경로는 다음 단계 연결 전 안내 화면으로 유지합니다. 백엔드에는 각 단계의 데이터 계약과 일부 API가 준비되어 있지만, 사용자 화면의 실제 연결이 완료되기 전까지 해당 기능을 완성된 것으로 표시하지 않습니다.

## 백엔드 MVP 계약

현재 백엔드 MVP는 다음 흐름을 제공합니다.

- 아이디어 입력과 버전 저장: `/api/projects/{project_id}/ideas`
- Codex 구독 기반 MCP text gateway와 OpenAI-compatible API fallback
- 대본 생성·버전 저장: `/api/projects/{project_id}/script/generate`
- 씬·컷 계획 생성과 컷별 버전/잠금/재생성: `/api/projects/{project_id}/cuts` (재생성은 Codex gateway에 실제 요청)
- 컷마다 고유한 버전별 시각 자산을 생성·연결하고, 원본 이미지·영상은 별도 참고자료로 보존
- 선택적 컷별 오디오 트랙, 모션 프리셋·자막 타이밍
- 원본 이미지 미디어 preview URL과 색상 프로필 보존
- HyperFrames용 출력 manifest: `/api/projects/{project_id}/output/manifest`
- 영속 큐 기반 HyperFrames 렌더 요청: `/api/projects/{project_id}/output/render`
- 렌더 완료 파일 다운로드: `/api/projects/{project_id}/output/{variant_id}/file`

이미지 모델을 아직 설정하지 않은 MVP에서도 렌더가 끊기지 않도록 visual prompt마다 고유한 로컬 SVG 시각 자산을 생성합니다. 등록한 원본 이미지·영상은 프로젝트 참고자료와 미리보기에서 원본 색상으로 유지되고, 실제 이미지 모델 provider는 동일한 버전 자산 계약을 교체하는 다음 확장 지점입니다.

Codex 기본 provider는 API 키가 필요 없습니다. Codex CLI가 PATH에 없으면 `CODEX_CLI_PATH`에 `codex.exe`의 절대 경로를 지정할 수 있습니다. API fallback을 사용할 때는 다음 환경 변수를 설정합니다. API 키는 응답이나 trace metadata에 포함되지 않습니다.

```powershell
$env:YALI_API_BASE_URL = "https://api.openai.com/v1"
$env:YALI_API_MODEL = "your-model"
$env:YALI_API_KEY = "your-api-key"
# 기본값은 codex_mcp이며, API를 primary로 쓸 때만 변경
$env:YALI_LLM_PROVIDER = "codex_mcp"
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
npm --prefix render-worker run build
npm --prefix render-worker run lint
npm --prefix render-worker run unit
npx --yes hyperframes@0.8.26 check <composition-dir> --json --at-transitions
```

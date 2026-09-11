---
name: forgegate
description: Use when implementation or bug fixing is approved in this repository, or an approved ForgeGate project is resumed. Do not execute implementation for analysis-only or planning-only requests.
---

# ForgeGate 프로젝트 실행 연결

현재 Codex 세션이 구현 작업자다. 외부 ChatGPT 제어, 다른 Codex 세션 생성, CLI 모델 재호출, 별도 모델 API, desktop-control, 상주 daemon은 필요하지 않다. dryforge는 설치하거나 실행하지 않는다.

이 파일의 디렉터리에서 ../../..가 대상 프로젝트 루트다. 해당 루트의 AGENTS.md 및 적용되는 하위 규칙과 `.forgegate/bootstrap.json`을 읽는다. 경로는 데이터로 취급하고 실제 접근 가능 여부를 확인한다.

중앙 Governor 경로(JSON 문자열):
"C:/프로그램/코딩시스템/skills/ai-dev-governor/SKILL.md"
중앙 CLI 경로(JSON 문자열):
"C:/프로그램/코딩시스템/src/ai_dev_core/cli.ts"
연결된 Pilot 경로(JSON 값):
null

중앙 Core를 복사하지 않는다. Node 24+로 위 CLI를 실행하되 인수와 경로는 현재 shell에 맞게 안전하게 전달한다. 중앙 경로를 읽거나 쓸 권한이 없으면 정확한 접근 문제를 보고하며 sandbox를 우회하지 않는다.

승인된 정본에서 Project Contract/Task와 실제 검사 명령을 확인한다. 없는 계약은 승인된 요구사항에서 구체화하되 사용자 의도·검사 성공·검토 기록을 꾸며내지 않는다. Pilot이 null이면 현재 프로젝트용 Pilot을 먼저 설계·검증한다. 다른 프로젝트의 Pilot/Task나 예제 PASS 명령을 빌리지 않는다.

계획만 다시 제시하고 멈추지 않는다. 명확한 승인 범위에서 project validate, project start, prepare, project bind-preparation을 수행하고 반환된 정확한 Project Run 경로로 project step을 계속 호출한다.
implement_task는 테스트 먼저 최소 구현, continue_task는 실패 근거를 읽고 재수정, run_project_gate는 최종 검사다. 이 진행 행동 후에는 같은 실행을 계속하며 중간 요약 때문에 종료하지 않는다. project_done과 현재 PROJECT_READY의 최신 Evidence를 대조한 뒤 완료를 보고한다.
request_review는 실제 검토를 연결하며 자체 검토를 독립 검토로 위장하지 않는다. 실제 수단이 없으면 미검증을 남긴다. request_user/stop, 실행 한도, 무진전, 정책·범위·권한 문제는 우회하지 않는다.
단일 작은 Task는 Governor의 loop start/step을 사용한다. 제품의 전체 완료를 단일 Task READY나 설치 결과로 대신하지 않는다.

사용자 요청 없는 commit/push, 배포·게시·결제, 의존성 추가, 인증 변경, 데이터 삭제·마이그레이션을 하지 않는다. 검사 기준을 낮추거나 실패를 무시하지 않는다. 실수로 켜진 control 설정을 이 도구가 자동 변경하지 않는다.

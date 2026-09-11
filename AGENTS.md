<!-- forgegate:bootstrap:v1 begin -->
## ForgeGate: 승인된 구현의 기본 실행 절차

기획 또는 작업 범위가 승인되고 구현·버그 수정이 승인되면 현재 Codex는 `.agents/skills/forgegate/SKILL.md`와 `.forgegate/bootstrap.json`을 먼저 읽고 중앙 Governor를 따른다.
분석·기획만 요청한 경우 구현하지 않는다. 기존 규칙과 사용자 변경을 보존하고, 규칙의 의미 충돌은 임의로 덮어쓰거나 완화하지 않는다.
여러 Task는 Project Orchestrator를 사용한다. implement_task, continue_task, run_project_gate는 중간 종료가 아니며 승인 범위에서 작업·테스트·수정 후 같은 Project Run을 계속한다. 매 Task마다 진행 승인을 다시 요구하지 않는다.
검토·권한·기준 변경·데이터 삭제·외부 작업은 승인 경계를 지킨다. 설치 성공은 테스트 PASS나 PROJECT_READY가 아니다. 실제 최신 Evidence 없이는 완료라고 보고하지 않는다.
<!-- forgegate:bootstrap:v1 end -->

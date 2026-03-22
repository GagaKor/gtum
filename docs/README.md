# 문서 / Docs

- [제품 기획서 / Product Plan](./product-plan.md)
- [기술 설계서 / Technical Design](./technical-design.md)
- [MVP 백로그 / MVP Backlog](./mvp-backlog.md)
- [스프린트 계획 / Sprint Plan](./sprint-plan.md)
- [UI/UX 개선안과 와이어프레임 / UI/UX Improvements and Wireframes](./ui-ux-wireframes.md)
- [문서 읽기 순서 / Docs Reading Order](./DOCS_READING_ORDER.md)
- [Sprint 0 체크리스트 / Sprint 0 Checklist](./sprint-0-checklist.md)
- [작업 로그 템플릿 / Worklog Template](./WORKLOG_TEMPLATE.md)
- [릴리스, 빌드, CI / Release, Build, and CI](./release-build-ci.md)
- [릴리스 워크플로우 수정 로그 / Release Workflow Fix Worklog](./WORKLOG_2026-03-22_release-workflow-fix.md)
- [Sprint 1 작업 로그 / Sprint 1 Worklog](./WORKLOG_2026-03-22_sprint-1-project-workspace.md)
- [Sprint 2 작업 로그 / Sprint 2 Worklog](./WORKLOG_2026-03-22_sprint-2-terminal-workspace.md)
- [Sprint 3 작업 로그 / Sprint 3 Worklog](./WORKLOG_2026-03-22_sprint-3-provider-auth.md)
- [Sprint 4 작업 로그 / Sprint 4 Worklog](./WORKLOG_2026-03-22_sprint-4-agent-request-flow.md)
- [Sprint 5 작업 로그 / Sprint 5 Worklog](./WORKLOG_2026-03-22_sprint-5-mvp-stabilization.md)
- [Sprint 7 작업 로그 / Sprint 7 Worklog](./WORKLOG_2026-03-22_sprint-7-ux-and-project-picker.md)
- [Telegram 프로토타입 작업 로그 / Telegram Prototype Worklog](./WORKLOG_2026-03-22_post-mvp-telegram-prototype.md)
- [MVP 검증 메모 / MVP Validation Notes](./MVP_VALIDATION_NOTES.md)
- [에이전트 운영 가이드 / Agent Operating Guide](../AGENTS.md)

## 운영 원칙 / Working Rule

- 모든 핵심 문서는 한국어와 영어를 함께 유지한다.
- 한국어와 영어는 항상 같은 의미와 최신 상태를 유지해야 한다.
- 한국어는 사람 중심, 영어는 에이전트 중심 참조 문서로 사용한다.
- 컨텍스트가 길어질 때마다 `docs/DOCS_READING_ORDER.md`를 기준으로 다시 문서를 읽는다.

## 현재 결정 / Current Decisions

- 기본 기술 스택은 `Tauri + Rust + React + TypeScript + Vite + xterm.js + Zustand`
- 지원 플랫폼은 `Ubuntu + Windows + macOS`
- 에이전트 제공자는 우선 `Codex + Claude`, 인증은 `OAuth 기반 로그인`을 우선한다
- 현재 Sprint 5 기준으로 task history, workspace restore, execution mode, aging test까지 포함한 MVP 흐름이 구현되어 있다
- Sprint 7에서는 폴더 선택기 중심 프로젝트 열기, UI 정보 구조 재배치, provider auth mock/prototype/real 구분이 반영되어 있다
- Telegram은 현재 post-MVP 브리지 프로토타입 단계로, 상태 리포트 초안, 런타임 기반 브리지 상태, 제한된 원격 명령 승인 흐름을 앱 안에서 검증한다
- 브랜치 전략은 `feature/* -> dev -> master` 흐름을 따른다
- 릴리스와 배포 정책은 `master` 머지 시 자동 GitHub Release를 생성하는 방향으로 `docs/release-build-ci.md`를 기준으로 한다
- 스프린트 종료 시 `Playwright` 기반 UI E2E와 다음 스프린트 작업 추가를 함께 진행한다

# 문서 / Docs

- [제품 기획서 / Product Plan](./product-plan.md)
- [기술 설계서 / Technical Design](./technical-design.md)
- [MVP 백로그 / MVP Backlog](./mvp-backlog.md)
- [스프린트 계획 / Sprint Plan](./sprint-plan.md)
- [문서 읽기 순서 / Docs Reading Order](./DOCS_READING_ORDER.md)
- [Sprint 0 체크리스트 / Sprint 0 Checklist](./sprint-0-checklist.md)
- [작업 로그 템플릿 / Worklog Template](./WORKLOG_TEMPLATE.md)
- [Sprint 1 작업 로그 / Sprint 1 Worklog](./WORKLOG_2026-03-22_sprint-1-project-workspace.md)
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
- 브랜치 전략은 현재 `master`에서 시작하지만 운영 개념은 `git flow` 기반으로 확장한다
- 스프린트 종료 시 `Playwright` 기반 UI E2E와 다음 스프린트 작업 추가를 함께 진행한다

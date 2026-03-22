# 문서 / Docs

- [제품 기획서 / Product Plan](./product-plan.md)
- [기술 설계서 / Technical Design](./technical-design.md)
- [에이전트 운영 가이드 / Agent Operating Guide](../AGENTS.md)

## 운영 원칙 / Working Rule

- 모든 핵심 문서는 한국어와 영어를 함께 유지한다.
- 한국어와 영어는 항상 같은 의미와 최신 상태를 유지해야 한다.
- 한국어는 사람 중심, 영어는 에이전트 중심 참조 문서로 사용한다.

## 현재 결정 / Current Decisions

- 기본 기술 스택은 `Tauri + Rust + React + TypeScript + Vite + xterm.js + Zustand`
- 지원 플랫폼은 `Ubuntu + Windows + macOS`
- 에이전트 제공자는 우선 `Codex + Claude`, 인증은 `OAuth 기반 로그인`을 우선한다
- 브랜치 전략은 현재 `master`에서 시작하지만 운영 개념은 `git flow` 기반으로 확장한다

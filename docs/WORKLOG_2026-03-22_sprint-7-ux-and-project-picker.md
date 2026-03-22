# Sprint 7 작업 로그 / Sprint 7 Worklog

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `Sprint 7`에서 진행한 UI/UX 구조 개선, 프로젝트 열기 UX 개편, provider auth 표현 정리 작업을 기록한다.

### English

This document records the `Sprint 7` work for UI/UX restructuring, project-open UX improvements, and provider-auth presentation cleanup.

## 이번 스프린트에서 한 일 / What Changed In This Sprint

### 한국어

- `Open Project`의 기본 흐름을 경로 입력보다 `Open Folder` 중심으로 바꿨다.
- 수동 경로 입력은 기본 UI가 아니라 `Manual Path Fallback` 아래로 내렸다.
- 좌측 패널에 시작 CTA, 최근 프로젝트, 저장소 요약, 파일 트리를 모았다.
- 중앙 영역은 터미널과 활성 로그 요약을 중심으로 재정렬했다.
- 우측 패널은 에이전트 요청, provider 상태, suggestion 검토 흐름 위주로 정리했다.
- `Task History`, `Telegram`, `Runtime / Debug`는 하단 접이식 지원 패널로 내렸다.
- provider 카드에 `Mock`, `Prototype`, `Real` 상태 뱃지를 추가하고, 연결 상태도 사용자 친화적 문구로 바꿨다.
- raw callback URL은 기본 카드에서 제거하고 `Diagnostics` disclosure 안으로 이동시켰다.
- Playwright E2E를 새 레이아웃과 폴더 선택 중심 흐름에 맞게 갱신했다.

### English

- shifted the default project-open flow from manual path entry to `Open Folder`
- moved manual path entry into a secondary `Manual Path Fallback`
- consolidated the left panel around start CTA, recent projects, repository summary, and file tree
- reorganized the center area around the terminal and active-log summary
- narrowed the right panel around agent requests, provider state, and suggestion review
- moved `Task History`, `Telegram`, and `Runtime / Debug` into collapsible support panels
- added `Mock`, `Prototype`, and `Real` badges to provider cards with more user-friendly connection wording
- removed raw callback URLs from default cards and moved them into `Diagnostics` disclosures
- updated Playwright E2E coverage for the new layout and folder-picker-centered flow

## 검증 / Verification

### 한국어

아래 검증을 통과했다.

- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `cargo check --manifest-path src-tauri/Cargo.toml`

### English

The following checks passed:

- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `cargo check --manifest-path src-tauri/Cargo.toml`

## 다음 스프린트로 넘길 항목 / Handoff To Next Sprint

### 한국어

- backend auth snapshot에 `connection_kind` 또는 `auth_mode` 같은 명시 필드를 추가해 frontend heuristic을 줄인다.
- 최소 1개 provider에 대해 실제 OAuth 또는 공식 로그인 흐름 검토를 코드/문서 기준으로 구체화한다.
- 실제 provider request/response contract를 문서화하고 mock suggestion 생성 로직을 대체한다.
- auto update를 Tauri updater 기준으로 실제 구현 단계에 올린다.
- Windows 실기 기준 callback 처리와 deep-link 동작을 다시 검증한다.

### English

- add explicit backend fields such as `connection_kind` or `auth_mode` to reduce frontend heuristics
- concretize real OAuth or official-login feasibility for at least one provider in code and docs
- document the real provider request/response contract and replace mock suggestion generation
- move auto update from specification into Tauri updater implementation
- re-validate callback and deep-link behavior on real Windows devices

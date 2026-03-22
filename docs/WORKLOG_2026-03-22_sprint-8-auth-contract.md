# Sprint 8 작업 로그 / Sprint 8 Worklog

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `Sprint 8`의 첫 작업으로 진행한 provider auth 계약 명시화 작업을 기록한다.

### English

This document records the first `Sprint 8` task, which makes the provider-auth contract more explicit.

## 이번 작업의 초점 / Focus Of This Slice

### 한국어

Sprint 7에서는 frontend가 `mock / prototype / real`을 URL과 런타임 조건으로 추측했다. Sprint 8에서는 이 추측을 줄이기 위해 auth snapshot에 명시 필드를 추가했다.

- backend snapshot에 `connectionKind`를 추가
- mock runtime은 `mock`
- Tauri runtime auth snapshot은 현재 `prototype`
- frontend provider badge는 이제 추측 대신 `connectionKind`를 기준으로 렌더링

### English

In Sprint 7, the frontend inferred `mock / prototype / real` from URLs and runtime conditions. This Sprint 8 slice reduces that guessing by adding an explicit auth field to the snapshot.

- added `connectionKind` to the backend snapshot
- mock runtime uses `mock`
- the current Tauri runtime auth snapshot uses `prototype`
- frontend provider badges now render from `connectionKind` instead of heuristics

## 검증 / Verification

### 한국어

- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `cargo check --manifest-path src-tauri/Cargo.toml`

### English

- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `cargo check --manifest-path src-tauri/Cargo.toml`

## 다음 작업 / Next Work

### 한국어

- backend에 `authMode` 또는 동등한 세부 필드를 추가할지 결정
- 최소 1개 provider에 대해 실제 OAuth 또는 공식 로그인 가능성 검토를 코드와 문서 기준으로 진행
- mock suggestion 생성 대신 실제 provider request/response contract 초안을 추가

### English

- decide whether to add `authMode` or an equivalent detailed backend field
- evaluate real OAuth or official-login feasibility for at least one provider
- replace mock suggestion generation with a first real provider request/response contract draft

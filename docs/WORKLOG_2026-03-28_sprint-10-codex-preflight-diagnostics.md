# Sprint 10 작업 로그 / Sprint 10 Worklog

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `Sprint 10`의 첫 구현 슬라이스로 진행한 real `Codex` 연결 안정화 작업을 기록한다.

### English

This document records the first implementation slice of `Sprint 10`, focused on stabilizing the real `Codex` connection path.

## 이번 작업의 초점 / Focus Of This Slice

### 한국어

이번 슬라이스는 `Codex` real 경로를 실제 사용 가능한 연결 흐름에 더 가깝게 만드는 데 초점을 뒀다.

- connect 시 env-backed `Codex` 설정을 preflight로 검증
- provider diagnostics를 런타임 계약과 UI에 노출
- 앱 재시작 뒤 stale real-provider 상태가 남지 않도록 연결 상태 재검증
- 활성 로그 최근 50줄 자동 첨부 기준을 UI와 E2E에서 더 분명하게 확인

### English

This slice focused on making the real `Codex` path behave more like a usable daily-use connection flow.

- validate env-backed `Codex` setup through preflight at connect time
- expose provider diagnostics through both the runtime contract and the UI
- revalidate real-provider state so stale connected sessions do not survive app restart unchecked
- make the latest-50-line active-log attachment rule clearer in the UI and E2E coverage

## 변경 내용 / What Changed

### 한국어

- `src-tauri`에 `read_agent_provider_diagnostics` command와 `Codex` diagnostics 구조를 추가했다.
- `begin_agent_login`의 `Codex` real path가 connect 시 preflight 결과를 반영하도록 바꿨다.
- 저장된 real `Codex` 연결은 `list_connections` 시점에 다시 검증해 stale `Connected` 상태를 줄였다.
- provider scope 기본값을 `project:read`, `terminal:read`로 정리해 프론트와 런타임 표시 계약을 맞췄다.
- 프론트에 provider diagnostics disclosure, setup-state badge, base URL/model 표시를 추가했다.
- `Playwright` provider-auth 시나리오를 diagnostics와 disconnect gating까지 확인하도록 보강했다.
- `product-plan`, `technical-design`, `mvp-backlog`, `sprint-plan`, `MVP_VALIDATION_NOTES`를 현재 구현 기준으로 갱신했다.

### English

- added `read_agent_provider_diagnostics` and the `Codex` diagnostics contract in `src-tauri`
- changed the real `Codex` connect path so `begin_agent_login` reflects preflight success or failure
- revalidated stored real `Codex` connections during `list_connections` to reduce stale `Connected` state after restart
- normalized the default provider scope display to `project:read` and `terminal:read` across runtime and frontend
- added provider diagnostics disclosure, setup-state badges, and base-URL/model details in the frontend
- strengthened the `Playwright` provider-auth scenario to cover diagnostics and disconnect gating
- updated `product-plan`, `technical-design`, `mvp-backlog`, `sprint-plan`, and `MVP_VALIDATION_NOTES` to match the current implementation

## 검증 / Verification

### 한국어

- `git diff --check`: 성공
- `npm run build`: 성공
- `cargo check --manifest-path src-tauri/Cargo.toml`: 성공
- `npm run test:e2e`: 성공, `10 passed`

### English

- `git diff --check`: succeeded
- `npm run build`: succeeded
- `cargo check --manifest-path src-tauri/Cargo.toml`: succeeded
- `npm run test:e2e`: succeeded, `10 passed`

## 남은 작업 / Remaining Work

### 한국어

- 실제 `Windows` 환경에서 `Open Folder -> Connect Codex -> Ask -> Approve -> Restore` 루프를 검증해야 한다.
- connect-time preflight와 suggestion-time 요청이 모두 성공하는 실제 데스크톱 환경 증거가 아직 필요하다.
- `OPENAI_API_KEY` 누락, 401/403, 404, 네트워크 실패 같은 desktop real-path 오류는 추가 실기 또는 별도 테스트로 더 확인할 수 있다.

### English

- validate the `Open Folder -> Connect Codex -> Ask -> Approve -> Restore` loop on real `Windows` hardware
- gather real desktop evidence that both connect-time preflight and suggestion-time requests succeed together
- add more real-path evidence for desktop failures such as missing `OPENAI_API_KEY`, `401/403`, `404`, and network errors

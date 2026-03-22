# WORKLOG 2026-03-22 - Sprint 5 MVP Stabilization

## 목적 / Purpose

### 한국어

이 문서는 `Sprint 5`에서 구현한 작업 이력, 기본 워크스페이스 복원, 실행 모드, aging test, 그리고 MVP 완료 판단 근거를 기록한다.

### English

This document records the Sprint 5 implementation for task history, basic workspace restore, execution modes, aging test coverage, and the reasoning used to mark the MVP as complete.

## 구현 범위 / Implemented Scope

### 한국어

- task history 카드와 상태 기록 추가
- localStorage 기반 최근 워크스페이스 복원 추가
- `Fast`, `Balanced`, `Deep` 실행 모드 UI와 상태 반영 추가
- 반복 실행과 reload를 포함한 Playwright aging test 추가
- MVP 검증 메모 문서 추가
- Rust runtime에 workspace state manager 뼈대 추가

### English

- added task-history cards and status recording
- added localStorage-based recent workspace restore
- added `Fast`, `Balanced`, and `Deep` execution-mode UI with visible state impact
- added Playwright aging tests with repeated execution and reload
- added an MVP validation notes document
- added a Rust runtime workspace-state manager foundation

## 검증 결과 / Verification Results

### 한국어

- `npm run lint`: 성공
- `npm run build`: 성공
- `cargo check --manifest-path src-tauri/Cargo.toml`: 성공
- `npm run test:e2e`: 성공

### English

- `npm run lint`: passed
- `npm run build`: passed
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed
- `npm run test:e2e`: passed

## MVP 완료 판단 / MVP Completion Assessment

### 한국어

현재 기준으로 `gtum`은 MVP 핵심 흐름을 충족한다.

- 프로젝트 열기, 파일 트리, Git 상태: 충족
- 멀티 탭 터미널과 활성 로그 캡처: 충족
- provider 로그인 기반 연결과 mock callback 검증: 충족
- agent request -> suggestion -> approval execution: 충족
- task history, 실행 모드, 기본 restore: 충족
- UI E2E와 aging test 초안: 충족

남은 항목은 MVP 부정이 아니라 `Post-MVP` 또는 후속 안정화로 본다.

- 실제 official OAuth 연동
- 실기 기준 Windows/macOS 검증 확대
- 장시간 수동 aging test 확대
- Telegram 외부 채널 연동

### English

At the current stage, `gtum` satisfies the core MVP flows.

- project open, file tree, and Git status: satisfied
- multi-tab terminal and active-log capture: satisfied
- login-based provider connection with mock callback verification: satisfied
- agent request -> suggestion -> approval execution: satisfied
- task history, execution modes, and basic restore: satisfied
- UI E2E plus initial aging test: satisfied

The remaining items are considered post-MVP or later stabilization work rather than MVP blockers.

- real official OAuth integration
- expanded real-device Windows/macOS validation
- extended long-running manual aging testing
- Telegram external-channel integration

## 다음 단계 / Next Steps

### 한국어

MVP 이후 첫 번째 타깃은 `Sprint 6`의 `Telegram` 연동이 아니라, 실제 운영 안정성을 위해 아래 순서가 더 적절하다.

1. Windows/macOS 실기 검증 메모 보강
2. actual OAuth/official login feasibility 정리
3. runtime workspace snapshot과 frontend source of truth 정리
4. 그 다음 `Telegram` 흐름 착수

### English

After MVP, the most practical next order is:

1. strengthen Windows/macOS validation notes
2. clarify actual OAuth/official-login feasibility
3. align runtime workspace snapshots with the frontend source of truth
4. then begin the `Telegram` flow

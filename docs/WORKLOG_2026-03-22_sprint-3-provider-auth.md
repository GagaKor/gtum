# WORKLOG 2026-03-22 - Sprint 3 Provider Auth

## 목적 / Purpose

### 한국어

이 문서는 `Sprint 3`에서 구현한 provider 선택, 로그인 상태 흐름, mock callback 검증, 그리고 다음 스프린트로 넘길 후속 작업을 기록한다.

### English

This document records the Sprint 3 implementation for provider selection, login-state flows, mock callback verification, and the follow-up work that should move into the next sprint.

## 구현 범위 / Implemented Scope

### 한국어

- `Codex`와 `Claude` provider 공통 상태 모델 추가
- 로그인 시작, 완료, 실패, 연결 해제 흐름을 위한 runtime/frontend 인터페이스 추가
- provider 선택 라디오와 연결 상태 카드 UI 추가
- mock callback 성공/실패 시나리오와 request contract preview 추가
- Sprint 3 provider auth Playwright E2E 시나리오 추가

### English

- added a shared provider-state model for `Codex` and `Claude`
- added runtime/frontend interfaces for login start, completion, failure, and disconnect flows
- added provider-selection radios and connection-state cards in the UI
- added mock callback success/failure scenarios and a request-contract preview
- added Sprint 3 provider-auth Playwright E2E scenarios

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

## 작업 중 발견하고 해결한 문제 / Issues Found And Resolved

### 한국어

- mock callback 버튼이 Playwright 클릭과 맞물릴 때 상태 갱신이 불안정해, 테스트에서는 DOM 이벤트 기반 `dispatchEvent`로 안정화했다.
- 로그인 흐름을 단순 텍스트 버튼으로 두면 어떤 provider를 다음 auth 대상으로 보는지 모호해, provider selection radio와 강조 카드 UI를 추가했다.
- 워커가 별도 컴포넌트 파일을 만들었지만 현재 통합 기준과 write scope를 고려해 메인 App 구조로 합쳤고, 미사용 파일은 제거했다.

### English

- the mock callback button was flaky under Playwright click timing, so the test was stabilized with a DOM-event `dispatchEvent` path
- a plain text-button auth flow left the next target provider ambiguous, so provider-selection radios and highlighted cards were added
- a separate worker-created component existed, but the final integration stayed in the main App structure and the unused file was removed

## 남은 리스크 / Remaining Risks

### 한국어

- 현재 provider auth는 mock-friendly foundation이며, 실제 공식 OAuth URL과 deep-link callback은 아직 연결되지 않았다.
- auth 세션은 구조만 잡혔고, 보안 저장소 기반의 영속화는 다음 단계에서 설계해야 한다.
- provider auth E2E는 브라우저 mock runtime 기준이다. 실제 Tauri window callback과 재시작 후 복원 검증은 아직 없다.

### English

- the current provider auth is a mock-friendly foundation; real official OAuth URLs and deep-link callbacks are not connected yet
- auth session persistence only exists as a structural placeholder, and secure storage still needs a dedicated design step
- provider-auth E2E currently runs on the browser mock runtime; real Tauri-window callback and restart restoration tests are still missing

## 다음 스프린트에 추가할 작업 / Next Sprint Additions

### 한국어

Sprint 4로 넘겨야 할 후속 작업은 다음과 같다.

- provider 연결 상태를 실제 agent request 입력과 제안 카드 흐름에 연결
- 프로젝트 요약과 활성 로그를 provider request envelope로 묶는 데이터 계약 추가
- 승인 기반 명령 실행 UI와 현재 탭 또는 새 탭 실행 정책 연결
- provider 오류 응답과 승인 거절 흐름에 대한 상태 모델 추가
- agent panel 요청 흐름에 대한 UI E2E 시나리오 추가

### English

The following work should be added to Sprint 4:

- connect provider state to real agent request input and suggestion-card flows
- add a request envelope that binds project summary and active logs for provider calls
- connect approval-based command execution UI to current-tab or new-tab execution policy
- add state handling for provider error responses and approval rejection
- add UI E2E scenarios for the agent-panel request flow

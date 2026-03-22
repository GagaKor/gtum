# WORKLOG 2026-03-22 - Sprint 4 Agent Request Flow

## 목적 / Purpose

### 한국어

이 문서는 `Sprint 4`에서 구현한 에이전트 요청 입력, suggestion 카드, 승인 기반 터미널 실행, 그리고 관련 검증 결과를 기록한다.

### English

This document records the Sprint 4 implementation for agent request input, suggestion cards, approval-based terminal execution, and the related verification results.

## 구현 범위 / Implemented Scope

### 한국어

- provider 연결 상태를 전제로 한 에이전트 요청 입력 패널 추가
- 프로젝트 메타데이터, 활성 터미널, 캡처된 로그를 suggestion 생성 흐름에 연결
- suggestion 카드와 승인 액션 추가
  - 현재 탭 승인
  - 새 탭 승인
- Tauri runtime에 기존 PTY 세션으로 명령을 주입하는 실행 command 추가
- Sprint 4 agent request Playwright E2E 시나리오 추가

### English

- added an agent request input panel gated by provider connection state
- connected project metadata, active terminal, and captured logs into the suggestion-generation flow
- added suggestion cards with approval actions
  - approve in current tab
  - approve in new tab
- added a Tauri runtime command that can submit a command into an existing PTY session
- added a Sprint 4 Playwright E2E scenario for the agent request flow

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

- Sprint 4 문맥으로 넘어오면서 provider auth 실패 E2E의 기대 문구가 뒤처져 있어 테스트를 `Sprint 4` 기준으로 갱신했다.
- 승인 실행이 처음에는 mock append에만 머물렀기 때문에, 실제 PTY 세션에 명령을 쓰는 runtime command를 추가해 current-tab 승인 흐름을 현실적인 방향으로 보강했다.
- mock runtime과 실제 runtime 사이에서 같은 승인 UX를 유지할 수 있도록, 프론트엔드는 실행 타깃만 결정하고 실제 명령 주입은 runtime 경계로 넘기는 방향으로 정리했다.

### English

- one provider-auth E2E assertion still expected Sprint 3 wording, so it was updated to the Sprint 4 context
- approval execution initially only appended mock logs, so a runtime command was added to write commands into real PTY sessions for the current-tab path
- to keep the same approval UX across mock and real runtimes, the frontend now decides the execution target while the actual command submission is delegated to the runtime boundary

## 남은 리스크 / Remaining Risks

### 한국어

- suggestion 생성은 아직 규칙 기반 mock이며, 실제 provider 응답 정규화는 다음 단계에서 adapter 계층으로 끌어올려야 한다.
- 승인 실행은 현재 command injection 중심이라, 명령 히스토리와 재시도 정책은 아직 없다.
- agent request, suggestion, approval 상태가 아직 `App.tsx`에 많이 모여 있어 Sprint 5 이전에 feature 단위 분리가 필요하다.

### English

- suggestion generation is still rule-based mock logic, and real provider response normalization should move into an adapter layer later
- approval execution currently focuses on command injection and does not yet include command history or retry policy
- agent request, suggestion, and approval state is still heavily concentrated in `App.tsx`, so a feature-level split is recommended before Sprint 5

## 다음 스프린트에 추가할 작업 / Next Sprint Additions

### 한국어

Sprint 5로 넘겨야 할 후속 작업은 다음과 같다.

- 작업 이력과 최근 승인 실행 결과를 저장하고 다시 표시
- 워크스페이스와 선택된 provider 상태의 기본 복원
- `fast`, `balanced`, `deep` 실행 모드 초안과 표시 UI 추가
- Playwright 기반 aging test 초안 추가
- Ubuntu, Windows, macOS 차이와 제약 사항 문서화

### English

The following work should be added to Sprint 5:

- store and display task history plus recent approval execution results
- restore basic workspace and selected provider state
- add first-pass `fast`, `balanced`, and `deep` execution modes with visible UI state
- add an initial Playwright-based aging-test draft
- document Ubuntu, Windows, and macOS differences and limitations

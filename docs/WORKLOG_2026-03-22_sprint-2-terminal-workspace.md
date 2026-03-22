# WORKLOG 2026-03-22 - Sprint 2 Terminal Workspace

## 목적 / Purpose

### 한국어

이 문서는 `Sprint 2`에서 구현한 멀티 탭 터미널 워크스페이스, 활성 로그 캡처, 그리고 관련 검증 결과를 기록한다.

### English

This document records the Sprint 2 implementation and verification for the multi-tab terminal workspace, active-log capture flow, and related validation.

## 구현 범위 / Implemented Scope

### 한국어

- Tauri runtime에 PTY 기반 터미널 세션 생성, 목록 조회, 이름 변경, 종료, 최근 로그 읽기 command 추가
- 플랫폼별 셸 후보 선택과 기본 작업 디렉토리 정규화 로직 연결
- 프론트엔드에서 멀티 탭 터미널 세션 표시와 활성 탭 선택 흐름 추가
- 활성 탭 최근 로그를 에이전트 컨텍스트로 승격하는 상태 모델 추가
- 브라우저 mock runtime 기준 Sprint 2 UI E2E 시나리오 추가

### English

- added PTY-backed runtime commands for terminal session creation, listing, renaming, closing, and recent-log reading
- connected shell-candidate selection and working-directory normalization across platform helpers
- added frontend rendering for multi-tab terminal sessions and active-tab selection
- added a state flow that promotes recent lines from the active terminal into agent context
- added a browser mock-runtime UI E2E scenario for Sprint 2

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

- 이전 시도에서 남은 `src/features/terminals/terminal-workspace.tsx`가 현재 스토어 타입과 맞지 않아 TypeScript 빌드를 깨고 있었다.
- Playwright 기준 프로젝트 경로 입력이 제어 컴포넌트와 맞물리며 불안정해, 테스트에서 DOM setter 기반 입력 헬퍼로 안정화했다.
- PTY 런타임 쪽은 reaper thread 생성 실패 시 세션이 맵에 남을 수 있는 경로를 점검했고, 세션 정리 경로를 보강했다.

### English

- a leftover `src/features/terminals/terminal-workspace.tsx` from an earlier attempt no longer matched the current store types and broke TypeScript builds
- the project-path field was flaky under Playwright because of controlled-input interaction, so the tests were stabilized with a DOM-setter helper
- on the PTY runtime side, the session cleanup path around reaper-thread startup was reviewed and hardened

## 남은 리스크 / Remaining Risks

### 한국어

- 현재 터미널은 최근 로그 읽기와 세션 관리를 중심으로 완성되어 있으며, 입력 전송과 resize는 아직 없다.
- UI E2E는 mock runtime 기준이라 실제 데스크톱 Tauri 창에서의 PTY 상호작용과 완전히 동일하지는 않다.
- 세션 상태는 in-memory라 앱 재시작 후 복원되지 않는다.
- 크로스 플랫폼 셸 후보 추상화는 들어갔지만, Windows와 macOS 실기 검증은 아직 남아 있다.

### English

- the current terminal flow is complete around session management and recent-log reading, but input sending and resize are not implemented yet
- the UI E2E currently runs against a mock runtime, so it is not identical to full desktop PTY interaction inside Tauri
- session state is still in-memory and is not restored after an app restart
- shell-candidate abstraction exists, but real-device validation for Windows and macOS is still pending

## 다음 스프린트에 추가할 작업 / Next Sprint Additions

### 한국어

Sprint 3로 넘겨야 할 후속 작업은 다음과 같다.

- `Codex`와 `Claude` provider 선택 UI 초안 추가
- 로그인 시작, 콜백 수신, 성공/실패 상태 모델 정의
- provider 공통 인터페이스와 세션 저장 구조 초안 수립
- 프로젝트 컨텍스트와 활성 로그 컨텍스트를 향후 provider 요청에 붙일 데이터 계약 정의
- 로그인 연결 흐름에 대한 UI E2E 또는 mock auth 검증 시나리오 추가

### English

The following work should be added to Sprint 3:

- add an initial provider selection UI for `Codex` and `Claude`
- define the state model for login start, callback receipt, and success/failure outcomes
- establish the first shared provider interface and session storage structure
- define the request contract that will later attach project context and active-log context to provider calls
- add UI E2E or mock-auth verification for the login connection flow

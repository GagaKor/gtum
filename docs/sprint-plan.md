# gtum 스프린트 계획 / Sprint Plan

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `docs/mvp-backlog.md`를 바탕으로 `gtum`의 MVP 개발을 실제 스프린트 단위로 나눈 실행 계획 문서다.

이 문서의 목적은 다음과 같다.

- MVP 백로그를 구현 순서에 맞게 묶는다.
- 각 스프린트의 목표와 산출물을 분명히 한다.
- 의존성과 리스크를 앞당겨 검증한다.
- 사람과 에이전트가 같은 개발 리듬으로 움직일 수 있게 한다.

### English

This document turns `docs/mvp-backlog.md` into a sprint-by-sprint execution plan for the `gtum` MVP.

Its purpose is to:

- group backlog items into delivery order
- define sprint goals and deliverables clearly
- validate dependencies and risks early
- give humans and agents a shared implementation rhythm

## 계획 원칙 / Planning Principles

### 한국어

- `P0` 항목을 먼저 잠근다.
- 리스크가 큰 항목은 가능한 한 초반 스프린트에서 검증한다.
- "에이전트 UI"보다 "활성 터미널 로그를 읽고 연결하는 흐름"을 더 우선한다.
- 스프린트마다 사용자에게 보이는 가치가 하나 이상 있어야 한다.
- 각 스프린트는 다음 스프린트의 기반을 남겨야 한다.
- 각 스프린트의 마지막에는 가능한 범위의 UI E2E 검증을 추가하거나 갱신한다.
- 각 스프린트의 마지막에는 새로 발견된 후속 작업을 다음 스프린트 문서나 백로그에 추가한다.

### English

- lock down `P0` items first
- validate high-risk items as early as possible
- prioritize "reading and attaching live terminal logs" above superficial agent UI polish
- each sprint should deliver at least one visible user-facing value
- each sprint should leave a clean foundation for the next one
- finish each sprint with a practical UI E2E pass added or updated for the delivered flow
- finish each sprint by adding newly discovered follow-up work into the next sprint plan or backlog

## 스프린트 종료 규칙 / Sprint Closing Rules

### 한국어

각 스프린트는 아래를 만족해야 닫힌다.

1. 현재 스프린트 목표 구현 또는 명시적 블로커 기록
2. 관련 문서와 작업 로그 동기화
3. 해당 스프린트 UI E2E 검증 추가 또는 갱신
4. 다음 스프린트에 들어가야 할 작업 항목 추가

이때 다음 스프린트 작업은 아래 중 한 곳 이상에 반영한다.

- `docs/mvp-backlog.md`
- `docs/sprint-plan.md`
- 해당 스프린트 체크리스트
- 최신 `WORKLOG`

### English

Each sprint should be considered closed only when it includes:

1. implementation of the sprint goal or an explicit blocker record
2. synchronized docs and worklog updates
3. added or updated UI E2E coverage for that sprint
4. newly discovered work items added for the next sprint

Those next-sprint items should be written into at least one of:

- `docs/mvp-backlog.md`
- `docs/sprint-plan.md`
- the relevant sprint checklist
- the latest `WORKLOG`

## MVP 스프린트 개요 / MVP Sprint Overview

### 한국어

- `Sprint 0`
  - 개발 기반과 앱 셸
- `Sprint 1`
  - 프로젝트 열기, 파일 탐색, Git 상태
- `Sprint 2`
  - 멀티 탭 터미널과 활성 로그 기반 작업 흐름
- `Sprint 3`
  - 에이전트 로그인 연결과 provider 추상화
- `Sprint 4`
  - 에이전트 패널, 컨텍스트 읽기, 승인 기반 실행
- `Sprint 5`
  - 작업 이력, 워크스페이스 저장, 실행 모드, 크로스 플랫폼 검증, aging test
- `Sprint 6`
  - Post-MVP: Telegram 리포트와 제한된 원격 명령

### English

- `Sprint 0`
  - foundation and app shell
- `Sprint 1`
  - project open, file exploration, and Git state
- `Sprint 2`
  - multi-tab terminal and active-log workflow
- `Sprint 3`
  - agent login connection and provider abstraction
- `Sprint 4`
  - agent panel, context reading, and approval-based execution
- `Sprint 5`
  - task history, workspace persistence, execution modes, cross-platform validation, and aging test
- `Sprint 6`
  - Post-MVP: Telegram reporting and limited remote commands

## Sprint 0

### 한국어

목표:

- 앱이 실행되고, 이후 기능을 올릴 수 있는 개발 기반을 만든다.

포함 범위:

- Tauri + React + Vite 초기화
- 기본 레이아웃
- Zustand 스토어 기본 구조
- Tauri command 통신 확인
- 개발 스크립트 정리

완료조건:

- 앱이 로컬에서 실행된다.
- 좌측, 중앙, 우측 패널 레이아웃이 뜬다.
- 프론트엔드와 Tauri 런타임 간 기본 통신이 된다.
- 기본 앱 셸 smoke test를 E2E 기준으로 실행할 수 있다.

리스크:

- Tauri와 프론트엔드 통합 기본 구조
- 향후 PTY와 auth를 수용할 수 있는 폴더 구조

### English

Goal:

- create the execution foundation that all later features will build on

Scope:

- bootstrap Tauri + React + Vite
- establish base layout
- initialize Zustand store structure
- verify Tauri command communication
- define development scripts

Acceptance Criteria:

- the app runs locally
- left, center, and right panel layout is visible
- basic frontend-to-runtime communication works
- a basic app-shell smoke test can run as E2E coverage

Risks:

- base Tauri/frontend integration
- folder structure flexibility for future PTY and auth work

## Sprint 1

### 한국어

목표:

- 프로젝트를 열고 코드와 저장소 상태를 읽는 기본 작업 공간을 만든다.

포함 범위:

- 프로젝트 열기
- 최근 프로젝트 목록
- 파일 트리 표시
- 프로젝트 메타데이터 표시
- 현재 Git 브랜치와 dirty state 표시

완료조건:

- 사용자가 로컬 프로젝트를 열고 다시 진입할 수 있다.
- 파일 트리가 정상적으로 표시된다.
- 현재 브랜치와 변경 상태가 UI에서 보인다.
- 프로젝트 열기와 Git 상태 표시 흐름이 UI E2E로 검증된다.

리스크:

- 파일 시스템 접근 권한
- 플랫폼별 경로 처리
- Git 상태 읽기 구조

### English

Goal:

- create the basic workspace for opening projects and reading repository state

Scope:

- open local projects
- recent project list
- file tree display
- project metadata display
- current Git branch and dirty-state visibility

Acceptance Criteria:

- users can open and re-enter local projects
- the file tree renders correctly
- current branch and working-tree state are visible in the UI
- the project-open and Git-status flow is covered by UI E2E verification

Risks:

- filesystem access permissions
- cross-platform path handling
- Git state read model

## Sprint 2

### 한국어

목표:

- `gtum`의 핵심 차별점인 멀티 탭 터미널과 활성 로그 활용 흐름을 만든다.

포함 범위:

- PTY 기반 멀티 탭 터미널
- 탭 생성, 이름 변경, 종료
- 터미널 출력 렌더링
- 활성 탭 로그 추출 구조
- 테스트 중인 터미널 로그를 컨텍스트로 넘길 준비

완료조건:

- 여러 개의 터미널 탭을 동시에 사용할 수 있다.
- 각 탭은 독립적인 셸 세션을 가진다.
- 활성 탭 최근 로그를 프로그램적으로 읽을 수 있다.
- "현재 테스트 로그를 가져온다"는 개념이 런타임과 상태 모델에 반영된다.

리스크:

- PTY 안정성
- Windows 셸 처리
- 로그 버퍼 성능

### English

Goal:

- deliver the core differentiator of `gtum`: multi-tab terminals plus active log workflow

Scope:

- PTY-backed multi-tab terminal
- create, rename, and close tabs
- terminal output rendering
- active-tab log extraction
- prepare live testing logs to become agent context

Acceptance Criteria:

- users can work with multiple terminal tabs simultaneously
- each tab has its own shell session
- recent logs from the active tab can be read programmatically
- the concept of "attach current testing logs" exists in the runtime and state model

Risks:

- PTY stability
- Windows shell handling
- log buffer performance

Sprint 2 completion update:

- runtime commands for PTY-backed terminal session lifecycle are now implemented
- the frontend can create, rename, close, and inspect terminal sessions
- active terminal logs can be captured into agent context
- a Playwright E2E scenario now covers the multi-tab terminal flow in mock runtime
- the next sprint should focus on provider login, callback state, and request contracts that can consume the captured terminal context

## Sprint 3

### 한국어

목표:

- Codex와 Claude를 로그인 기반으로 연결할 수 있는 기반을 만든다.

포함 범위:

- provider 선택 UI 초안
- 로그인 시작 흐름
- OAuth 또는 공식 로그인 콜백 구조
- 세션 저장 기본 구조
- provider 공통 인터페이스 초안
- 프로젝트 컨텍스트와 활성 로그 컨텍스트를 provider 요청 계약에 연결할 준비

완료조건:

- 사용자가 `Codex` 또는 `Claude` 연결을 시작할 수 있다.
- 로그인 완료 상태 또는 실패 상태를 UI에 반영할 수 있다.
- 애플리케이션 레이어에서 공통 provider interface를 인식한다.

리스크:

- 실제 공식 로그인 통합 가능성
- 데스크톱 앱 콜백 처리
- 세션 저장 보안성

### English

Goal:

- establish the login-based connection foundation for Codex and Claude

Scope:

- initial provider selection UI
- login initiation flow
- OAuth or official sign-in callback structure
- base session persistence structure
- first shared provider interface
- preparation for attaching project context and active-log context into provider request contracts

Acceptance Criteria:

- users can start connection for `Codex` or `Claude`
- login success and failure states can be reflected in the UI
- the application layer recognizes a shared provider interface

Risks:

- feasibility of official sign-in integration
- desktop callback handling
- secure session persistence

Sprint 3 completion update:

- provider selection UI and connection cards are now available for Codex and Claude
- the runtime and frontend share login start, completion, failure, and disconnect interfaces
- mock callback success and failure are covered by Playwright E2E
- a request-contract preview now shows how active project and terminal context will be handed to future agent requests
- the next sprint should connect provider state to agent request input, suggestion cards, and approval-based execution

## Sprint 4

### 한국어

목표:

- 에이전트가 프로젝트와 활성 터미널 로그를 읽고, 승인 기반으로 제안을 실행하는 흐름을 만든다.

포함 범위:

- 에이전트 패널 UI
- 작업 요청 입력
- 프로젝트 컨텍스트 읽기
- 활성 탭 로그 전달
- provider 연결 상태 반영
- 제안 카드 UI
- 승인 기반 명령 실행

완료조건:

- 사용자가 에이전트 패널에서 작업을 요청할 수 있다.
- 에이전트 요청에 프로젝트와 활성 로그 컨텍스트가 포함된다.
- 제안된 명령은 승인 후 현재 탭 또는 새 탭에서 실행된다.

리스크:

- provider 응답 정규화
- 승인 UX 설계
- 컨텍스트 길이 제한

### English

Goal:

- enable the agent flow that reads project context and active terminal logs, then executes suggestions through approval

Scope:

- agent panel UI
- task request input
- project context reading
- active-tab log attachment
- provider connection-state usage
- suggestion card UI
- approval-based command execution

Acceptance Criteria:

- users can submit work requests from the agent panel
- agent requests include project context and active logs
- suggested commands execute only after approval in the current tab or a new tab

Risks:

- provider response normalization
- approval UX design
- context length limits

## Sprint 5

### 한국어

목표:

- MVP를 데모 가능 상태로 안정화한다.

포함 범위:

- 작업 이력과 상태 표시
- 워크스페이스 기본 저장/복원
- `fast`, `balanced`, `deep` 초기 적용
- Ubuntu, Windows, macOS 기준 검증
- 알려진 제약 문서화

완료조건:

- 사용자가 최근 작업과 상태를 확인할 수 있다.
- 최근 워크스페이스 상태가 기본적으로 복원된다.
- 실행 모드에 따라 컨텍스트 또는 워커 정책이 달라진다.
- 세 플랫폼에 대한 검증 메모 또는 제한사항이 정리된다.

리스크:

- 세션 복원 난이도
- 플랫폼별 차이
- 실행 모드 정책의 일관성

### English

Goal:

- stabilize the MVP into a demo-ready state

Scope:

- task history and status display
- basic workspace persistence and restore
- initial `fast`, `balanced`, `deep` mode support
- Ubuntu, Windows, and macOS validation
- documentation of known limitations

Acceptance Criteria:

- users can inspect recent tasks and status
- basic workspace state is restored
- execution modes change context or worker policy
- validation notes or known constraints are documented for all three platforms

Risks:

- session restoration complexity
- platform-specific behavior
- consistency of execution-mode policy

## Sprint 6

### 한국어

목표:

- `Telegram`을 통한 외부 상태 리포트와 제한된 원격 명령 흐름을 추가한다.

단계:

- `Post-MVP`

포함 범위:

- 외부 채널 adapter 구조
- `Telegram` 연동 초안
- 작업 상태 리포트 발송
- 제한된 원격 명령 정책

완료조건:

- 최소한 하나의 외부 채널로 작업 상태 리포트를 보낼 수 있다.
- 승인 없이 허용되는 원격 명령 범위가 문서화되고 시스템에 반영된다.
- 민감한 명령은 제한되거나 추가 승인 절차를 요구한다.

리스크:

- 외부 채널 인증과 신뢰 경계
- 메시지 기반 명령의 오남용 가능성
- Telegram 채널 정책과 앱 승인 흐름의 정합성

### English

Goal:

- add external status reporting and limited remote-command flows through `Telegram`

Phase:

- `Post-MVP`

Scope:

- external channel adapter structure
- initial `Telegram` integration
- task-status report delivery
- restricted remote-command policy

Acceptance Criteria:

- at least one external channel can receive task status reports
- the remotely allowed command set is documented and enforced
- sensitive commands are restricted or require extra approval

Risks:

- authentication and trust boundaries for external channels
- misuse risk for message-based commands
- consistency between Telegram command policy and app approval flow

## 스프린트 간 의존성 / Cross-Sprint Dependencies

### 한국어

- `Sprint 2`는 `Sprint 0`의 앱 셸과 `Sprint 1`의 프로젝트 열기 구조가 필요하다.
- `Sprint 3`는 `Sprint 0`의 런타임 통신 구조가 필요하다.
- `Sprint 4`는 `Sprint 2`의 활성 로그 읽기와 `Sprint 3`의 provider 연결이 필요하다.
- `Sprint 5`는 앞선 모든 스프린트 결과를 통합하는 단계다.
- `Sprint 6`는 `Sprint 4`의 승인 흐름과 `Sprint 5`의 작업 상태 모델이 필요하다.

### English

- `Sprint 2` depends on the app shell from `Sprint 0` and project open flow from `Sprint 1`
- `Sprint 3` depends on the runtime communication model from `Sprint 0`
- `Sprint 4` depends on active log reading from `Sprint 2` and provider connection from `Sprint 3`
- `Sprint 5` integrates and stabilizes results from all previous sprints
- `Sprint 6` depends on the approval flow from `Sprint 4` and the task-state model from `Sprint 5`

## 스프린트별 성공 질문 / Sprint Success Questions

### 한국어

- `Sprint 0`
  - 앱 뼈대가 이후 확장을 감당할 만큼 정리되었는가
- `Sprint 1`
  - 사용자가 프로젝트와 코드 구조를 읽기 시작할 수 있는가
- `Sprint 2`
  - 테스트 중인 로그를 실제 앱 맥락 안에서 붙잡을 수 있는가
- `Sprint 3`
  - API 토큰 없이 provider 연결 방향이 성립하는가
- `Sprint 4`
  - 코드와 활성 로그를 읽는 에이전트 흐름이 실제로 동작하는가
- `Sprint 5`
  - MVP 데모에서 `gtum`의 차별점이 분명하게 드러나는가
- `Sprint 6`
  - 데스크톱 밖에서도 안전하게 상태를 보고 제한된 명령을 보낼 수 있는가

### English

- `Sprint 0`
  - is the app foundation organized enough to support later expansion
- `Sprint 1`
  - can users begin reading projects and code structure in the workspace
- `Sprint 2`
  - can the app truly capture live testing logs as working context
- `Sprint 3`
  - is provider connection feasible without manual API tokens
- `Sprint 4`
  - does the agent flow truly work with code and active logs together
- `Sprint 5`
  - does the MVP demo clearly show what makes `gtum` different
- `Sprint 6`
  - can users safely inspect status and send limited commands outside the desktop app

## 다음 실행 추천 / Recommended Next Action

### 한국어

다음 단계로는 `Sprint 0`를 실제 작업 항목으로 더 세분화한 `implementation checklist` 또는 `worklog` 문서를 만드는 것이 좋다.

### English

The next step should be to break `Sprint 0` into an implementation checklist or worklog-style task document.

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

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 지금 무엇을 먼저 만들지, 어떤 스프린트가 현재 기준인지 확인해야 할 때
- 산출물, 종료 기준, 다음 스프린트로 넘길 작업을 정해야 할 때

### English

Read this document when:

- you need to determine what should be built next or which sprint is the active planning baseline
- you need to confirm deliverables, closing criteria, or handoff into the next sprint

## 계획 원칙 / Planning Principles

### 한국어

- `P0` 항목을 먼저 잠근다.
- 리스크가 큰 항목은 가능한 한 초반 스프린트에서 검증한다.
- "에이전트 UI"보다 "활성 터미널 로그를 읽고 연결하는 흐름"을 더 우선한다.
- 스프린트마다 사용자에게 보이는 가치가 하나 이상 있어야 한다.
- 각 스프린트는 다음 스프린트의 기반을 남겨야 한다.
- 각 스프린트의 마지막에는 가능한 범위의 UI E2E 검증을 추가하거나 갱신한다.
- 각 스프린트의 마지막에는 새로 발견된 후속 작업을 다음 스프린트 문서나 백로그에 추가한다.
- 모든 작업은 먼저 서브에이전트를 포함한 `planner + orchestrator + designer + frontend + backend + QA + tester` 팀빌딩으로 분해하고, 예외가 있으면 `WORKLOG`에 남긴다.
- 각 스프린트 동안 `planner`와 `designer`는 다음 스프린트 초안, 레퍼런스 분석, 디자인 문서도 병렬로 남긴다.
- 각 스프린트는 이전 스프린트의 작업 경로, 실패, 우회, 반복 마찰을 검토하고 다음 개선안으로 연결해야 한다.
- `planner`와 `designer`는 최신 `WORKLOG`, task history, 검증 메모를 읽고 문제 분석 메모를 병렬 산출물로 남긴다.
- 프론트엔드 개편은 `VS Code`, `conductor`, `cmux` 레퍼런스와 `docs/frontend-design-benchmarks.md`를 기준으로 검토한다.
- 프론트엔드 구조는 사람이 아니라 에이전트가 지속적으로 수정하기 쉬운지까지 기준으로 본다.

### English

- lock down `P0` items first
- validate high-risk items as early as possible
- prioritize "reading and attaching live terminal logs" above superficial agent UI polish
- each sprint should deliver at least one visible user-facing value
- each sprint should leave a clean foundation for the next one
- finish each sprint with a practical UI E2E pass added or updated for the delivered flow
- finish each sprint by adding newly discovered follow-up work into the next sprint plan or backlog
- first decompose every task into the sub-agent split `planner + orchestrator + designer + frontend + backend + QA + tester`, record any exception in the `WORKLOG`, and keep that split whenever frontend, runtime, and validation change together
- during each sprint, `planner` and `designer` should also leave behind the next-sprint draft, reference analysis, and design documentation in parallel
- each sprint should review the prior path taken, including failures, detours, and repeated friction, and turn that into next-sprint improvements
- `planner` and `designer` should read the latest `WORKLOG`, task history, and validation notes and leave behind explicit problem-analysis notes
- review frontend redesign work against `VS Code`, `conductor`, `cmux`, and `docs/frontend-design-benchmarks.md`
- treat agent editability as a first-class frontend design and implementation constraint

## 스프린트 종료 규칙 / Sprint Closing Rules

### 한국어

각 스프린트는 아래를 만족해야 닫힌다.

1. 현재 스프린트 목표 구현 또는 명시적 블로커 기록
2. 관련 문서와 작업 로그 동기화
3. 해당 스프린트 UI E2E 검증 추가 또는 갱신
4. 다음 스프린트에 들어가야 할 작업 항목 추가
5. 이번 스프린트에서 밟은 경로, 실패, 우회, 반복 문제 요약
6. 그 문제를 다음 스프린트에서 어떻게 개선할지에 대한 `planner`와 `designer` 메모

이때 다음 스프린트 작업은 아래 중 한 곳 이상에 반영한다.

- `docs/mvp-backlog.md`
- `docs/sprint-plan.md`
- 해당 스프린트 체크리스트
- 최신 `WORKLOG`

추가로 UI와 runtime이 함께 바뀌는 스프린트라면 아래 산출물도 남겨야 한다.

- 명확한 frontend 소유 범위
- 명확한 backend 소유 범위
- planner 다음 스프린트 메모
- designer 레퍼런스/와이어프레임 메모
- QA acceptance 메모
- tester 검증 메모
- 문서나 계약이 바뀐 경우 orchestrator 통합 메모

### English

Each sprint should be considered closed only when it includes:

1. implementation of the sprint goal or an explicit blocker record
2. synchronized docs and worklog updates
3. added or updated UI E2E coverage for that sprint
4. newly discovered work items added for the next sprint
5. a summary of the path taken in the sprint, including failures, detours, and recurring friction
6. explicit `planner` and `designer` notes describing how those issues should be improved in the next sprint

Those next-sprint items should be written into at least one of:

- `docs/mvp-backlog.md`
- `docs/sprint-plan.md`
- the relevant sprint checklist
- the latest `WORKLOG`

When a sprint changes both UI and runtime behavior, it should also leave behind:

- clear frontend ownership
- clear backend ownership
- planner problem-analysis notes
- planner next-sprint notes
- designer workflow-visibility improvement notes
- designer reference or wireframe notes
- explicit QA acceptance notes
- explicit tester verification notes
- `WORKLOG`-based path recap
- orchestrator-level integration notes when docs or contracts changed

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

Sprint 4 completion update:

- the agent panel now accepts task requests tied to provider state, project context, and active logs
- suggestion cards can be reviewed and approved into the current tab or a new tab
- the runtime now supports command submission into an existing PTY session
- Playwright coverage now includes the request-to-approval agent flow
- the next sprint should focus on history, restore, execution modes, cross-platform notes, and aging validation

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
- aging test 초안 추가

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
- initial aging-test coverage

Acceptance Criteria:

- users can inspect recent tasks and status
- basic workspace state is restored
- execution modes change context or worker policy
- validation notes or known constraints are documented for all three platforms

Risks:

- session restoration complexity
- platform-specific behavior
- consistency of execution-mode policy

Sprint 5 completion update:

- task history and recent activity are now visible in the app
- the workspace restores the last project path, selected provider, execution mode, and recorded task history
- `Fast`, `Balanced`, and `Deep` modes are now visible and affect suggestion context handling
- Playwright aging coverage now repeats the core flow across reloads
- MVP validation notes are documented and the MVP can now be treated as complete

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

Sprint 6 progress update:

- a Telegram bridge prototype now exposes runtime state, report creation, and restricted remote-command approval flows
- the UI now supports Telegram draft reporting plus bridge connect/disconnect, report delivery, and pending remote-command review
- Playwright coverage now includes both Telegram report drafting and Telegram bridge execution approval
- the next step is connecting the prototype to a real Telegram transport and trust policy

## Sprint 7

### 한국어

목표:

- mock foundation을 실제 integration 방향으로 전환하면서, Windows 실사용 피드백 기준의 UX 마찰을 줄인다.

단계:

- `Post-MVP`

포함 범위:

- `Open Project`를 경로 입력 대신 네이티브 폴더 선택기로 전환
- 프로젝트, 터미널, 에이전트, 보조 패널의 정보 구조 재설계
- 핵심 작업 흐름 기준의 데스크톱 와이어프레임 정리
- provider auth UI에서 `mock`, `prototype`, `real` 상태 구분
- callback URL 직접 노출 축소 또는 제거
- 최소 1개 provider에 대한 실제 daily-use 연결 경로 착수
- agent suggestion의 실제 provider 응답 계약 초안
- Windows 실사용 기준 UX 이슈 기록

완료조건:

- 사용자가 경로를 수동 입력하지 않고 프로젝트를 열 수 있다.
- 첫 화면에서 무엇을 먼저 해야 하는지 더 쉽게 이해할 수 있다.
- 터미널이 메인 작업 영역으로 명확하게 보인다.
- provider auth가 실제 연결인지 mock인지 UI에서 즉시 구분된다.
- callback URL 같은 내부 값이 일반 사용자 UX에 그대로 노출되지 않는다.
- 다음 스프린트에서 실제 provider 연동 구현에 들어갈 수 있는 연결/response 계약이 문서 또는 코드로 정리된다.
- 정보 구조와 와이어프레임이 문서로 정리되어 구현 기준이 된다.

리스크:

- 실제 daily-use 연결 경로가 provider별로 다를 수 있다.
- 플랫폼별 폴더 선택기 동작 차이가 프로젝트 열기 UX를 다시 복잡하게 만들 수 있다.
- mock과 real 흐름이 함께 남아 있는 동안 상태 관리가 더 복잡해질 수 있다.

### English

Goal:

- begin converting mock foundations toward real integrations while reducing UX friction exposed by real Windows usage

Phase:

- `Post-MVP`

Scope:

- replace manual path entry with a native folder picker for `Open Project`
- redesign the information architecture across project, terminal, agent, and supporting panels
- document desktop wireframes around the core workflow
- distinguish `mock`, `prototype`, and `real` provider-auth states in the UI
- reduce or remove direct callback URL exposure
- begin a real daily-use connection path for at least one provider
- draft a real provider-response contract for agent suggestions
- record Windows real-usage UX issues as explicit follow-up items

Acceptance Criteria:

- users can open projects without manually typing paths
- users can understand the first action more easily from the initial screen
- the terminal is clearly presented as the main working surface
- the UI clearly distinguishes real provider connections from mock ones
- internal callback URLs are not exposed as normal end-user UX
- auth and response contracts are ready in docs or code for the next sprint to start real provider integration work
- documented information architecture and wireframes exist as implementation references

Risks:

- real daily-use connection paths may differ by provider
- platform-specific folder-picker behavior may reintroduce UX inconsistency
- mixed mock and real flows may complicate state management while both coexist

Sprint 7 initial backlog:

- `P0` replace manual project path entry with a native folder picker
- `P0` redesign the UI information hierarchy around the primary workflow
- `P0` document desktop wireframes for the main workspace states
- `P0` add explicit mock/prototype/real auth state labels
- `P0` remove raw callback URL exposure from normal provider UI
- `P0` start the real `Codex` daily-use connection path
- `P0` define a real provider request/response contract for agent suggestions
- `P1` improve active-log attachment ergonomics
- `P1` rewrite auth and runtime errors in more user-facing language
- `P1` record Windows real-device validation findings
- `P2` draft a settings panel for shell, provider, and experimental features

Sprint 7 additional CI/CD requirement:

- add an auto-update specification based on comparing the installed version against GitHub Releases
- prepare the Tauri updater path, signed updater artifacts, and `latest.json` metadata strategy
- keep the updater policy aligned with the master-merge release workflow

Sprint 7 completion update:

- the default project-open flow now uses a native folder-picker-first CTA with manual path entry demoted into a fallback disclosure
- the workspace is reorganized around a clearer hierarchy: left project rail, center terminal focus, right agent panel, and bottom support drawers
- provider cards now distinguish `Mock`, `Prototype`, and `Real` through explicit badges and friendlier connection wording
- raw callback URLs are moved out of the default provider UI and exposed only through diagnostics disclosures
- Playwright coverage is updated for the folder-picker flow and the new Telegram support-panel layout
- the next sprint should reduce frontend heuristics by adding explicit backend auth-mode metadata and start replacing mock suggestion generation with real provider contracts

## Sprint 8

### 한국어

목표:

- provider auth 상태를 frontend 추측이 아니라 명시 계약으로 바꾸고, 실제 provider 연동을 위한 다음 단계를 준비한다.

단계:

- `Post-MVP`

포함 범위:

- auth snapshot에 `connectionKind` 같은 명시 필드 추가
- frontend provider badge가 해당 필드를 기준으로 동작하도록 정리
- raw callback URL은 기본 UI가 아니라 diagnostics에만 남기기
- mock suggestion 대체를 위한 실제 provider request/response contract 준비 착수

완료조건:

- provider UI가 URL heuristic 없이 `mock`, `prototype`, `real`을 구분한다.
- 관련 E2E가 새 계약을 기준으로 통과한다.
- 다음 단계의 실제 provider contract 작업을 이어갈 기준 worklog가 남는다.

### English

Goal:

- replace frontend auth guessing with an explicit provider-auth contract and prepare the next step toward real provider integration

Phase:

- `Post-MVP`

Scope:

- add an explicit auth field such as `connectionKind` to the auth snapshot
- make frontend provider badges use that field as the source of truth
- keep raw callback URLs only in diagnostics instead of default UI
- begin preparation for replacing mock suggestions with a real provider request/response contract

Acceptance Criteria:

- the provider UI distinguishes `mock`, `prototype`, and `real` without URL heuristics
- the relevant E2E coverage passes against the new contract
- a worklog exists to hand off the next real-provider contract step

Sprint 8 completion update:

- auth snapshots now expose explicit provider connection-kind metadata instead of leaving frontend to infer it from URLs
- provider badges render from the contract field rather than frontend heuristics
- the next sprint should stop treating the current workspace layout as good enough and execute the documented redesign against the new frontend design benchmarks

## Sprint 9

### 한국어

목표:

- 현재 카드 중심 UI를 실제 작업용 워크스페이스 구조로 다시 짜서, `VS Code`, `conductor`, `cmux` 레퍼런스를 구현으로 옮긴다.

단계:

- `Post-MVP`

포함 범위:

- 상단 바, 좌측 프로젝트 레일, 중앙 터미널 스테이지, 우측 에이전트 패널 구조 재구성
- 요약 카드 축소 또는 제거
- Task History, Telegram, Runtime/Debug를 기본 2선 영역으로 재배치
- 에이전트 요청, 컨텍스트, 제안, 승인 흐름을 단계형 UI로 재구성
- 활성 로그가 어떤 요청에 붙는지 더 분명하게 보이도록 개선
- backend snapshot, status field, action gating과 frontend UI 동작을 같은 계약으로 정렬
- 새 레이아웃 기준으로 UI E2E 갱신

권장 역할 분리:

- `Orchestrator`
  - 범위 고정, 문서 동기화, 통합 판단
- `Frontend`
  - 레이아웃 재구성, 스타일 시스템 정리, 인터랙션 정리
- `Backend`
  - 새 UI가 요구하는 context/snapshot 표시 필드 보강과 display contract 정렬
- `Tester`
  - 핵심 사용자 흐름 회귀와 레이아웃 전환 후 E2E 갱신

완료조건:

- 첫 화면에서 사용자가 프로젝트 열기, 터미널 작업, 에이전트 요청 순서를 바로 읽을 수 있다.
- 터미널이 가장 강한 1차 작업 영역으로 보인다.
- 에이전트 패널이 요청, 컨텍스트, 제안, 승인 순서를 자연스럽게 보여준다.
- Task History, Telegram, Runtime/Debug가 기본 화면을 어지럽히지 않는다.
- backend 상태와 frontend 버튼, 뱃지, 패널 동작이 같은 조건으로 설명된다.
- `docs/frontend-design-benchmarks.md` 기준 리뷰와 관련 UI E2E 갱신이 남는다.

리스크:

- 레이아웃 재구성이 크면 기존 테스트 셀렉터와 상호작용 흐름이 많이 깨질 수 있다.
- 시각 개선만 하고 실제 작업 흐름은 그대로 두는 반쪽짜리 개편으로 끝날 수 있다.
- frontend만 바꾸고 backend 표시 계약이 따라오지 않으면 UX 설명력이 약해질 수 있다.
- 화면은 좋아졌지만 action gating과 status semantics가 여전히 어긋날 수 있다.

Sprint 9 initial backlog:

- `P0` rebuild the workspace into top bar, left rail, terminal-first center stage, and right agent panel
- `P0` reduce summary-card density and demote support surfaces by default
- `P0` make active-log attachment state clearer inside the agent flow
- `P0` align backend snapshot semantics with frontend UI behavior and action gating
- `P0` update Playwright coverage for the redesigned main workspace
- `P1` add a status-bar-like summary strip inspired by `VS Code`
- `P1` improve approval-card readability inspired by `conductor`
- `P1` make terminal tab switching feel lighter and more focused, inspired by `cmux`
- `P2` refine visual polish after the workflow hierarchy is stable

### English

Goal:

- replace the current card-heavy UI with a real working workspace and turn the `VS Code`, `conductor`, and `cmux` references into implementation

Phase:

- `Post-MVP`

Scope:

- rebuild the top bar, left project rail, center terminal stage, and right agent panel structure
- reduce or remove summary-heavy cards
- move Task History, Telegram, and Runtime/Debug into secondary areas by default
- restructure the agent request, context, suggestion, and approval flow into a more staged UI
- make it much clearer which active logs are attached to which request
- align backend snapshots, status fields, and action gating with the frontend UI contract
- update UI E2E coverage against the new layout

Recommended Role Split:

- `Orchestrator`
  - locks scope, synchronizes docs, and makes integration calls
- `Frontend`
  - rebuilds layout, styling system, and interactions
- `Backend`
  - strengthens any context or snapshot fields needed by the redesigned UI and aligns the display contract
- `Tester`
  - updates regression coverage and verifies the new workspace flow

Acceptance Criteria:

- users can immediately read the order of project open, terminal work, and agent request from the first screen
- the terminal is clearly the strongest primary work surface
- the agent panel presents request, context, suggestion, and approval in a natural order
- Task History, Telegram, and Runtime/Debug no longer clutter the default screen
- backend state is reflected consistently in frontend buttons, badges, panel visibility, and action gating
- review against `docs/frontend-design-benchmarks.md` and updated UI E2E coverage are left behind

Risks:

- a large layout refactor may break existing test selectors and interaction paths
- the work may drift into visual polish without materially improving workflow clarity
- frontend-only changes may still feel weak if backend display contracts do not support the new UX
- visual redesign alone may hide unresolved mismatch between backend semantics and frontend behavior

Sprint 9 initial backlog:

- `P0` rebuild the workspace into top bar, left rail, terminal-first center stage, and right agent panel
- `P0` reduce summary-card density and demote support surfaces by default
- `P0` make active-log attachment state clearer inside the agent flow
- `P0` align backend snapshot semantics with frontend UI behavior and action gating
- `P0` update Playwright coverage for the redesigned main workspace
- `P1` add a status-bar-like summary strip inspired by `VS Code`
- `P1` improve approval-card readability inspired by `conductor`
- `P1` make terminal tab switching feel lighter and more focused, inspired by `cmux`
- `P2` refine visual polish after the workflow hierarchy is stable

## Sprint 10

### 한국어

목표:

- 개발용 `Codex` bridge와 diagnostics를 통해 real 요청 파이프라인의 임시 기반을 정리한다.

단계:

- `Post-MVP`

포함 범위:

- `Codex` env-backed OpenAI API bridge 진단 정보 추가
- connect 시 preflight 성공/실패 상태를 실제 연결 상태에 반영
- `Claude` deferred 상태를 diagnostics와 연결 UI에 명시
- 활성 로그 최근 50줄 자동 첨부 기준을 UI에서 더 분명하게 노출
- provider diagnostics 관련 E2E 갱신
- Windows 실사용 검증 전 필요한 문서 기준 정리

권장 역할 분리:

- `Planner`
  - Sprint 10 결과를 다음 스프린트 기획 메모와 fallback 정책으로 정리
- `Orchestrator`
  - 범위 고정, 역할 분리, 문서 동기화, 최종 통합
- `Designer`
  - diagnostics UI와 active-log preview가 다음 editor/design 방향과 어떻게 연결될지 정리
- `Frontend`
  - diagnostics UI, 연결 안내 문구, active-log preview 정리
- `Backend`
  - preflight 검증, provider diagnostics contract, 연결 상태 저장 보강
- `QA`
  - source of truth 문서와 런타임 계약 일치 여부 확인
- `Tester`
  - provider auth 및 request-flow 회귀 E2E 갱신

완료조건:

- 개발용 `Codex` bridge connect 액션이 실제 preflight 결과에 따라 성공 또는 실패로 표시된다.
- provider card에서 setup state, connection path, env 상태를 확인할 수 있다.
- `Claude` deferred path가 실연결처럼 보이지 않는다.
- 활성 로그 최근 50줄이 다음 요청에 자동 첨부된다는 점이 UI에 보인다.
- 관련 E2E와 빌드 검증이 통과한다.

리스크:

- 실제 provider base URL이나 model 접근 정책이 환경마다 다를 수 있다.
- preflight 성공이 suggestion 성공을 완전히 보장하지는 않는다.
- Windows 실기 환경에서는 셸, 네트워크, 환경변수 주입 차이로 추가 이슈가 생길 수 있다.

Sprint 10 initial backlog:

- `P0` add runtime diagnostics for the env-backed `Codex` connection path
- `P0` gate `Codex` connection state on connect-time preflight validation
- `P0` make `Claude` explicitly deferred in diagnostics and connection UX
- `P0` surface the latest 50 active log lines as the default request attachment window
- `P0` update provider-auth E2E around diagnostics and connection state
- `P1` refine user-facing preflight error copy for common provider failures
- `P1` record the Windows real-device validation checklist for the next pass

주의:

- 이 스프린트는 최종 auth 방향이 아니라 개발용 bridge를 정리한 임시 슬라이스다.
- source of truth 기준의 실사용 provider 연결 방향은 다음 스프린트의 `OAuth/session login` 구현이다.

### English

Goal:

- stabilize the temporary development `Codex` bridge and diagnostics so the request pipeline can be exercised end to end

Phase:

- `Post-MVP`

Scope:

- add diagnostics for the env-backed `Codex` OpenAI API bridge
- reflect connect-time preflight success or failure directly in provider connection state
- make the deferred `Claude` path explicit in diagnostics and connection UX
- surface the latest 50 active log lines as the default request attachment window
- update E2E coverage for provider diagnostics
- align documentation before Windows real-device validation

Recommended Role Split:

- `Planner`
  - turns Sprint 10 outputs into next-sprint planning notes and fallback-policy guidance
- `Orchestrator`
  - locks scope, splits roles, syncs docs, and integrates the final slice
- `Designer`
  - explains how diagnostics UI and active-log preview feed the next editor and design direction
- `Frontend`
  - refines diagnostics UI, connection guidance, and active-log preview
- `Backend`
  - implements preflight validation, provider diagnostics contract, and stronger connection-state persistence
- `QA`
  - verifies that source-of-truth documents and runtime contracts still match
- `Tester`
  - updates provider-auth and request-flow regression coverage

Acceptance Criteria:

- the temporary `Codex` bridge connect action resolves to success or failure based on preflight validation
- provider cards expose setup state, connection path, and env-status details
- the deferred `Claude` path does not look like a live real-provider connection
- the UI makes it clear that the latest 50 active log lines will auto-attach to the next request
- related E2E and build validation pass

Risks:

- real provider base-URL or model access policy may differ across environments
- preflight success does not fully guarantee suggestion success
- Windows real-device environments may still reveal shell, network, or env-injection issues

Sprint 10 initial backlog:

- `P0` add runtime diagnostics for the env-backed `Codex` connection path
- `P0` gate `Codex` connection state on connect-time preflight validation
- `P0` make `Claude` explicitly deferred in diagnostics and connection UX
- `P0` surface the latest 50 active log lines as the default request attachment window
- `P0` update provider-auth E2E around diagnostics and connection state
- `P1` refine user-facing preflight error copy for common provider failures
- `P1` record the Windows real-device validation checklist for the next pass

Note:

- this sprint is an interim bridge slice, not the final auth direction
- the source-of-truth daily-use provider path moves to `OAuth/session login` in the next sprint

## Sprint 11

### 한국어

목표:

- 첫 real daily-use `Codex` 경로를 `OAuth/session login`으로 전환한다.

단계:

- `Post-MVP`

포함 범위:

- provider 승인 경로 또는 시스템 브라우저 로그인 시작
- callback, deep link, 또는 desktop sign-in 완료 처리
- 세션 저장, 만료, 재연결, 취소 상태 처리
- 워크스페이스 안에서 `codex login --device-auth`를 시작할 수 있는 로그인 런처
- `Codex CLI` ChatGPT session과 `codex exec` 기반 첫 desktop session-backed adapter
- `Codex` account/session/scopes UI 표시
- `Claude` deferred path 유지
- Windows 기준 로그인 UX와 실패 상태 검증

권장 역할 분리:

- `Planner`
  - provider 정책, 다음 스프린트 backlog, Windows login 검증 계획 정리
- `Orchestrator`
  - 범위 고정, provider 정책 정리, 문서 동기화, 최종 통합
- `Designer`
  - 로그인 시작 UX, 코드 읽기 surface, agent interaction 배치, 다음 디자인 문서 정리
- `Frontend`
  - 로그인 시작 UX, reconnect/expiry/cancel 상태, account/session 표시 정리
- `Backend`
  - callback/session 처리, secure storage, session lifecycle 구현
- `QA`
  - source of truth와 구현 계약 일치 여부, 실패/취소/만료 상태 점검
- `Tester`
  - 로그인 성공, 취소, 만료, reconnect, Windows 기준 회귀 시나리오 갱신

완료조건:

- 최소 1개 provider가 실제 `OAuth/session login`으로 연결된다.
- 사용자가 로그인 성공, 취소, 만료, reconnect 상태를 UI에서 이해할 수 있다.
- `OPENAI_API_KEY` 기반 bridge는 개발용 fallback으로만 남거나 2선 설정으로 내려간다.
- Windows 기준 핵심 로그인 흐름과 실패 상태가 문서와 테스트에 남는다.

리스크:

- provider의 공식 desktop login 지원 범위가 제한적일 수 있다.
- callback/deep-link 처리 방식이 플랫폼마다 다를 수 있다.
- secure session storage와 refresh 정책이 provider별로 다를 수 있다.

Sprint 11 initial backlog:

- `P0` launch the official `Codex` OAuth/session login flow
- `P0` surface a workspace-native `codex login --device-auth` launcher
- `P0` route the first real request path through `Codex CLI` ChatGPT session and `codex exec`
- `P0` implement callback or desktop sign-in completion handling
- `P0` persist session state and show reconnect/expiry/cancel status
- `P0` update provider-auth E2E around success, cancel, and reconnect
- `P1` demote the API-key bridge into a dev-only fallback path
- `P1` record Windows-first login UX findings

### English

Goal:

- switch the first real daily-use `Codex` path to `OAuth/session login`

Phase:

- `Post-MVP`

Scope:

- launch the provider-approved path or system-browser login flow
- handle callback, deep link, or desktop sign-in completion
- implement session persistence plus expiry, reconnect, and cancellation handling
- provide a workspace-native launcher for `codex login --device-auth`
- use `Codex CLI` ChatGPT session plus `codex exec` as the first desktop session-backed adapter
- expose `Codex` account, session, and scopes in the UI
- keep `Claude` on the deferred path
- validate login UX and failure states with Windows as the baseline

Recommended Role Split:

- `Planner`
  - aligns provider policy, next-sprint backlog, and the Windows login-validation plan
- `Orchestrator`
  - locks scope, aligns provider policy, syncs docs, and integrates the final slice
- `Designer`
  - shapes login start UX, code-reading surfaces, agent interaction layout, and follow-up design docs
- `Frontend`
  - refines login start UX, reconnect/expiry/cancel state, and account/session display
- `Backend`
  - implements callback/session handling, secure storage, and session lifecycle
- `QA`
  - checks source-of-truth alignment and failure/cancel/expiry semantics
- `Tester`
  - updates login success, cancellation, expiry, reconnect, and Windows-first regression coverage

Acceptance Criteria:

- at least one provider connects through a real `OAuth/session login` path
- users can understand success, cancellation, expiry, and reconnect states in the UI
- the `OPENAI_API_KEY` bridge remains only as a dev fallback or secondary setting
- Windows-baseline login flows and failure states are captured in docs and tests

Risks:

- provider support for official desktop login may be limited
- callback or deep-link handling may differ by platform
- secure session storage and refresh policy may vary by provider

Sprint 11 initial backlog:

- `P0` launch the official `Codex` OAuth/session login flow
- `P0` surface a workspace-native `codex login --device-auth` launcher
- `P0` route the first real request path through `Codex CLI` ChatGPT session and `codex exec`
- `P0` implement callback or desktop sign-in completion handling
- `P0` persist session state and show reconnect/expiry/cancel status
- `P0` update provider-auth E2E around success, cancel, and reconnect
- `P1` demote the API-key bridge into a dev-only fallback path
- `P1` record Windows-first login UX findings

## 스프린트 간 의존성 / Cross-Sprint Dependencies

### 한국어

- `Sprint 2`는 `Sprint 0`의 앱 셸과 `Sprint 1`의 프로젝트 열기 구조가 필요하다.
- `Sprint 3`는 `Sprint 0`의 런타임 통신 구조가 필요하다.
- `Sprint 4`는 `Sprint 2`의 활성 로그 읽기와 `Sprint 3`의 provider 연결이 필요하다.
- `Sprint 5`는 앞선 모든 스프린트 결과를 통합하는 단계다.
- `Sprint 6`는 `Sprint 4`의 승인 흐름과 `Sprint 5`의 작업 상태 모델이 필요하다.
- `Sprint 7`은 `Sprint 3`의 provider foundation, `Sprint 4`의 approval flow, `Sprint 5`의 workspace restore, 그리고 실제 Windows 사용 피드백이 필요하다.
- `Sprint 8`은 `Sprint 7`의 UX 재정리 결과를 바탕으로 auth contract를 heuristic 없는 명시 계약으로 바꾸는 단계다.
- `Sprint 9`는 `Sprint 7`의 와이어프레임과 `Sprint 8`의 auth contract 명시화를 바탕으로 실제 워크스페이스 리디자인을 구현하는 단계다.
- `Sprint 10`은 `Sprint 8`의 auth contract와 `Sprint 9`의 워크스페이스 리디자인 위에서 개발용 bridge와 diagnostics를 정리한 임시 슬라이스다.
- `Sprint 11`은 `Sprint 10`의 임시 bridge 경험을 바탕으로 source of truth인 `OAuth/session login`을 실제 경로로 전환하는 단계다.

### English

- `Sprint 2` depends on the app shell from `Sprint 0` and project open flow from `Sprint 1`
- `Sprint 3` depends on the runtime communication model from `Sprint 0`
- `Sprint 4` depends on active log reading from `Sprint 2` and provider connection from `Sprint 3`
- `Sprint 5` integrates and stabilizes results from all previous sprints
- `Sprint 6` depends on the approval flow from `Sprint 4` and the task-state model from `Sprint 5`
- `Sprint 7` depends on the provider foundation from `Sprint 3`, approval flow from `Sprint 4`, workspace restore from `Sprint 5`, and real Windows usage feedback
- `Sprint 8` turns the `Sprint 7` auth UX into an explicit backend-driven contract
- `Sprint 9` implements the real workspace redesign using the wireframes from `Sprint 7` and the auth contract clarified in `Sprint 8`
- `Sprint 10` depends on the explicit auth contract from `Sprint 8` and the workspace redesign from `Sprint 9` to stabilize the temporary bridge and diagnostics slice
- `Sprint 11` uses the contract from `Sprint 8`, the workspace from `Sprint 9`, and the bridge learnings from `Sprint 10` to implement the real `OAuth/session login` path

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
- `Sprint 7`
  - 사용자가 mock과 real의 경계를 헷갈리지 않고, 경로 입력 없이 프로젝트를 열며, 실제 provider 연동 다음 단계로 자연스럽게 넘어갈 수 있는가
- `Sprint 8`
  - provider auth 상태가 frontend 추측이 아니라 backend 계약으로 설명되는가
- `Sprint 9`
  - 현재 UI가 정말 작업용 워크스페이스처럼 느껴지고, 터미널과 에이전트 흐름이 한 화면에서 자연스럽게 읽히는가
- `Sprint 10`
  - 임시 bridge와 diagnostics가 실제 요청 파이프라인을 검증하는 데 충분한가
- `Sprint 11`
  - real provider login이 API key가 아니라 `OAuth/session` 기준으로 동작하는가

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
- `Sprint 7`
  - can users avoid confusing mock and real flows, open projects without typing paths, and move naturally into the next stage of real provider integration
- `Sprint 8`
  - can provider-auth state now be explained by backend contract instead of frontend guesswork
- `Sprint 9`
  - does the UI now feel like a real working workspace where the terminal and agent flow read naturally together
- `Sprint 10`
  - is the temporary bridge sufficient to exercise the request pipeline while the real auth path is prepared
- `Sprint 11`
  - does real provider login work through `OAuth/session` instead of API-key setup

## 다음 실행 추천 / Recommended Next Action

### 한국어

다음 단계로는 `Sprint 11` 기준으로 `Codex`의 `OAuth/session login` 경로를 설계/구현하고, 그 뒤 `Windows`에서 실기 검증을 진행하는 것이 맞다.

### English

The next step should be to implement the `Sprint 11` `Codex` `OAuth/session login` path first, then validate the real Windows loop on top of that path.

# gtum MVP 백로그 / MVP Backlog

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`의 MVP를 실제 구현 가능한 작업 단위로 정의하기 위한 기준 문서다.

이 문서의 목적은 다음과 같다.

- MVP 범위를 더 구체적인 백로그 항목으로 분해한다.
- 우선순위를 정해 스프린트 계획의 기준으로 사용한다.
- 각 항목의 완료조건을 명확히 해서 구현 완료 여부를 판단할 수 있게 한다.
- 지금 하지 않을 것을 명시해 범위 확장을 막는다.

### English

This document defines the MVP of `gtum` as an implementation-ready backlog.

Its purpose is to:

- decompose the MVP scope into concrete backlog items
- prioritize work so it can drive sprint planning
- define acceptance criteria for each item
- explicitly mark what is out of scope to prevent drift

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- MVP 범위, 우선순위, 완료조건, 제외 범위를 확인하거나 바꿔야 할 때
- 지금 작업이 MVP 안인지 밖인지, 어떤 항목이 먼저인지 판단해야 할 때

### English

Read this document when:

- you need to confirm or change MVP scope, priority, acceptance criteria, or out-of-scope boundaries
- you need to decide whether the current task is inside the MVP and which item should come first

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 백로그 문서다. 아래 경로만 먼저 읽는다.

- MVP 한 줄 정의, 완료조건, 현재 상태만 볼 때
  - 문서 앞부분만 읽는다.
- 어떤 기능이 `P0/P1/P2`인지 확인할 때
  - 우선순위와 해당 기능 섹션만 읽는다.
- 실제 실행 순서와 현재 스프린트를 정할 때
  - `sprint-plan.md`를 먼저 읽고 이 문서는 확인용으로만 사용한다.

### English

This document exceeds 200 lines. Read only the route that matches your question.

- when you only need the one-line MVP definition, acceptance criteria, or current status
  - read only the front portion
- when you need to know whether an item is `P0`, `P1`, or `P2`
  - read the priority framework and the matching feature section only
- when you need actual execution order or the active sprint baseline
  - read `sprint-plan.md` first and use this doc as confirmation

## One-Line MVP Definition

The MVP of `gtum` is a cross-platform desktop workspace where users open local projects, use user-owned multi-tab terminals, select Codex or Claude per Agent session, request provider suggestions with project context, and approve commands into observable isolated Agent jobs without mutating the center terminal. Windows remains the first daily-use release baseline. Claude is a real provider path that selects an explicit API key, then a strict user-level `apiKeyHelper`, then an already authenticated installed CLI session without in-app OAuth or token capture. Public CLI-session distribution remains blocked pending Anthropic approval/contract review.

## MVP가 풀어야 할 핵심 가치 / Core MVP Value

### 한국어

MVP는 단순히 "터미널이 있는 에이전트 앱"이면 충분하지 않다. 최소한 아래 가치를 증명해야 한다.

- 코드 보기와 터미널 작업이 한 워크스페이스 안에서 자연스럽게 이어진다.
- 현재 테스트 중인 터미널 로그를 에이전트 작업 맥락으로 바로 사용할 수 있다.
- `cmux`에서 좋았던 멀티 터미널 감각과 `conductor`에서 좋았던 에이전트 관리 감각을 함께 제공한다.

### English

The MVP is not successful merely by being "an agent app with terminals." It must prove at least the following value:

- code reading and terminal work flow naturally inside one workspace
- live logs from active testing sessions can be used immediately as agent context
- it combines the multi-terminal strength felt in `cmux` with the agent-management strength felt in `conductor`

## MVP Definition of Done

The MVP is considered complete when all of the following are true:

1. users can open a local project
2. users can view the file tree, current Git branch, and dirty state
3. users can create and close isolated terminal sessions by tab
4. terminal output and basic session state are preserved
5. users can connect Codex through its CLI ChatGPT session and Claude through an explicit API key, strict helper, or pre-authenticated installed CLI session; GTUM exposes no raw-key form, performs no Claude.ai OAuth, and stores no secret or identity metadata
6. the selected provider can read project context and current terminal output to generate suggestions owned by the originating Agent session
7. users can review suggested commands through `Deny` or `Allow once`, and approval creates one observable isolated Agent job
8. Agent-job status, bounded logs, exit metadata, cancellation, interruption on restart, task history, and basic agent state are visible in the UI
9. the app works within a cross-platform architecture targeting Ubuntu, Windows, and macOS, and the first daily-use flow is validated on Windows
10. live logs from active testing terminals can be attached to agent suggestion flows
11. core user flows are covered by UI end-to-end verification
12. `aging test` evidence shows that core flows remain stable after sustained runtime or repeated use

## MVP Status

The core implementation includes durable isolated Agent jobs, truthful Codex authentication, session-owned Codex/Claude selection with persisted `providerId`, provider-neutral frontend IPC with required `agentSessionId`, provider-mismatch rejection, center-terminal isolation, a bounded repeated-use E2E scenario, the Claude API-key/helper/CLI-session adapter, and fail-closed connect/request revision leases. Claude helper configuration is intentionally restricted to one canonical absolute regular executable path rather than a command line. CLI-session mode uses safe mode with empty user/project setting sources; API-key/helper mode retains bare operation. Integrated verification passes serial Playwright 200/200, focused Claude tests 42/42, and the full Rust suite 147/147; lint, production build, Rust formatting, and Rust check also pass. Only non-billing auth status was exercised; no live `claude -p` inference was run without explicit user approval. MVP stabilization also remains incomplete until public Claude authentication terms are approved or the release is restricted to API/cloud credentials, the Windows installed-app daily-use flow receives native sign-off, and a sustained manual soak is recorded. The older backlog entries below preserve the decisions and sequencing that were true when those slices were planned; this current status section overrides their historical Claude-deferred and API-only wording. See `docs/MVP_VALIDATION_NOTES.md` and `docs/sprint-plan.md` for evidence and open gates.

## MVP 검증 원칙 / MVP Validation Principles

### 한국어

MVP 검증은 한 번 성공했다고 끝나지 않는다. 아래 기준을 함께 본다.

- 기능 검증
  - 각 핵심 흐름이 요구사항대로 동작하는지 확인
- UI E2E 검증
  - 사용자 기준 시나리오가 자동화로 재현되는지 확인
- Aging Test
  - 일정 시간 유지 실행, 반복 탭 전환, 반복 프로젝트 열기, 반복 로그 확인 같은 흐름에서 상태가 무너지지 않는지 확인

`aging test`의 초기 예시는 다음과 같다.

- 앱을 일정 시간 켜둔 뒤 기본 패널 상태가 유지되는지 확인
- 프로젝트 열기와 재진입을 여러 번 반복해 상태가 꼬이지 않는지 확인
- 터미널 탭 전환과 로그 업데이트가 반복되어도 UI가 무너지지 않는지 확인

### English

MVP validation is not complete after a single success. It should include:

- feature validation
  - confirm that each core flow behaves as required
- UI E2E validation
  - confirm that user-facing scenarios are reproducible through automation
- aging test
  - confirm that state does not degrade during sustained runtime, repeated tab switching, repeated project-open flows, or repeated log inspection

Recommended initial `aging test` examples:

- keep the app running for a sustained period and verify that the base panels remain stable
- repeat project-open and re-entry flows multiple times without state corruption
- repeat terminal tab switching and log updates without UI degradation

## 우선순위 기준 / Priority Framework

### 한국어

백로그 우선순위는 다음 기준으로 판단한다.

- `P0`
  - MVP가 성립하기 위해 반드시 필요한 항목
- `P1`
  - MVP 품질과 사용성을 크게 높이지만, 아주 초기 데모 없이도 착수 가능한 항목
- `P2`
  - 후속 스프린트 또는 안정화 단계에서 진행 가능한 항목

### English

Backlog priority is classified as:

- `P0`
  - mandatory for the MVP to exist
- `P1`
  - significantly improves MVP quality and usability, but not required for a minimal first demo
- `P2`
  - suitable for later sprints or stabilization phases

## MVP 백로그 / MVP Backlog

### 1. 앱 셸과 개발 기반 / App Shell and Foundation

#### 한국어

우선순위: `P0`

목표:

- Tauri + React + Vite 기반 데스크톱 앱 뼈대를 준비한다.

백로그 항목:

- 앱 셸 초기화
- 기본 레이아웃 프레임
- 상태 관리 기본 구조
- 개발 실행 스크립트 정리

완료조건:

- 앱이 로컬에서 실행된다.
- 좌측, 중앙, 우측 패널 구조를 가진 기본 UI가 뜬다.
- 프론트엔드와 Tauri 런타임이 연결된다.

#### English

Priority: `P0`

Goal:

- prepare the desktop app skeleton based on Tauri + React + Vite

Backlog:

- bootstrap app shell
- build base layout frame
- initialize state management structure
- define development run scripts

Acceptance Criteria:

- the app runs locally
- the UI shows a left, center, and right panel shell
- frontend and Tauri runtime communicate successfully
- the shell can be smoke-tested by a UI E2E runner

### 2. 프로젝트 열기와 파일 탐색 / Project Open and File Exploration

#### 한국어

우선순위: `P0`

목표:

- 사용자가 로컬 프로젝트를 열고 기본 정보를 확인할 수 있게 한다.

백로그 항목:

- 프로젝트 선택 또는 경로 연결
- 최근 프로젝트 목록
- 파일 트리 표시
- 기본 프로젝트 메타데이터 표시

완료조건:

- 사용자가 로컬 프로젝트를 추가하고 다시 열 수 있다.
- 파일 트리가 정상적으로 렌더링된다.
- 프로젝트 이름, 경로가 UI에 표시된다.

#### English

Priority: `P0`

Goal:

- allow users to open local projects and inspect basic project information

Backlog:

- project picker or path binding
- recent project list
- file tree rendering
- basic project metadata display

Acceptance Criteria:

- users can add and reopen local projects
- the file tree renders correctly
- project name and path are visible in the UI
- the project-open flow is covered by a UI E2E scenario

### 3. Git 상태 표시 / Git State Visibility

#### 한국어

우선순위: `P0`

목표:

- 프로젝트 패널에서 현재 브랜치와 변경 상태를 읽기 전용으로 보여준다.

백로그 항목:

- 현재 브랜치 표시
- dirty state 표시
- 변경 파일 수 표시
- `git flow` 스타일 브랜치 타입 정규화 준비

완료조건:

- 현재 브랜치명이 UI에 보인다.
- 변경 여부가 UI에 표시된다.
- 최소한 `master`, `dev`, `feature/*`, `release/*`, `hotfix/*`를 구분 가능한 내부 구조가 있다.

#### English

Priority: `P0`

Goal:

- expose current branch and working state in the project panel as read-only Git status

Backlog:

- current branch display
- dirty state display
- changed file count
- normalized support for `git flow`-style branch types

Acceptance Criteria:

- current branch name is visible in the UI
- working tree status is visible
- the internal model can distinguish at least `master`, `dev`, `feature/*`, `release/*`, and `hotfix/*`

### 4. 멀티 탭 터미널 / Multi-Tab Terminal

#### 한국어

우선순위: `P0`

목표:

- 탭 단위로 독립적인 PTY 터미널을 제공한다.

백로그 항목:

- 탭 생성
- 탭 이름 변경
- 탭 종료
- PTY 세션 생성과 종료
- 터미널 출력 렌더링
- resize 처리

완료조건:

- 사용자가 여러 개의 터미널 탭을 만들 수 있다.
- 각 탭은 서로 다른 셸 세션을 가진다.
- 명령 입력과 출력이 정상 동작한다.
- 탭 전환 시 세션이 유지된다.

#### English

Priority: `P0`

Goal:

- provide isolated PTY-backed terminals per tab

Backlog:

- create tabs
- rename tabs
- close tabs
- create and terminate PTY sessions
- render terminal output
- handle resize events

Acceptance Criteria:

- users can create multiple terminal tabs
- each tab has its own shell session
- command input and output work correctly
- sessions remain alive across tab switches

### 5. 워크스페이스 저장 / Workspace Persistence

#### 한국어

우선순위: `P1`

단계:

- `Post-MVP`

목표:

- 프로젝트별 워크스페이스 상태를 저장하고 복원한다.

백로그 항목:

- 열린 탭 목록 저장
- 활성 탭 저장
- 기본 레이아웃 상태 저장
- 최근 프로젝트와 워크스페이스 재진입

완료조건:

- 앱을 다시 열면 최근 프로젝트와 기본 워크스페이스 상태를 복원할 수 있다.
- 최소한 어떤 탭이 열려 있었는지와 활성 탭이 무엇이었는지 유지된다.

#### English

Priority: `Deferred`

Phase:

- `Post-MVP`

Goal:

- persist and restore workspace state per project

Backlog:

- persist open tabs
- persist active tab
- persist base layout state
- reopen recent project and workspace

Acceptance Criteria:

- recent project and basic workspace state can be restored after restart
- at minimum, open tab identities and active tab are preserved

### 6. 에이전트 연결 설정 / Agent Connection Setup

#### 한국어

우선순위: `P0`

목표:

- 사용자가 앱 안에서 session-based provider login을 시작하고, `Claude`의 deferred 상태를 구분할 수 있게 한다.

백로그 항목:

- provider 선택 UI
- 연결 시작 액션
- OAuth/session 로그인 시작
- callback 또는 desktop sign-in 완료 처리
- 세션 저장
- 연결 상태와 진단 정보 표시

완료조건:

- 사용자가 최소 1개 provider에 대해 로그인 연결을 시작할 수 있다.
- 로그인 성공, 실패, 취소 상태가 UI에 표시된다.
- `Claude` deferred 상태와 `Codex` real 상태를 구분해 보여줄 수 있다.

#### English

Priority: `P0`

Goal:

- let users start a session-based provider login in-app while clearly distinguishing the deferred `Claude` path

Backlog:

- provider selection UI
- connect action
- OAuth/session login start
- callback or desktop sign-in completion handling
- session persistence
- connection status and diagnostics display

Acceptance Criteria:

- users can start a login flow for at least one provider
- login success, failure, and cancellation states are visible in the UI
- the deferred `Claude` path is visibly distinct from the real `Codex` path

### 7. Provider Adapter 공통화 / Shared Provider Adapter Layer

#### 한국어

우선순위: `P0`

목표:

- Codex와 Claude를 동일한 앱 구조 안에서 다룰 수 있게 한다.

백로그 항목:

- 공통 provider interface 정의
- `CodexAdapter` 초안
- `ClaudeAdapter` 초안
- 공통 응답 이벤트 포맷 정의

완료조건:

- 애플리케이션 레이어가 provider별 분기 없이 공통 인터페이스를 호출할 수 있다.
- provider 응답을 공통 이벤트 포맷으로 정규화할 수 있다.

#### English

Priority: `P0`

Goal:

- support Codex and Claude through a shared application-facing structure

Backlog:

- define a shared provider interface
- create a first `CodexAdapter`
- create a first `ClaudeAdapter`
- define a shared response event format

Acceptance Criteria:

- the application layer can call a shared provider interface without provider-specific branching
- provider responses can be normalized into a shared event model

### 8. 에이전트 패널과 제안 UI / Agent Panel and Suggestion UI

#### 한국어

우선순위: `P0`

목표:

- 에이전트가 생성한 제안과 상태를 사용자가 확인할 수 있게 한다.

백로그 항목:

- 에이전트 패널 기본 UI
- provider 연결 상태 표시
- 작업 요청 입력
- 제안 카드 UI
- 실행 대상 선택 UI

완료조건:

- 사용자가 에이전트 패널에서 요청을 보낼 수 있다.
- 제안 결과가 UI에 나타난다.
- 제안된 명령을 검토 가능한 형태로 볼 수 있다.

#### English

Priority: `P0`

Goal:

- make agent-generated suggestions and state visible to the user

Backlog:

- base agent panel UI
- provider connection status display
- task request input
- suggestion card UI
- execution target selection UI

Acceptance Criteria:

- users can send a request from the agent panel
- suggestion results appear in the UI
- suggested commands are shown in a reviewable form

### 9. 프로젝트 컨텍스트 읽기 / Project Context Reading

#### 한국어

우선순위: `P0`

목표:

- 에이전트가 프로젝트와 현재 터미널 맥락을 읽을 수 있게 한다.

백로그 항목:

- 선택 파일 읽기
- 현재 탭 로그 읽기
- 프로젝트 메타데이터 수집
- 컨텍스트 payload 구성

완료조건:

- 에이전트 요청 시 현재 프로젝트와 현재 탭 기준 컨텍스트가 전달된다.
- 최소한 파일 트리, 선택 파일, 선택 파일 line anchor, 선택 파일 excerpt, 현재 탭 최근 로그를 포함할 수 있다.
- 테스트 중인 활성 터미널 로그를 제안 생성 컨텍스트로 넘길 수 있다.
- 선택 파일이 read-only code surface에서 먼저 보여지고, request preview와 approval review에서도 다시 확인할 수 있다.
- reload 또는 재진입 후에도 선택 파일과 line anchor가 best-effort로 복원된다.
- binary와 large file은 bounded fallback으로 안전하게 처리된다.

#### English

Priority: `P0`

Goal:

- allow agents to read project context and current terminal context

Backlog:

- selected file reading
- current tab log reading
- project metadata collection
- context payload construction

Acceptance Criteria:

- project and current-tab context are sent with agent requests
- at minimum, file tree, selected files, selected-file line anchors, selected-file excerpts, and recent current-tab logs can be included
- live logs from an active testing terminal can be passed into suggestion generation
- the selected file is first visible in a read-only code surface and can be reread in request preview and approval review
- selected file and line anchor restore after reload through best-effort recovery
- binary and large files are handled through safe bounded fallback

### 10. Approval-Based Isolated Agent Jobs

Priority: `P0`

Goal:

- ensure suggested commands execute only through explicit, one-time user approval in an Agent-owned runtime

Backlog:

- composer-level permission panel with only `Deny` and `Allow once`
- one isolated Agent job per approved command
- project- and Agent-session-scoped list, read, cancel, restore, and bounded structured logs
- truthful terminal outcomes: `completed`, `failed`, `cancelled`, or restart-normalized `interrupted`

Acceptance Criteria:

- agent-suggested commands never auto-run by default
- double activation cannot create duplicate jobs
- approvals, polling, cancellation, restore, and failure handling never create or mutate a user-visible center terminal/workbench surface
- active jobs remain observable and cancellable even when terminal history reaches the display limit
- approval decisions and job results remain tied to Agent-panel history and the originating Agent session

### 11. 작업 이력과 기본 상태 / Task History and Basic Status

#### 한국어

우선순위: `P1`

목표:

- 프로젝트 단위 작업 이력과 에이전트 기본 상태를 볼 수 있게 한다.

백로그 항목:

- 작업 리스트
- 실행 상태 표시
- 최근 제안 이력
- 연결된 provider 상태 요약

완료조건:

- 사용자가 최근 작업과 그 상태를 UI에서 확인할 수 있다.
- 최소한 `pending`, `running`, `completed`, `failed` 상태를 구분한다.

#### English

Priority: `P1`

Goal:

- provide project-level task history and basic agent state visibility

Backlog:

- task list
- execution status display
- recent suggestion history
- provider state summary

Acceptance Criteria:

- users can inspect recent tasks and their status in the UI
- at minimum, `pending`, `running`, `completed`, and `failed` are distinguishable

### 12. Initial Execution Policies

Priority: `Deferred`

Goal:

- define execution policies only after provider capability discovery and scheduling contracts are explicit

Backlog:

- policy definitions
- per-policy context limits
- per-policy worker limits
- provider capability wiring

Acceptance Criteria:

- no fixed `Fast`, `Balanced`, or `Deep` UI appears before runtime policy support exists
- at minimum, context scope or worker count changes by policy when the feature is reintroduced

### 13. 크로스 플랫폼 검증 / Cross-Platform Validation

#### 한국어

우선순위: `P1`

목표:

- Ubuntu, Windows, macOS 기준의 구조적 호환성을 유지하되, 첫 실사용 기준은 Windows에 둔다.

백로그 항목:

- Windows 기준 셸 탐지 검증
- Windows 기준 기본 경로 처리 검증
- PTY 동작 차이 확인
- 비-Windows 플랫폼 제약 정리

완료조건:

- 세 플랫폼 모두에서 주요 구조가 깨지지 않는다는 근거가 있다.
- Windows 기준 핵심 흐름 검증 메모가 있다.
- 최소한 플랫폼별 알려진 제약과 우회 방식이 문서화된다.

#### English

Priority: `P1`

Goal:

- preserve structural compatibility across Ubuntu, Windows, and macOS while using Windows as the first daily-use baseline

Backlog:

- validate shell detection against the Windows baseline
- validate path handling against the Windows baseline
- check PTY behavior differences
- document non-Windows platform constraints

Acceptance Criteria:

- there is evidence that the major architecture holds across all three platforms
- Windows baseline flow notes exist for the core path
- at minimum, platform-specific constraints and workarounds are documented

### 14. 외부 채널 리포트 및 원격 명령 / External Report and Remote Command Channels

#### 한국어

우선순위: `P1`

목표:

- `Telegram`을 통해 상태 리포트를 받고 제한된 명령을 전달할 수 있게 한다.

백로그 항목:

- 외부 채널 연동 전략 정의
- `Telegram` 채널 adapter 초안
- 작업 상태 리포트 포맷 정의
- 제한된 원격 명령 정책 정의

완료조건:

- 최소한 하나의 외부 채널에서 작업 상태 리포트를 받을 수 있다.
- 제한된 명령 집합에 대해서만 원격 명령 수신이 가능하다.
- 민감한 명령은 추가 승인 또는 거부 정책을 가진다.

#### English

Priority: `P1`

Goal:

- allow users to receive status reports and send limited commands through `Telegram`

Backlog:

- define external channel integration strategy
- draft `Telegram` channel adapter
- define task-status report format
- define restricted remote-command policy

Acceptance Criteria:

- at least one external channel can receive task status reports
- only a restricted command set is accepted remotely
- sensitive commands are protected by additional approval or denial policy

## Post-MVP 현실화 백로그 / Post-MVP Realization Backlog

### 한국어

MVP 이후 `gtum`의 다음 핵심 단계는 두 가지다.

1. `Mock -> Real`
   현재 mock 또는 prototype으로 남아 있는 provider, agent, channel 영역을 실제 동작으로 전환
2. `Usability Refinement`
   실사용 중 바로 걸리는 UX 마찰을 줄여 개발 도구로서의 기본 사용성을 높임

아래 항목은 다음 스프린트 계획의 기준 백로그로 사용한다.

### English

The next key phase after the MVP has two tracks:

1. `Mock -> Real`
   convert provider, agent, and channel areas that are still mock or prototype into real working integrations
2. `Usability Refinement`
   reduce immediate UX friction so the product behaves more like a practical daily-use developer tool

The items below serve as the planning backlog for the next sprint phase.

### 15. Provider Auth 실제 연동 / Real Provider Authentication

#### 한국어

우선순위: `P0`

목표:

- `Codex` provider 연결을 mock foundation에서 실제 `OAuth/session login` 경로로 전환하고, `Claude`는 deferred 상태를 명시한다.

백로그 항목:

- `Codex` OAuth/session login 경로 설계와 구현
- 브라우저 또는 데스크톱 승인 완료 callback 처리
- 실제 provider 에러 상태 계약 정의
- 만료, 취소, scope 부족 상태 처리
- mock/real provider 상태 표시 분리

완료조건:

- 최소 1개 provider가 실제 `OAuth/session login` 경로로 동작한다.
- 로그인 실패, 취소, scope 부족을 사용자가 이해 가능한 상태로 본다.
- UI에서 mock 상태와 real 상태를 혼동하지 않는다.

#### English

Priority: `P0`

Goal:

- move `Codex` provider connection from mock foundation to a real `OAuth/session login` path while keeping `Claude` explicitly deferred

Backlog:

- implement the `Codex` OAuth/session login path
- handle browser or desktop sign-in callback completion
- define contracts for real provider error states
- handle expiry, cancellation, and missing-scope states
- clearly separate mock and real provider status in the UI

Acceptance Criteria:

- at least one provider works through a real `OAuth/session login` path
- login failure, cancellation, and missing-scope states are understandable to users
- the UI does not confuse mock status with real status

### 16. Agent 응답 실제화 / Real Agent Responses

#### 한국어

우선순위: `P0`

목표:

- agent suggestion을 mock 생성이 아니라 실제 provider adapter 응답으로 전환한다.

백로그 항목:

- provider request envelope 현실화
- project + active log context를 실제 요청 계약에 연결
- 실제 suggestion payload 정규화
- provider 오류 응답과 재시도 흐름 추가

완료조건:

- 최소 1개 provider가 실제 suggestion 응답을 돌려준다.
- suggestion 카드가 실제 응답과 에러 상태를 모두 보여준다.

#### English

Priority: `P0`

Goal:

- replace mock-generated agent suggestions with real provider-adapter responses

Backlog:

- make the provider request envelope real
- connect project, selected-file, selected-file line anchor, and active-log context into the actual request contract
- normalize real suggestion payloads
- add provider error and retry handling

Acceptance Criteria:

- at least one provider returns real suggestion responses
- suggestion cards represent both real responses and real error states
- request preview and suggestion review make the selected file and line-anchor context legible to users

### 17. 프로젝트 열기 UX 개선 / Project Open UX Improvement

#### 한국어

우선순위: `P0`

목표:

- 프로젝트 열기 흐름을 경로 수동 입력에서 네이티브 폴더 선택 중심으로 바꾼다.

백로그 항목:

- `Open Project`를 폴더 선택기로 변경
- 최근 프로젝트 재열기 흐름 유지
- Windows/macOS/Linux 경로 차이 검증
- 잘못된 선택, 권한 문제, 취소 상태 처리

완료조건:

- 사용자가 경로를 직접 붙여넣지 않고 프로젝트를 열 수 있다.
- 세 플랫폼에서 폴더 선택 흐름이 크게 다르지 않다.

#### English

Priority: `P0`

Goal:

- replace manual path entry with a native folder picker for project opening

Backlog:

- change `Open Project` to a folder picker
- preserve recent-project reopen flows
- validate path differences across Windows, macOS, and Linux
- handle invalid selection, permission errors, and cancellation

Acceptance Criteria:

- users can open a project without manually pasting a path
- the folder-picker flow behaves consistently across the three target platforms

### 18. Provider Auth UX 명확화 / Provider Authentication UX Clarification

#### 한국어

우선순위: `P0`

목표:

- provider auth UI가 실제 연결 상태를 과장하거나 내부 callback 값을 그대로 노출하지 않게 한다.

백로그 항목:

- callback URL 직접 노출 제거 또는 축소
- `mock`, `prototype`, `real` 상태 뱃지 추가
- 실패 원인을 사용자 언어로 다시 작성
- 아직 미구현인 연결은 명시적으로 표시

완료조건:

- 사용자가 현재 auth가 실제 연결인지 mock인지 바로 이해한다.
- 내부 callback URL이 일반 UX에 그대로 노출되지 않는다.

#### English

Priority: `P0`

Goal:

- ensure the provider-auth UI does not overstate the connection state or expose raw internal callback values as normal UX

Backlog:

- remove or reduce direct callback URL exposure
- add `mock`, `prototype`, and `real` state badges
- rewrite failures in user-facing language
- explicitly mark flows that are not implemented yet

Acceptance Criteria:

- users can immediately tell whether auth is real or mock
- raw internal callback URLs are not presented as normal user-facing UX

### 19. 로그 컨텍스트 흐름 개선 / Log Context Flow Improvement

#### 한국어

우선순위: `P1`

목표:

- 활성 로그를 agent 맥락으로 붙이는 과정을 더 자연스럽게 만든다.

백로그 항목:

- 자동 로그 캡처 옵션
- 현재 어떤 탭 로그가 연결되는지 시각 강화
- suggestion과 attached log 관계 표시 강화

완료조건:

- 사용자가 어떤 로그가 어떤 요청에 붙는지 쉽게 이해한다.
- 반복 클릭 없이 로그 컨텍스트를 붙이는 기본 흐름이 마련된다.

#### English

Priority: `P1`

Goal:

- make the flow for attaching active logs into agent context feel more natural

Backlog:

- optional automatic log capture
- clearer visual indication of which tab is being attached
- stronger display of the relationship between suggestions and attached logs

Acceptance Criteria:

- users can easily understand which logs are attached to which request
- a lower-friction default flow exists for attaching log context

### 20. UI/UX 정보 구조 재설계 / UI/UX Information Architecture Redesign

#### 한국어

우선순위: `P0`

목표:

- 화면이 기능 목록처럼 보이지 않고, 실제 작업 흐름 중심의 워크스페이스처럼 보이도록 재구성한다.

백로그 항목:

- 프로젝트, 터미널, 에이전트, 작업 이력의 정보 계층 재정렬
- 핵심 작업 흐름을 기준으로 상단/중앙/보조 패널 역할 재설계
- `mock`, `prototype`, `debug` 정보의 2선 배치
- 과도한 status card 축소
- 현재 사용자가 해야 할 첫 액션을 더 명확히 보이도록 CTA 재정리

완료조건:

- 사용자가 첫 화면에서 무엇을 먼저 해야 하는지 이해할 수 있다.
- 터미널이 메인 작업 영역으로 명확히 드러난다.
- 보조 정보가 핵심 작업 흐름을 방해하지 않는다.

#### English

Priority: `P0`

Goal:

- reshape the UI so it feels like a task-oriented workspace instead of a flat list of available features

Backlog:

- reorganize the information hierarchy across projects, terminals, agents, and task history
- redesign top-level, main, and supporting panels around the core workflow
- demote `mock`, `prototype`, and `debug` information into secondary presentation
- reduce excessive status-card density
- clarify the first-action CTA for the user

Acceptance Criteria:

- users can understand what to do first from the initial screen
- the terminal is clearly presented as the main work surface
- supporting information does not overpower the core workflow

### 21. 플랫폼 실사용 검증 / Real Device Platform Validation

#### 한국어

우선순위: `P1`

목표:

- Windows를 첫 실사용 기준으로 삼아 실기 사용성 근거를 쌓고, 나머지 플랫폼은 smoke와 제약 정리 중심으로 검증한다.

백로그 항목:

- Windows 실기 프로젝트 열기/PTY/에이전트 승인/복원 검증
- Windows 설치 파일 실행 확인
- macOS 기본 프로젝트/터미널 smoke 검증
- 알려진 제약 정리

완료조건:

- Windows에서 첫 실사용 기준 핵심 흐름 이슈가 최소 1회 이상 기록된다.
- Windows 중심 알려진 문제와 우회 방식이 문서화된다.
- macOS는 기본 smoke 결과 또는 제약이 정리된다.

#### English

Priority: `P1`

Goal:

- build Windows-first real-device usability evidence, while validating the remaining platforms mainly through smoke coverage and documented constraints

Backlog:

- verify project-open, PTY, agent approval, and restore flow on Windows
- confirm installable artifact execution on Windows
- verify the basic project/terminal smoke flow on macOS
- document known constraints

Acceptance Criteria:

- Windows first-daily-use issues are recorded for the core flow at least once
- Windows-focused known issues and workarounds are documented
- macOS smoke results or constraints are documented

### 22. 워크스페이스 리디자인 실행 / Workspace Redesign Execution

#### 한국어

우선순위: `P0`

목표:

- `/Users/kwon/Downloads/test (1)`의 새 제품 디자인 시안을 기존 구현보다 우선하는 기준으로 삼고, 현재 워크스페이스를 새 shell, left accordion, unified workbench, agent/settings/approval 구조로 다시 짠다.

백로그 항목:

- titlebar/statusbar 기반 shell로 기존 mission header를 대체
- 좌측 `Projects/Files` accordion과 compact project row 구현
- editor tab과 terminal tab을 같은 중앙 workbench tab model로 통합
- tab drag/drop, context menu, 좌우/상하 split group 구현
- 우측 provider state, runtime-backed model picker, context summary, activity log, composer approval, composer 구조 구현
- `Connections`, `Models`, `Appearance`, `Execution`, `About` 설정 modal 구현
- Agent-panel approval policy, forbidden-pattern warnings, and decision history without terminal auto-run
- 요약 카드 중심 레이아웃을 작업 surface 중심 레이아웃으로 축소 또는 대체
- Task History, Telegram, Runtime/Debug를 기본 2선 영역으로 재배치
- backend snapshot, status field, action availability와 frontend UI 동작을 같은 display contract로 정렬
- `docs/frontend-design-benchmarks.md` 기준 디자인 리뷰와 `Playwright` 회귀 갱신

완료조건:

- 첫 화면이 새 디자인 시안의 titlebar/statusbar, left accordion, center workbench, right agent workspace 구조를 따른다.
- editor와 terminal이 같은 workbench tab model 안에서 동작한다.
- 좌측 panel은 `Projects`와 `Files`를 독립 accordion으로 보여준다.
- 우측 에이전트 패널이 provider/session state, runtime-backed model selection, context, thread, activity, composer, approval entry를 자연스럽게 보여준다.
- settings modal에서 provider, model, appearance, execution policy를 조정할 수 있다.
- Low-risk suggestions still require Agent-panel review, while high-risk commands and forbidden patterns require explicit approval or blocking.
- Task History, Telegram, Runtime/Debug가 기본 작업 흐름을 방해하지 않는다.
- backend 상태와 frontend 버튼/뱃지/패널 동작이 서로 모순되지 않는다.
- 관련 UI E2E가 새 구조 기준으로 갱신된다.

#### English

Priority: `P0`

Goal:

- treat the new product design draft in `/Users/kwon/Downloads/test (1)` as higher priority than the existing implementation and rebuild the workspace around the new shell, left accordion, unified workbench, agent/settings/approval structure

Backlog:

- replace the existing mission header with a titlebar/statusbar shell
- implement the left `Projects/Files` accordion and compact project rows
- unify editor tabs and terminal tabs into the same center workbench tab model
- implement tab drag/drop, context menus, and horizontal/vertical split groups
- implement the right provider state, runtime-backed model picker, context summary, activity log, composer approval, and composer
- implement the `Connections`, `Models`, `Appearance`, `Execution`, and `About` settings modal
- implement explicit Agent-panel approval policy, forbidden-pattern warnings, and decision history without terminal auto-run
- reduce or replace summary-card-heavy layout with work-surface-first layout
- move Task History, Telegram, and Runtime/Debug into clearly secondary areas by default
- align backend snapshots, status fields, and action availability with the frontend display contract
- run design review against `docs/frontend-design-benchmarks.md` and update `Playwright` regression coverage

Acceptance Criteria:

- the first screen follows the new design's titlebar/statusbar, left accordion, center workbench, and right agent workspace structure
- editor and terminal surfaces run inside the same workbench tab model
- the left panel exposes `Projects` and `Files` as independent accordion sections
- the right agent panel presents provider/session state, runtime-backed model selection, context, thread, activity, composer, and approval entry naturally
- settings can configure providers, models, appearance, and execution policy
- low-risk suggestions still require Agent-panel review, while high-risk commands and forbidden patterns require explicit approval or blocking
- Task History, Telegram, and Runtime/Debug no longer interrupt the default workflow
- backend state and frontend button, badge, and panel behavior do not contradict each other
- related UI E2E coverage is updated for the new structure


## MVP 제외 항목 / Explicitly Out of Scope for MVP

### 한국어

아래 항목은 중요하지만 MVP 완료 조건에는 포함하지 않는다.

- 원격 협업
- 여러 장치 간 동기화
- 고급 Git 작업 UI
- 자동 머지 또는 자동 수정 에이전트
- pane 분할 고도화
- 복잡한 릴리즈 자동화
- 완전한 IDE 대체

### English

The following items matter, but are not part of the MVP completion criteria:

- remote collaboration
- multi-device sync
- advanced Git operation UI
- auto-merge or fully autonomous editing agents
- advanced pane management
- complex release automation
- full IDE replacement
- broad unrestricted remote control over the app from external channels
- Telegram-based remote reporting and command flows before the core desktop MVP is complete

## 우선 구현 순서 / Recommended Delivery Order

### 한국어

1. 앱 셸과 개발 기반
2. 프로젝트 열기와 파일 탐색
3. Git 상태 표시
4. 멀티 탭 터미널
5. 에이전트 로그인 연결
6. Provider Adapter 공통화
7. 에이전트 패널과 제안 UI
8. 프로젝트 컨텍스트 읽기
9. 승인 기반 명령 실행
10. 워크스페이스 저장
11. 작업 이력과 기본 상태
12. 실행 모드 초기 적용
13. 크로스 플랫폼 검증

### English

1. app shell and foundation
2. project open and file exploration
3. Git state visibility
4. multi-tab terminal
5. agent login connection
6. shared provider adapter layer
7. agent panel and suggestion UI
8. project context reading
9. approval-based command execution
10. workspace persistence
11. task history and basic status
12. initial execution modes
13. cross-platform validation
14. external report and remote command channels

## 리스크가 큰 선행 과제 / Highest-Risk Early Items

### 한국어

초기에 빠르게 검증해야 할 리스크 항목은 다음과 같다.

- Tauri 환경에서 PTY 계층 안정성
- Ubuntu, Windows, macOS 간 셸 차이
- Codex OAuth/session login 경로와 데스크톱 callback 처리 안정성
- provider 응답 모델 공통화 난이도

### English

The highest-risk items that should be validated early are:

- PTY stability inside the Tauri runtime
- shell behavior differences across Ubuntu, Windows, and macOS
- stability of the Codex OAuth/session login path and desktop callback handling
- difficulty of normalizing provider response models

## 다음 문서 제안 / Recommended Next Document

### 한국어

이 문서를 바탕으로 다음 단계에서는 `docs/sprint-plan.md`를 작성해 실제 스프린트 단위 목표와 산출물을 정리하는 것이 좋다.

### English

Based on this backlog, the next step should be `docs/sprint-plan.md` to define sprint-level goals and deliverables.

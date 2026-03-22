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

## MVP 한 줄 정의 / One-Line MVP Definition

### 한국어

`gtum`의 MVP는 Ubuntu, Windows, macOS에서 로컬 프로젝트를 열고, 멀티 탭 터미널을 사용하며, Codex 또는 Claude 계정을 로그인 방식으로 연결해 프로젝트와 터미널 맥락을 읽는 에이전트의 제안을 승인 기반으로 실행할 수 있는 데스크톱 앱이다.

### English

The MVP of `gtum` is a desktop app for Ubuntu, Windows, and macOS where users can open local projects, work with multi-tab terminals, connect Codex or Claude through login-based flows, and execute agent suggestions with project and terminal awareness under user approval.

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

## MVP 완료 정의 / MVP Definition of Done

### 한국어

아래 조건이 모두 충족되면 MVP가 완료된 것으로 본다.

1. 사용자가 로컬 프로젝트를 열 수 있다.
2. 파일 트리와 현재 Git 브랜치 및 dirty state를 볼 수 있다.
3. 탭 단위로 독립적인 터미널 세션을 만들고 종료할 수 있다.
4. 터미널 출력과 기본 세션 상태가 유지된다.
5. Codex 또는 Claude 계정을 앱 안에서 로그인 기반으로 연결할 수 있다.
6. 에이전트가 프로젝트 맥락과 현재 탭 출력을 읽어 제안을 생성할 수 있다.
7. 사용자가 제안된 명령을 검토하고 승인 후 실행할 수 있다.
8. 작업 이력과 기본적인 에이전트 상태를 UI에서 확인할 수 있다.
9. 앱이 Ubuntu, Windows, macOS를 지원하는 구조로 동작한다.
10. 현재 테스트 중인 터미널 로그를 에이전트 제안 흐름에 연결할 수 있다.

### English

The MVP is considered complete when all of the following are true:

1. users can open a local project
2. users can view the file tree, current Git branch, and dirty state
3. users can create and close isolated terminal sessions by tab
4. terminal output and basic session state are preserved
5. users can connect Codex or Claude through in-app login-based flows
6. an agent can read project context and current terminal output to generate suggestions
7. users can review and approve suggested commands before execution
8. task history and basic agent state are visible in the UI
9. the app works within a cross-platform architecture targeting Ubuntu, Windows, and macOS
10. live logs from active testing terminals can be attached to agent suggestion flows

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
- 최소한 `master`, `develop`, `feature/*`, `release/*`, `hotfix/*`를 구분 가능한 내부 구조가 있다.

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
- the internal model can distinguish at least `master`, `develop`, `feature/*`, `release/*`, and `hotfix/*`

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

Priority: `P1`

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

### 6. 에이전트 로그인 연결 / Agent Login Connection

#### 한국어

우선순위: `P0`

목표:

- 사용자가 API 토큰 입력 없이 `Codex` 또는 `Claude` 계정을 연결할 수 있게 한다.

백로그 항목:

- provider 선택 UI
- 로그인 시작 액션
- OAuth 또는 공식 로그인 콜백 처리 구조
- 세션 저장
- 연결 상태 표시

완료조건:

- 사용자가 `Codex` 또는 `Claude` 연결을 시작할 수 있다.
- 로그인 완료 후 연결 상태가 UI에 표시된다.
- 만료 또는 미연결 상태를 구분해 보여줄 수 있다.

#### English

Priority: `P0`

Goal:

- allow users to connect `Codex` or `Claude` without manual API token entry

Backlog:

- provider selection UI
- login initiation action
- OAuth or official callback handling structure
- session persistence
- connection status display

Acceptance Criteria:

- users can start connection for `Codex` or `Claude`
- after login, connection state is visible in the UI
- expired and disconnected states are distinguishable

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
- 최소한 파일 트리, 선택 파일, 현재 탭 최근 로그를 포함할 수 있다.
- 테스트 중인 활성 터미널 로그를 제안 생성 컨텍스트로 넘길 수 있다.

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
- at minimum, file tree, selected files, and recent current-tab logs can be included
- live logs from an active testing terminal can be passed into suggestion generation

### 10. 승인 기반 명령 실행 / Approval-Based Command Execution

#### 한국어

우선순위: `P0`

목표:

- 제안된 명령을 사용자가 검토한 뒤 승인 기반으로 실행하게 한다.

백로그 항목:

- 승인 다이얼로그 또는 승인 패널
- 현재 탭 실행
- 새 탭 실행
- 실행 로그 연결

완료조건:

- 에이전트 제안 명령은 자동 실행되지 않는다.
- 사용자는 현재 탭 또는 새 탭을 선택해 실행할 수 있다.
- 실행 결과가 터미널과 작업 이력에 연결된다.

#### English

Priority: `P0`

Goal:

- ensure suggested commands execute only through user approval

Backlog:

- approval dialog or approval panel
- execute in current tab
- execute in new tab
- link execution results to logs

Acceptance Criteria:

- agent-suggested commands never auto-run by default
- users can choose current tab or new tab as the target
- execution results are tied to terminal output and task history

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

### 12. 실행 모드 초기 적용 / Initial Execution Modes

#### 한국어

우선순위: `P1`

목표:

- `fast`, `balanced`, `deep` 모드를 정책 수준에서 처음 적용한다.

백로그 항목:

- 모드 선택 UI
- 모드별 context limit 정의
- 모드별 worker limit 정의
- 모드별 provider 옵션 연결

완료조건:

- 사용자가 모드를 선택할 수 있다.
- 최소한 모드에 따라 컨텍스트 범위 또는 워커 수가 달라진다.

#### English

Priority: `P1`

Goal:

- apply `fast`, `balanced`, and `deep` at an initial policy level

Backlog:

- mode selector UI
- per-mode context limits
- per-mode worker limits
- per-mode provider option wiring

Acceptance Criteria:

- users can select an execution mode
- at minimum, context scope or worker count changes by mode

### 13. 크로스 플랫폼 검증 / Cross-Platform Validation

#### 한국어

우선순위: `P1`

목표:

- Ubuntu, Windows, macOS 기준으로 구조적 호환성을 검증한다.

백로그 항목:

- 셸 탐지 검증
- 기본 경로 처리 검증
- PTY 동작 차이 확인
- 로그인 콜백 흐름 차이 점검

완료조건:

- 세 플랫폼 모두에서 주요 구조가 깨지지 않는다는 근거가 있다.
- 최소한 플랫폼별 알려진 제약과 우회 방식이 문서화된다.

#### English

Priority: `P1`

Goal:

- validate structural compatibility across Ubuntu, Windows, and macOS

Backlog:

- shell detection validation
- path handling validation
- PTY behavior checks
- login callback flow checks

Acceptance Criteria:

- there is evidence that the major architecture holds across all three platforms
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
- Codex, Claude의 공식 로그인 통합 가능성
- provider 응답 모델 공통화 난이도

### English

The highest-risk items that should be validated early are:

- PTY stability inside the Tauri runtime
- shell behavior differences across Ubuntu, Windows, and macOS
- feasibility of official login integration for Codex and Claude
- difficulty of normalizing provider response models

## 다음 문서 제안 / Recommended Next Document

### 한국어

이 문서를 바탕으로 다음 단계에서는 `docs/sprint-plan.md`를 작성해 실제 스프린트 단위 목표와 산출물을 정리하는 것이 좋다.

### English

Based on this backlog, the next step should be `docs/sprint-plan.md` to define sprint-level goals and deliverables.

# gtum 기술 설계서 / Technical Design

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`의 1차 구현을 위한 기술 설계 기준 문서다.

이 문서의 목적은 다음과 같다.

- 제품 기획을 실제 구현 구조로 구체화한다.
- 프론트엔드와 런타임의 책임을 나눈다.
- 크로스 플랫폼 대응 방식을 미리 정의한다.
- 에이전트 실행, 인증, 터미널 세션 관리의 경계를 정한다.

### English

This document is the technical design reference for the first implementation of `gtum`.

Its purpose is to:

- translate the product plan into implementation structure
- divide responsibility between frontend and runtime layers
- define cross-platform handling up front
- establish boundaries for agent execution, authentication, and terminal session management

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 아키텍처, 런타임 책임, 플랫폼 전략, auth 구조를 확인해야 할 때
- Tauri command, 상태 계약, PTY, filesystem, provider adapter 같은 기술 경계를 바꿀 때

### English

Read this document when:

- you need to confirm architecture, runtime ownership, platform strategy, or auth structure
- you are changing technical boundaries such as Tauri commands, state contracts, PTY, filesystem, or provider adapters

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 기술 문서다. 기본값은 전체 통독이 아니라 아래 경로만 읽는 것이다.

- 현재 구현 구조와 저장 경계가 궁금할 때
  - `architecture.md`를 먼저 읽는다.
- request, approval, restore, provider request envelope이 궁금할 때
  - `message-flow.md`를 먼저 읽는다.
- 구현 규칙, 문서 흡수, `WORKLOG` 수명 주기가 궁금할 때
  - `development-guide.md`를 먼저 읽는다.
- Tauri command, provider/auth, PTY, cross-platform 정책처럼 기술 경계 자체를 바꿀 때
  - 그때만 이 문서를 계속 읽는다.

### English

This document exceeds 200 lines. Do not reread it fully by default. Use one route below instead.

- when you need current implementation structure or persistence boundaries
  - read `architecture.md` first
- when you need request, approval, restore, or provider request-envelope behavior
  - read `message-flow.md` first
- when you need implementation rules, doc absorption, or `WORKLOG` lifecycle policy
  - read `development-guide.md` first
- only continue through this doc when you are changing technical boundaries such as Tauri commands, provider/auth, PTY, or cross-platform policy

## 관련 source of truth / Related Source Of Truth

### 한국어

이 문서는 기술 방향과 경계를 정의한다. 아래 문서는 함께 읽는다.

- [`architecture.md`](./architecture.md)
  - 현재 구현 구조, 모듈 책임, 저장 경계
- [`message-flow.md`](./message-flow.md)
  - request envelope, approval, restore, 주요 사용자 흐름
- [`development-guide.md`](./development-guide.md)
  - 구현 규칙, 문서 흡수 기준, `WORKLOG` 수명 주기 정책

### English

This document defines technical direction and boundaries. Read these alongside it:

- [`architecture.md`](./architecture.md)
  - current implementation structure, module ownership, and persistence boundaries
- [`message-flow.md`](./message-flow.md)
  - request envelope, approval, restore, and major user flows
- [`development-guide.md`](./development-guide.md)
  - implementation rules, doc-absorption policy, and the `WORKLOG` lifecycle policy

## 설계 기준 / Design Constraints

### 한국어

이 문서는 아래 결정을 전제로 한다.

- 데스크톱 런타임은 `Tauri`
- 시스템 레이어는 `Rust`
- UI 레이어는 `React + TypeScript + Vite`
- 터미널 렌더링은 `xterm.js`
- 상태 관리는 `Zustand`
- 지원 플랫폼은 `Ubuntu`, `Windows`, `macOS`
- 첫 실사용 기준 플랫폼은 `Windows`
- 에이전트 제공자는 초기 기준 `Codex`, `Claude`
- 첫 실사용 `Codex` 경로의 source of truth는 `OAuth/session login`이다
- `OPENAI_API_KEY` 기반 bridge가 있더라도 개발용 임시 경로로만 취급한다

### English

This document assumes the following decisions:

- desktop runtime: `Tauri`
- system layer: `Rust`
- UI layer: `React + TypeScript + Vite`
- terminal rendering: `xterm.js`
- state management: `Zustand`
- supported platforms: `Ubuntu`, `Windows`, `macOS`
- first daily-use baseline platform: `Windows`
- initial agent providers: `Codex`, `Claude`
- the source-of-truth first daily-use `Codex` path is `OAuth/session login`
- any `OPENAI_API_KEY` bridge should be treated as a temporary development path only

## 전체 아키텍처 / High-Level Architecture

### 한국어

`gtum`은 크게 네 계층으로 나눈다.

1. `UI Layer`
   React 기반 화면, 탭, 패널, 승인 UI
2. `Application Layer`
   프로젝트 상태, 워크스페이스 상태, 작업 큐, 에이전트 오케스트레이션
3. `Runtime Layer`
   PTY 세션, 프로세스 실행, 파일 시스템, OS 차이 흡수
4. `Provider Layer`
   `Codex`, `Claude` 로그인 세션과 요청 어댑터

### English

`gtum` is divided into four major layers:

1. `UI Layer`
   React-based screens, tabs, panels, and approval UI
2. `Application Layer`
   project state, workspace state, task queue, and agent orchestration
3. `Runtime Layer`
   PTY sessions, process execution, filesystem access, and OS abstraction
4. `Provider Layer`
   `Codex` and `Claude` login sessions and request adapters

## 권장 폴더 구조 / Recommended Folder Structure

### 한국어

초기 구조는 아래와 같이 시작하는 것을 권장한다.

```text
src/
  app/
    App.tsx
  features/
    projects/
      model/
    workspace/
      model/
    terminals/
      model/
    agents/
      model/
    auth/
      model/
    tasks/
      model/
    telegram/
      model/
  widgets/
    project-sidebar/
      ui/
    workspace-stage/
      ui/
    agent-sidebar/
      ui/
  shared/
    lib/
    ui/
  stores/
  lib/
src-tauri/
  src/
    commands/
    runtime/
      pty/
      process/
      filesystem/
      platform/
    providers/
      auth/
      codex/
      claude/
    state/
  tauri.conf.json
docs/
```

### English

The recommended initial structure is:

```text
src/
  app/
    App.tsx
  features/
    projects/
      model/
    workspace/
      model/
    terminals/
      model/
    agents/
      model/
    auth/
      model/
    tasks/
      model/
    telegram/
      model/
  widgets/
    project-sidebar/
      ui/
    workspace-stage/
      ui/
    agent-sidebar/
      ui/
  shared/
    lib/
    ui/
  stores/
  lib/
src-tauri/
  src/
    commands/
    runtime/
      pty/
      process/
      filesystem/
      platform/
    providers/
      auth/
      codex/
      claude/
    state/
  tauri.conf.json
docs/
```

## 프론트엔드 구조 / Frontend Structure

### 한국어

프론트엔드는 기능 단위로 나누는 것이 좋다.

#### 주요 기능 모듈

- `projects`
  - 프로젝트 목록, 최근 프로젝트, Git 상태 요약, 브랜치 정보 표시
- `workspace`
  - 레이아웃, 패널 열기/닫기, 활성 컨텍스트
- `terminals`
  - 탭 바, 터미널 뷰, 세션 상태 표시
- `agents`
  - 에이전트 패널, 제안 카드, 실행 승인 UI
- `auth`
  - 제공자 로그인, 세션 상태, 권한 범위 표시
- `tasks`
  - 작업 큐, 실행 이력, 경로 요약, 상태 업데이트
- `settings`
  - 플랫폼 설정, 단축키, 셸 설정, 실험 기능

#### 현재 구현 기준선

- `app`
  - `src/App.tsx`는 얇은 entrypoint이고 `src/app/App.tsx`가 composition root다.
- `features/*/model`
  - 프로젝트, terminal, auth, agent, Telegram 흐름 로직은 가능한 한 순수 `TypeScript` helper와 feature hook으로 내린다.
- `widgets/*/ui`
  - 좌측 project rail, 중앙 workspace stage, 우측 agent rail처럼 큰 workbench zone 단위로 자른다.
- `shared/lib`, `shared/ui`
  - tree recursion, file snippet, line reference, formatter 같은 cross-feature helper를 둔다.
- `stores`
  - layout visibility, active tab, captured agent context 같은 전역 workspace state만 남긴다.

#### UI 검증 원칙

- UI 핵심 흐름은 `Playwright` 같은 브라우저/앱 자동화 도구로 E2E 검증한다.
- 각 스프린트에서 사용자에게 새로 드러나는 흐름은 최소 1개 이상의 E2E 시나리오로 남긴다.
- smoke test와 기능별 시나리오를 구분하고, 스프린트 종료 시 smoke test는 항상 통과 상태를 목표로 한다.
- Tauri 데스크톱 런타임과 웹 프론트엔드 검증을 분리하되, 가능한 한 같은 사용자 흐름 이름을 유지한다.
- 프론트엔드 레이아웃과 상호작용은 `docs/frontend-design-benchmarks.md`를 기준으로 검토한다.
- UI 토큰, 색상, 반경, 컴포넌트 상태 표현은 `docs/design-system.md`를 기준으로 검토한다.
- 디자인 검토 시 `VS Code`의 editor hierarchy, `conductor`의 agent workflow, `cmux`의 tabbed terminal strength가 유지되는지 확인한다.
- UI는 task history와 실행 이력이 사용자가 밟아온 승인, 실패, 재시도 경로를 재구성할 수 있을 정도로 남는지 확인한다.
- 프론트엔드 구현은 프레임워크 관용성보다 에이전트가 수정하기 쉬운 단순한 `TypeScript` 구조를 우선할 수 있다.
- FSD-style 분해를 쓰더라도 기본 단위는 card fragment가 아니라 workbench zone이어야 한다.
- `app -> widgets -> features -> shared` 경계를 쓰더라도 `editor + agent-workbench`의 co-primary surface와 `tabbed terminal mode` 기준은 그대로 유지해야 한다.
- 중앙 workbench는 빈 상태, `+` 탭 생성, 상하좌우 pane split, pane 간 탭 이동을 모두 1급 기능으로 본다.
- 프로젝트 열기와 전환은 상단 project-tab manager보다 좌측 rail에서 처리하는 방향을 우선한다.
- 기본 레이아웃에서 하단 panel은 제거 가능한 대상으로 보고, 필요한 결과는 pane이나 contextual surface로 푼다.

#### 상태 관리 원칙

- 전역 상태는 `Zustand` 스토어로 관리한다.
- UI 일시 상태와 장기 워크스페이스 상태를 구분한다.
- 터미널 출력 전체를 React state에 직접 쌓지 않고, 버퍼 참조와 뷰 상태를 분리한다.
- 에이전트 응답 스트림과 작업 상태는 이벤트 기반으로 업데이트한다.

### English

The frontend should be organized by feature domain.

#### Main Feature Modules

- `projects`
  - project list, recent projects, Git status summary, branch visibility
- `workspace`
  - layout, panel visibility, active context
- `terminals`
  - tab bar, terminal view, session status
- `agents`
  - agent panel, suggestion cards, execution approval UI
- `auth`
  - provider login, session state, granted scope visibility
- `tasks`
  - task queue, execution history, path recap, and status updates
- `settings`
  - platform settings, shortcuts, shell settings, experimental features

#### Current Implemented Baseline

- `app`
  - `index.html` loads `src/app/main.tsx`.
  - `src/app/main.tsx` is the active TSX entrypoint for the uploaded design migration.
  - `src/app/providers/legacy-prototype.ts` imports the current uploaded JSX prototype until each workbench zone is extracted into TSX components.
- `entities/*/model`
  - hold reusable typed domain shapes for project, workspace, and agent data.
- `features/*/model`
  - hold feature contracts such as workbench tab layout and approval policy logic.
- `shared/api`
  - holds backend-facing service seams such as `src/shared/api/runtimeProjects.ts`, which wraps Tauri project overview and file-read commands with browser fallback.
  - includes `src/shared/api/runtimeWindow.ts`, the browser-safe seam for Tauri native window controls (`minimize`, `close`, `toggleMaximize`, `isMaximized`, and `startDragging`) used by the custom frameless titlebar.
- `shared/lib`, `shared/types`
  - hold cross-feature helpers and compatibility types needed while the uploaded design moves from JSX to TSX.
- `widgets/*/ui`
  - remains the target extraction layer for major workbench zones such as titlebar, sidebar, center workspace, right agent panel, and modals.

#### UI Verification Principles

- validate core UI flows with an E2E automation tool such as `Playwright`
- each sprint should leave behind at least one E2E scenario for the new user-facing flow it delivers
- separate smoke tests from feature-specific scenarios, and aim to keep smoke tests green at the end of every sprint
- separate Tauri desktop verification from web-frontend verification, but keep the user-flow naming aligned across both
- review frontend layout and interaction quality against `docs/frontend-design-benchmarks.md`
- review UI tokens, colors, radius, and component state representation against `docs/design-system.md`
- check whether the UI still preserves the editor hierarchy of `VS Code`, the agent-workflow clarity of `conductor`, and the tabbed-terminal strength of `cmux`
- make sure task history and execution history remain legible enough for users to reconstruct approvals, failures, and retries
- prefer frontend implementation patterns that are easy for agents to edit, even if that means reducing framework-heavy abstractions in favor of simpler `TypeScript` structures
- when using an FSD-style split, prefer workbench-zone boundaries over fragmenting the UI into many small dashboard cards
- keep the co-primary `editor + agent-workbench` surface intact while decomposing widgets and features, and keep the terminal as a strong switchable mode

## 테스트 전략 / Testing Strategy

### 한국어

`gtum`은 최소한 아래 세 층의 검증을 가진다.

1. `Unit / Module`
   상태 스토어, 유틸리티, 런타임 헬퍼
2. `Integration`
   Tauri command와 프론트 연결, 파일 시스템 및 Git 읽기
3. `UI E2E`
   Playwright 기반 주요 사용자 흐름 검증

초기 E2E 기준은 다음을 권장한다.

- Sprint 0: 앱 셸 smoke test
- Sprint 1: 프로젝트 열기, 파일 트리, Git 상태 표시
- Sprint 2: 멀티 탭 터미널 생성과 활성 탭 전환
- 이후 스프린트: 로그인, 제안 확인, 승인 기반 실행, 작업 이력

### English

`gtum` should keep at least the following three testing layers:

1. `Unit / Module`
   state stores, utilities, and runtime helpers
2. `Integration`
   Tauri command-to-frontend wiring plus filesystem and Git reads
3. `UI E2E`
   major user-flow verification with Playwright

Recommended initial E2E coverage:

- Sprint 0: app-shell smoke test
- Sprint 1: project open, file tree, and Git status visibility
- Sprint 2: multi-tab terminal creation and active-tab switching
- later sprints: selected-file viewing, login, suggestion review, approval-based execution, and task history

### Aging Test Strategy

### 한국어

MVP 최종 검증에는 `aging test`를 포함한다. 목적은 짧은 데모에서는 보이지 않는 상태 누수, UI 누적 문제, 세션 불안정성을 드러내는 것이다.

초기 aging test 기준:

- 일정 시간 이상 앱을 유지 실행한다.
- 프로젝트 열기, 재진입, 탭 전환, 로그 확인을 반복한다.
- 메모리, 상태 꼬임, 패널 렌더링 이상, 세션 끊김 여부를 확인한다.

권장 위치:

- Sprint 5에서 크로스 플랫폼 검증과 함께 수행
- 필요 시 Sprint 2 이후 터미널 안정성에 대해 부분 aging test를 먼저 도입

### English

Final MVP validation should include an `aging test`. Its purpose is to reveal state leaks, UI accumulation issues, and session instability that may not appear in short demos.

Initial aging-test baseline:

- keep the app running for an extended period
- repeat project-open, re-entry, tab switching, and log inspection flows
- watch for memory growth, broken state, panel rendering issues, and session drops

Recommended placement:

- run it together with cross-platform validation in Sprint 5
- introduce partial aging coverage earlier after Sprint 2 if terminal stability needs earlier proof

#### State Management Principles

- manage shared app state with `Zustand`
- separate transient UI state from durable workspace state
- do not push full terminal output directly into React state; separate buffer ownership from view state
- update agent streams and task state through event-driven flows

## 런타임 구조 / Runtime Structure

### 한국어

Rust 런타임은 아래 책임을 가진다.

- PTY 생성과 종료
- 셸 프로세스 실행과 제어
- 파일 시스템 접근
- 크로스 플랫폼 차이 추상화
- 로그인 세션 저장과 보안 처리
- 프론트엔드에 안전한 Tauri command 제공

#### 권장 모듈

- `runtime/pty`
  - PTY 생성, 입출력 연결, resize, 종료 처리
- `runtime/process`
  - 일반 프로세스 실행, 권한 분기, 백그라운드 작업
- `runtime/filesystem`
  - 프로젝트 탐색, 파일 읽기, 메타데이터 수집
- `runtime/platform`
  - OS별 셸, 경로, 환경 변수, 권한 처리
- `providers/auth`
  - OAuth/session 로그인 시작, callback 처리, 세션 저장
- `providers/codex`
  - Codex provider adapter
- `providers/claude`
  - Claude provider adapter

### English

The Rust runtime is responsible for:

- PTY creation and teardown
- shell process execution and control
- filesystem access
- cross-platform abstraction
- login session storage and security handling
- exposing safe Tauri commands to the frontend

#### Recommended Modules

- `runtime/pty`
  - PTY creation, IO wiring, resize, termination
- `runtime/process`
  - generic process execution, permission routing, background jobs
- `runtime/filesystem`
  - project scanning, file reads, metadata collection
- `runtime/platform`
  - OS-specific shell, path, env, and permission handling
- `providers/auth`
  - OAuth/session login start, callback handling, session storage
- `providers/codex`
  - Codex provider adapter
- `providers/claude`
  - Claude provider adapter

## 코드 읽기 surface와 요청 envelope / Code-Reading Surface And Request Envelope

### 한국어

첫 code-reading 슬라이스는 full editor가 아니라 read-only viewer로 시작한다.

#### 목적

- 메인 워크스페이스에서 terminal과 code surface를 동시에 유지한다.
- 선택 파일을 agent request의 1급 컨텍스트로 올린다.
- approval review에서 어떤 파일 맥락을 보고 제안이 생성됐는지 다시 읽을 수 있게 한다.

#### 런타임 계약

- `read_project_overview(path, maxDepth)`
  - 프로젝트 메타데이터, 파일 트리, Git 개요
- `read_project_file(projectPath, filePath)`
  - 선택 파일 읽기 전용 snapshot 반환
  - project root 밖의 경로는 거부
  - binary 파일은 text preview 대신 bounded fallback 반환
  - 큰 파일은 제한된 크기만 읽고 `truncated` 상태를 반환

#### 프론트엔드 상태

- `selectedFilePath`
- `selectedFileLine`
- `selectedFileSnapshot`
- `isFileLoading`
- `fileError`

선택 파일 상태는 workspace restore와 함께 다시 열 수 있는 수준까지만 유지하고, 실제 편집 상태는 아직 들고 가지 않는다.

#### restore와 fallback 규칙

- restore는 `project + selectedFilePath + selectedFileLine` 기준으로 best-effort 복원을 시도한다.
- 복원 대상 파일이 사라졌거나 root 밖으로 벗어나면 first-file fallback으로 내려간다.
- line anchor가 현재 preview 범위 또는 line count를 벗어나면 가장 가까운 유효 line 또는 no-anchor 상태로 clamp한다.
- binary 파일은 viewer fallback을 보여주되 line anchor는 비활성화한다.
- large file은 bounded preview만 보여주며 `truncated` 상태를 유지한다.

#### provider request envelope

초기 request envelope은 아래 필드를 포함한다.

- `projectPath`
- `projectName`
- `activeTabId`
- `activeTabTitle`
- `activeFilePath`
- `activeFileLine`
- `activeFileSnippet`
- `lastNLogLines`
- `userTask`
- `executionMode`

`activeFileSnippet`은 선택 파일 전체가 아니라 preview용 excerpt일 수 있으며, terminal 로그와 같이 bounded size를 유지한다.
line anchor가 있으면 snippet은 anchor 근처 excerpt를 우선 사용한다.

### English

The first code-reading slice should start as a read-only viewer rather than a full editor.

#### Goals

- keep the editor surface primary while leaving the terminal reachable through workbench mode tabs
- promote the selected file into first-class agent-request context
- let the approval review restate which file context the suggestion was based on

#### Runtime Contract

- `read_project_overview(path, maxDepth)`
  - project metadata, file tree, and Git overview
- `read_project_file(projectPath, filePath)`
  - returns a read-only snapshot of the selected file
  - reject paths outside the active project root
  - return a bounded fallback instead of raw text for binary files
  - read only a limited amount for large files and surface `truncated`

#### Frontend State

- `selectedFilePath`
- `selectedFileLine`
- `selectedFileSnapshot`
- `isFileLoading`
- `fileError`

Selected-file state should be restorable at the workspace level, but should not introduce full editing state yet.

#### Restore And Fallback Rules

- restore should attempt best-effort recovery from `project + selectedFilePath + selectedFileLine`
- if the stored file is missing or outside the project root, fall back to the first readable file
- if the stored line anchor is outside the preview range or current line count, clamp to the nearest valid line or clear the anchor
- binary files should keep the viewer fallback and disable line anchors
- large files should keep a bounded preview and preserve the `truncated` state

#### Provider Request Envelope

The initial request envelope for this slice includes:

- `projectPath`
- `projectName`
- `activeTabId`
- `activeTabTitle`
- `activeFilePath`
- `activeFileLine`
- `activeFileSnippet`
- `lastNLogLines`
- `userTask`
- `executionMode`

`activeFileSnippet` may be a bounded preview excerpt rather than the full file and should stay size-limited in the same spirit as attached terminal logs.
When a line anchor exists, the snippet should prefer the anchored region rather than only the top of the file.

## 터미널 세션 설계 / Terminal Session Design

### 한국어

터미널은 단순 텍스트 뷰가 아니라 장기 세션 객체로 다뤄야 한다.

#### 핵심 요구사항

- 탭마다 독립적인 PTY 세션
- 탭 이름, 현재 경로, 상태 유지
- 스크롤백 유지
- resize 이벤트 반영
- 세션 종료 감지
- 재연결 또는 세션 복원 전략

#### 권장 데이터 모델

- `TerminalSession`
  - `id`
  - `projectId`
  - `tabId`
  - `shell`
  - `cwd`
  - `status`
  - `pid`
  - `platform`
- `TerminalBufferRef`
  - `sessionId`
  - `bufferKey`
  - `lineCount`
  - `lastUpdatedAt`

#### 구현 메모

- Ubuntu와 macOS는 POSIX 셸 기반 흐름을 공통화할 수 있다.
- Windows는 `powershell`, `pwsh`, `cmd` 차이를 흡수하는 별도 셸 전략이 필요하다.
- 운영체제마다 기본 셸 탐지 로직을 두고, 사용자가 설정에서 재정의할 수 있게 한다.

### English

The terminal should be treated as a long-lived session object, not just a text view.

#### Core Requirements

- one isolated PTY session per tab
- preserved tab title, cwd, and status
- scrollback retention
- resize handling
- session termination detection
- reconnection or restoration strategy

#### Recommended Data Model

- `TerminalSession`
  - `id`
  - `projectId`
  - `tabId`
  - `shell`
  - `cwd`
  - `status`
  - `pid`
  - `platform`
- `TerminalBufferRef`
  - `sessionId`
  - `bufferKey`
  - `lineCount`
  - `lastUpdatedAt`

#### Implementation Notes

- Ubuntu and macOS can share a common POSIX shell flow
- Windows needs a dedicated shell strategy that abstracts `powershell`, `pwsh`, and `cmd`
- detect default shells per OS and allow users to override them in settings

## 크로스 플랫폼 전략 / Cross-Platform Strategy

### 한국어

지원 플랫폼이 `Ubuntu`, `Windows`, `macOS`인 만큼 OS 차이를 분리하는 추상화가 필요하다.

구조적 지원 범위는 세 플랫폼 전체를 포함하지만, 첫 실사용 기준 흐름과 UX 마찰 평가는 Windows를 우선 기준으로 둔다.

#### 추상화 대상

- 기본 셸 탐지
- 경로 구분자와 홈 디렉토리 해석
- PTY 라이브러리 차이
- 환경 변수 접근 방식
- 단축키와 시스템 메뉴 동작
- 파일 열기, URL 열기, 브라우저 로그인 리디렉션 처리

#### 설계 원칙

- UI는 가능한 한 OS 세부사항을 직접 알지 않게 한다.
- 플랫폼 분기는 Rust 런타임 계층에 최대한 모은다.
- 프론트엔드에는 정규화된 정보만 전달한다.
- OS별 예외 처리는 기능 구현 시점이 아니라 기본 인프라 단계에서 정의한다.
- Windows의 경로, 셸, 폴더 선택기, 줄바꿈 차이는 첫 실사용 기준 항목으로 우선 검증한다.

### English

Because `gtum` supports `Ubuntu`, `Windows`, and `macOS`, OS differences need explicit abstraction.

The structural support scope still covers all three platforms, but the first daily-use flow and UX-friction baseline are evaluated on Windows first.

#### What Must Be Abstracted

- default shell detection
- path separators and home directory resolution
- PTY library differences
- environment variable access
- shortcuts and system menu behavior
- opening files, opening URLs, and provider diagnostics or setup affordances

#### Design Principles

- the UI should avoid knowing OS-specific details directly
- platform branching should live primarily in the Rust runtime layer
- only normalized information should be exposed to the frontend
- OS-specific exception handling should be designed into the infrastructure layer early
- Windows path handling, shell behavior, folder-picker behavior, and newline differences should be validated first as part of the initial daily-use baseline

## Git 워크플로우 설계 / Git Workflow Design

### 한국어

현재 저장소는 `master`만 존재하지만, 구현이 시작되면 `git flow` 개념을 반영한 브랜치 운영을 도입하는 것을 권장한다.

#### 권장 브랜치 역할

- `master`
  - 안정 기준 브랜치
- `dev`
  - 통합 개발 브랜치
- `feature/*`
  - 기능 개발과 문서 작업
- `release/*`
  - 릴리즈 안정화
- `hotfix/*`
  - 긴급 수정

#### 애플리케이션 관점 요구사항

- 프로젝트 패널은 현재 브랜치와 dirty state를 표시해야 한다.
- 에이전트 제안은 현재 브랜치 컨텍스트를 함께 참조해야 한다.
- 작업 이력과 제안 로그는 가능하면 브랜치 맥락과 연결되는 것이 좋다.
- 브랜치 전환과 생성은 초기에는 필수 기능이 아니지만, 후속 확장 가능성을 열어둔다.

#### 구현 메모

- MVP에서는 읽기 중심 Git 상태 표시를 우선한다.
- 브랜치 생성, 머지, 릴리즈 보조 UI는 후속 단계로 미룬다.
- 내부 상태 모델은 처음부터 `feature/*`, `release/*`, `hotfix/*` 같은 패턴을 수용할 수 있어야 한다.

### English

The repository currently only has `master`, but once implementation begins, the product should adopt a workflow compatible with lightweight `git flow` concepts.

#### Recommended Branch Roles

- `master`
  - stable baseline branch
- `dev`
  - integration branch
- `feature/*`
  - feature and documentation work
- `release/*`
  - release stabilization
- `hotfix/*`
  - urgent fixes

#### Application-Level Requirements

- the project panel should show current branch and dirty state
- agent suggestions should include current branch context
- task history and suggestion logs should ideally be tied to branch context
- branch switching and creation are not required for MVP, but should remain future-compatible

#### Implementation Notes

- for MVP, prioritize read-only Git status visibility
- branch creation, merge support, and release helper UI can come later
- internal state models should support patterns such as `feature/*`, `release/*`, and `hotfix/*` from the start

## Git 상태 모델 / Git State Model

### 한국어

프로젝트 상태에는 최소한 아래 Git 정보를 포함하는 것이 좋다.

- `currentBranch`
- `isDirty`
- `changedFilesCount`
- `aheadCount`
- `behindCount`
- `branchType`

`branchType`은 아래 값으로 정규화할 수 있다.

- `master`
- `dev`
- `feature`
- `release`
- `hotfix`
- `other`

### English

Project state should include at least the following Git metadata:

- `currentBranch`
- `isDirty`
- `changedFilesCount`
- `aheadCount`
- `behindCount`
- `branchType`

`branchType` may be normalized into:

- `master`
- `dev`
- `feature`
- `release`
- `hotfix`
- `other`

## 에이전트 제공자 구조 / Agent Provider Architecture

### 한국어

초기 제공자는 `Codex`와 `Claude` 두 가지다.

#### 핵심 원칙

- UI는 provider-specific API를 직접 다루지 않는다.
- 애플리케이션 레이어는 공통 인터페이스만 사용한다.
- 실제 로그인 세션, 권한 상태, 요청 전송은 provider adapter가 담당한다.
- 개발용 임시 bridge가 있더라도 앱의 기본 UX와 release contract를 정의하지 않는다.

#### 공통 인터페이스 예시

- `connect()`
- `disconnect()`
- `getSession()`
- `sendTask()`
- `streamResponse()`
- `listCapabilities()`

#### provider별 책임

- `CodexAdapter`
  - OAuth/session login 처리
  - callback 또는 desktop sign-in completion 처리
  - 작업 요청 전송
  - 응답 스트리밍 정규화
- `ClaudeAdapter`
  - Claude deferred path 상태 확인
  - 작업 요청 전송
  - 응답 스트리밍 정규화

### English

The initial providers are `Codex` and `Claude`.

#### Core Principles

- the UI should not deal with provider-specific APIs directly
- the application layer should depend on a shared interface only
- real login session handling, scope state, and request transport belong to provider adapters
- even if a temporary development bridge exists, it should not define the default UX or release contract

#### Example Shared Interface

- `connect()`
- `disconnect()`
- `getSession()`
- `sendTask()`
- `streamResponse()`
- `listCapabilities()`

#### Per-Provider Responsibilities

- `CodexAdapter`
  - handle OAuth/session login
  - handle callback or desktop sign-in completion
  - send task requests
  - normalize response streaming
- `ClaudeAdapter`
  - validate the Claude deferred-path state
  - send task requests
  - normalize response streaming

## 로그인 및 세션 설계 / Login and Session Design

### 한국어

첫 실사용 릴리스의 목표 경로는 `Codex`의 `OAuth/session login`이다. 현재 저장소에 env/API key bridge가 남아 있더라도 이는 개발용 임시 경로로만 간주한다.

#### 목표

- 사용자가 앱 안에서 제공자 계정을 연결할 수 있어야 한다.
- 인앱 토큰 입력 대신 브라우저 또는 데스크톱 세션 기반 로그인으로 연결한다.
- 세션 만료, 취소, scope 부족을 연결 단계와 재접속 단계에서 분명히 드러낸다.

#### 권장 흐름

1. 사용자가 `Codex` 또는 `Claude` 연결 버튼을 누른다.
2. 앱이 시스템 브라우저 또는 제공자 승인 경로를 통해 로그인 플로우를 시작한다.
3. 런타임이 callback, deep link, 또는 데스크톱 sign-in 완료를 처리한다.
4. 런타임이 세션 상태와 기본 진단 정보를 저장한다.
5. UI는 연결 상태, 권한 범위, 만료/재연결 상태를 표시한다.

#### 세션 저장 원칙

- 가능하면 운영체제의 보안 저장소를 우선 사용한다.
- 민감한 인증 정보는 평문 설정 파일에 저장하지 않는다.
- 세션 만료 또는 권한 오류를 감지하면 재로그인 상태를 UI에 명확히 표시한다.

### English

The target path for the first daily-use release is `OAuth/session login` for `Codex`. Any env/API-key bridge that remains in the repository should be treated as a temporary development path rather than the release design.

#### Goals

- users should be able to connect provider accounts from within the app
- prefer browser or desktop-session login over in-app token forms
- store connection state securely and detect expiry, cancellation, or missing-scope errors

#### Recommended Flow

1. the user clicks connect for `Codex` or `Claude`
2. the app opens the provider-approved login path in the system browser or desktop flow
3. the runtime handles the callback, deep link, or sign-in completion event
4. the runtime stores connection state and baseline diagnostics
5. the UI shows connection state, reconnect state, and granted scopes

#### Session Storage Rules

- prefer OS-level secure storage when available
- do not store sensitive credentials in plain-text config files
- if the session expires or loses scope, show a clear reconnect state in the UI

## 외부 채널 연동 설계 / External Channel Integration Design

### 한국어

`gtum`은 향후 데스크톱 앱 밖에서도 상태를 확인하고 제한된 명령을 전달할 수 있도록 외부 채널 연동을 확장 가능하게 설계하는 것이 좋다.

초기 후보 채널은 다음과 같다.

- `Telegram`

#### 목표

- 작업 완료, 실패, 승인 필요 이벤트를 외부로 전달
- 제한된 원격 명령을 수신
- 데스크톱 앱을 열지 못하는 상황에서도 최소한의 운영 가능성 제공

#### 설계 원칙

- 외부 채널은 기본 에이전트 provider와 분리된 `notification/control adapter` 계층으로 다룬다.
- 외부 채널에서 허용하는 명령은 강하게 제한한다.
- 민감한 명령은 여전히 승인 흐름 또는 2차 확인을 요구한다.
- 로그 전체를 무제한 전송하지 않고, 요약 또는 제한된 발췌를 우선한다.

#### 권장 구성요소

- `ChannelAdapter`
  - Telegram 같은 외부 채널을 위한 공통 인터페이스
- `NotificationDispatcher`
  - 작업 상태에 따라 외부 채널에 리포트 발송
- `RemoteCommandGate`
  - 외부 채널에서 들어온 명령을 검증하고 제한

### English

`gtum` should remain extensible for external channels so users can inspect status and send limited commands outside the desktop app.

The initial candidate channel is:

- `Telegram`

#### Goals

- deliver completion, failure, and approval-required events externally
- receive limited remote commands
- provide minimal operational visibility when the desktop app is not open

#### Design Principles

- treat external channels as a separate `notification/control adapter` layer, not as part of the core agent-provider layer
- strictly limit which remote commands are allowed
- sensitive commands should still require approval or a second confirmation step
- avoid streaming full logs by default; prefer summaries or bounded excerpts

#### Recommended Components

- `ChannelAdapter`
  - shared interface for channels such as Telegram
- `NotificationDispatcher`
  - sends reports to external channels based on task state
- `RemoteCommandGate`
  - validates and constrains commands arriving from external channels

## 멀티 에이전트 실행 구조 / Multi-Agent Execution Structure

### 한국어

멀티 에이전트 실행은 애플리케이션 레이어에서 오케스트레이션한다.

#### 핵심 구성요소

- `Conductor`
  - 사용자 요청을 작업 그래프로 분해
- `Task Scheduler`
  - 실행 모드에 따라 워커 수와 우선순위 결정
- `Agent Worker`
  - provider와 연결된 실제 작업 실행 단위
- `Context Store`
  - 프로젝트, 파일, 터미널, 작업 상태와 경로 요약 공유
- `Approval Gate`
  - 명령 실행과 파일 수정 전 사용자 승인 요구

#### 기본 워커 역할

- `Planner Worker`
  - 현재 스프린트 목적 정리, 다음 스프린트 초안, 레퍼런스 분석, 작업 경로 분석, 기획 문서 담당
- `Orchestrator Worker`
  - 문서/코드 기준선 확인, 작업 분해, 통합 담당
- `Designer Worker`
  - `VS Code`, `conductor`, `cmux` 기준의 정보 계층, 코드 읽기 surface, 상호작용, 와이어프레임, 작업 경로 가시화 담당
- `Frontend Worker`
  - `src/` 범위 UI와 상태 변경 담당
- `Backend Worker`
  - `src-tauri/` 범위 runtime과 contract 변경 담당
- `QA Worker`
  - 완료조건, acceptance 기준, handoff 품질, 문서/계약 정합성, 문제 분석 반영 여부 담당
- `Tester Worker`
  - `tests/` 범위 E2E, 회귀, repro, 반복 실패 근거 정리 담당

기본 스케줄링은 위 일곱 역할을 서브에이전트 기준으로 먼저 편성하고, 필요한 경우에만 탐색 전용 워커나 리뷰 전용 워커를 추가한다.

#### 실행 흐름

1. 사용자가 작업을 요청한다.
2. `Conductor`가 `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, `tester` 역할 기준으로 먼저 팀을 구성하며 계획을 세운다.
3. `Task Scheduler`가 `fast`, `balanced`, `deep` 정책을 적용한다.
4. 각 워커가 provider adapter를 통해 요청을 수행한다.
5. 결과는 공통 이벤트 형식으로 정규화되어 UI로 전달된다.

#### 소유권 경계

- `Planner Worker`는 기본적으로 제품/스프린트 문서와 레퍼런스 분석 메모를 맡는다.
- `Designer Worker`는 기본적으로 디자인 기준 문서와 와이어프레임 메모를 맡는다.
- `Frontend Worker`는 기본적으로 `src-tauri/`를 수정하지 않는다.
- `Backend Worker`는 기본적으로 `src/`를 수정하지 않는다.
- `QA Worker`는 기본적으로 acceptance 문서, 체크리스트, 검증 메모를 맡는다.
- `Tester Worker`는 `tests/`와 검증 산출물에 집중한다.
- `Orchestrator Worker`는 문서, 통합, 충돌 조정을 맡는다.

병렬성은 위 소유권 경계가 선명할 때만 늘린다.

#### UI Behavior Contract Alignment

- backend status fields, snapshot meaning, and action availability must map cleanly to frontend buttons, badges, disclosures, and disabled states
- frontend should not invent UI-only heuristics when backend can expose the contract explicitly
- when UI behavior changes, confirm whether the runtime contract or snapshot schema must also change
- treat display semantics as a shared contract, not as separate frontend and backend interpretations

### English

Multi-agent execution should be orchestrated in the application layer.

#### Core Components

- `Conductor`
  - decomposes user requests into task graphs
- `Task Scheduler`
  - decides worker count and priority based on execution mode
- `Agent Worker`
  - execution unit connected to a provider
- `Context Store`
  - shared state for project, file, terminal, task context, and path recap
- `Approval Gate`
  - requires user approval before command execution or file edits

#### Default Worker Roles

- `Planner Worker`
  - owns sprint framing, next-sprint planning, reference analysis, work-path analysis, and planning docs
- `Orchestrator Worker`
  - checks the doc and code baseline, decomposes work, and integrates results
- `Designer Worker`
  - owns hierarchy, code-reading surfaces, interactions, wireframes, and workflow visibility using `VS Code`, `conductor`, and `cmux` as references
- `Frontend Worker`
  - owns UI and state changes inside `src/`
- `Backend Worker`
  - owns runtime and contract changes inside `src-tauri/`
- `QA Worker`
  - owns acceptance criteria, handoff quality, doc/contract consistency, and whether findings are reflected in validation gates
- `Tester Worker`
  - owns E2E, regression, repro work, and recurring-failure evidence inside `tests/`

Default scheduling should start from these seven sub-agent roles and add exploration-only or review-only workers only when needed.

#### Execution Flow

1. the user submits a task
2. the `Conductor` builds a plan by first forming `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, and `tester` roles
3. the `Task Scheduler` applies `fast`, `balanced`, or `deep` policy
4. workers execute through provider adapters
5. results are normalized into a shared event format and sent to the UI

#### Ownership Boundary

- `Planner Worker` should focus on product docs, sprint docs, reference-analysis notes, and problem-analysis notes by default.
- `Designer Worker` should focus on design-guideline docs, wireframes, interaction notes, and workflow-visibility improvements by default.
- `Frontend Worker` should avoid editing `src-tauri/` by default.
- `Backend Worker` should avoid editing `src/` by default.
- `QA Worker` should focus on acceptance docs, checklists, validation notes, and whether findings are reflected in acceptance gates.
- `Tester Worker` should focus on `tests/`, validation artifacts, and repro evidence for recurring failures.
- `Orchestrator Worker` owns docs, integration, and conflict resolution.

Parallelism should be increased only when these ownership boundaries stay clear.

#### UI Behavior Contract Alignment

- backend status fields, snapshot meaning, and action availability must map cleanly to frontend buttons, badges, disclosures, and disabled states
- frontend should not rely on UI-only heuristics when backend can expose the contract explicitly
- when UI behavior changes, verify whether the runtime contract or snapshot schema must change too
- treat display semantics as a shared contract rather than separate frontend and backend interpretations

## 실행 모드 정책 / Execution Mode Policy

### 한국어

실행 모드는 UI 옵션이 아니라 스케줄링 정책이다.

#### Fast

- 더 작은 모델 우선
- 적은 파일과 짧은 로그 사용
- 제한된 병렬 워커
- 교차 리뷰 생략 가능

#### Balanced

- 기본 모드
- 적절한 컨텍스트 범위
- 제한적인 병렬 작업
- 경량 검토 포함 가능

#### Deep

- 더 넓은 컨텍스트 사용
- 더 많은 워커 사용 가능
- 테스트, 리뷰, 교차 확인 포함

### English

Execution mode is a scheduling policy, not just a UI option.

#### Fast

- prefer smaller models
- use fewer files and shorter logs
- limited parallel workers
- cross-review may be skipped

#### Balanced

- default mode
- practical context scope
- limited parallel work
- lightweight review can be included

#### Deep

- broader context
- more workers allowed
- includes testing, review, and cross-checking

## 상태 모델 / State Model

### 한국어

최소한 아래 상태 단위를 분리해야 한다.

- `ProjectState`
- `WorkspaceState`
- `TerminalState`
- `AgentSessionState`
- `TaskState`
- `AuthState`
- `SettingsState`

#### 상태 분리 원칙

- 인증 상태와 작업 상태를 분리한다.
- 터미널 버퍼 자체와 터미널 UI 상태를 분리한다.
- 프로젝트 메타데이터와 현재 활성 워크스페이스 상태를 분리한다.
- provider 세션 상태는 공통 타입으로 정규화한다.

### English

At minimum, the following state domains should be separated:

- `ProjectState`
- `WorkspaceState`
- `TerminalState`
- `AgentSessionState`
- `TaskState`
- `AuthState`
- `SettingsState`

#### Separation Rules

- separate auth state from task state
- separate terminal buffers from terminal UI state
- separate project metadata from active workspace state
- normalize provider session state into shared types
- include normalized Git branch metadata in project state

## 보안 경계 / Security Boundaries

### 한국어

`gtum`은 로컬 파일과 셸 실행을 다루기 때문에 보안 경계를 분명히 해야 한다.

#### 원칙

- 명령 실행은 항상 사용자 승인 경로를 거친다.
- 파일 수정은 승인 또는 명시적 작업 흐름 안에서만 허용한다.
- 로그인 세션과 민감 정보는 안전한 저장 계층을 사용한다.
- provider 응답은 공통 내부 포맷으로 정규화한 뒤 UI에 노출한다.

### English

Because `gtum` interacts with local files and shell execution, security boundaries must be explicit.

#### Principles

- command execution always passes through an approval path
- file edits are allowed only through approval or explicit editing flows
- login sessions and sensitive data must use secure storage
- provider responses should be normalized into shared internal formats before being exposed to the UI
- the first desktop `Codex` session-backed slice may reuse local `Codex CLI` login state and `codex exec` before deeper in-app callback handling is complete

## MVP 구현 순서 / MVP Implementation Order

### 한국어

1. Tauri + React + Vite 앱 셸 초기화
2. 프로젝트 열기와 파일 트리 기본 UI
3. PTY 기반 터미널 탭
4. 워크스페이스 상태 저장
5. 에이전트 패널 UI
6. OAuth/session 기반 provider 연결 구조
7. provider adapter 공통 인터페이스
8. 멀티 에이전트 오케스트레이션 초안
9. 실행 모드 정책 적용

### English

1. bootstrap the Tauri + React + Vite app shell
2. build project open flow and basic file tree UI
3. add PTY-backed terminal tabs
4. persist workspace state
5. add the agent panel UI
6. implement OAuth/session-based provider connection structure
7. add a shared provider adapter interface
8. implement read-only Git branch and dirty-state visibility
9. implement a first multi-agent orchestration layer
10. apply execution mode policies

## 오픈 질문 / Open Questions

### 한국어

- `Codex`와 `Claude`의 실제 공식 로그인 통합 방식이 데스크톱 앱에서 어떤 제약을 가지는가
- provider별 세션 저장 전략을 어느 수준까지 공통화할 수 있는가
- Windows PTY 계층에서 어떤 라이브러리 조합이 가장 안정적인가
- 터미널 세션 복원을 어디까지 완전 복원으로 볼 것인가

### English

- what constraints apply to the official desktop login integration paths for `Codex` and `Claude`
- how far provider session storage can be unified across providers
- which Windows PTY stack is most stable for the runtime layer
- how far terminal restoration should aim for full restoration versus partial recovery

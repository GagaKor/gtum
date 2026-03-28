# gtum 아키텍처 / Architecture

## 문서 목적 / Document Purpose

### 한국어

이 문서는 현재 저장소에 실제로 구현된 구조를 기준으로 `gtum`의 모듈 경계와 책임을 정리하는 source of truth다.

목적은 다음과 같다.

- 현재 코드 기준의 실제 구조를 빠르게 파악하게 한다.
- 프론트엔드, 런타임, provider, 저장 계층의 경계를 분명히 한다.
- 스프린트 중 생긴 구조 결정은 진행 중 `WORKLOG`에 잠시 기록할 수 있지만, 닫히기 전 반드시 기준 문서로 흡수한다.

### English

This document is the source of truth for the current implemented architecture of `gtum`.

Its goals are:

- make the real code structure easy to recover quickly
- clarify boundaries between frontend, runtime, provider, and persistence layers
- allow temporary sprint tracking in a `WORKLOG`, but absorb durable structural decisions into canonical docs before sprint close

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 현재 저장소의 실제 모듈 구조와 책임을 파악해야 할 때
- 어떤 파일이 어떤 계층에 속하는지, 어디를 수정해야 할지 정해야 할 때
- 저장 위치, 상태 소유권, runtime command 경계를 확인해야 할 때

### English

Read this document when:

- you need to recover the actual module structure of the repository
- you need to decide which layer or file should own a change
- you need to confirm persistence boundaries, state ownership, or runtime command edges

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 아키텍처 문서다. 아래 경로만 먼저 읽는다.

- 시스템 층과 모듈 경계만 볼 때
  - `Current System Boundaries`와 모듈 지도만 읽는다.
- Tauri command boundary가 궁금할 때
  - `Tauri Command Boundary`만 읽는다.
- 상태 저장과 restore 경계가 궁금할 때
  - `State And Persistence`만 읽는다.

### English

This document exceeds 200 lines. Read only the matching route first.

- when you need system layers and module boundaries
  - read `Current System Boundaries` and the module maps only
- when you need the Tauri command edge
  - read `Tauri Command Boundary` only
- when you need persistence and restore boundaries
  - read `State And Persistence` only

## 현재 시스템 경계 / Current System Boundaries

### 한국어

현재 구현은 아래 네 층으로 읽는 것이 가장 정확하다.

1. `UI Shell`
   - [`src/App.tsx`](../src/App.tsx)
   - [`src/App.css`](../src/App.css)
   - 메인 워크스페이스, code surface, terminal surface, provider panel, approval UI를 조합한다.
2. `Frontend Contract Layer`
   - [`src/lib/runtime.ts`](../src/lib/runtime.ts)
   - Tauri `invoke` 래퍼, typed contract, browser preview/mock fallback을 제공한다.
3. `Runtime Layer`
   - [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)
   - Tauri command 등록, manager 초기화, 앱 저장 경로 설정을 맡는다.
4. `Runtime Modules`
   - `filesystem`, `pty`, `auth`, `codex`, `workspace`, `telegram`, `platform`
   - 실제 시스템 동작과 persistence를 담당한다.

### English

The current implementation is best read as four layers:

1. `UI Shell`
   - [`src/App.tsx`](../src/App.tsx)
   - [`src/App.css`](../src/App.css)
   - composes the main workspace, code surface, terminal surface, provider panel, and approval UI
2. `Frontend Contract Layer`
   - [`src/lib/runtime.ts`](../src/lib/runtime.ts)
   - provides Tauri `invoke` wrappers, typed contracts, and browser preview/mock fallbacks
3. `Runtime Layer`
   - [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)
   - registers Tauri commands, initializes managers, and resolves app storage paths
4. `Runtime Modules`
   - `filesystem`, `pty`, `auth`, `codex`, `workspace`, `telegram`, `platform`
   - own the actual system behavior and persistence

## 프론트엔드 모듈 지도 / Frontend Module Map

### 한국어

- [`src/App.tsx`](../src/App.tsx)
  - 현재 메인 orchestration 파일이다.
  - 프로젝트 열기, 파일 선택, line anchor, terminal polling, provider connect, suggestion request, approval 실행, restore를 한 곳에서 조합한다.
  - 구조상 가장 큰 파일이므로 앞으로 feature-level 분해 대상이지만, 현재 기준선은 여기다.
- [`src/lib/runtime.ts`](../src/lib/runtime.ts)
  - 프론트엔드에서 사용하는 공용 contract 레이어다.
  - `readProjectOverview`, `readProjectFile`, `createTerminalSession`, `requestAgentSuggestions`, `readAgentProviderDiagnostics` 같은 typed API entrypoint를 제공한다.
  - Tauri가 없을 때 preview/mock contract를 유지하는 책임도 여기에 있다.
- [`src/stores/workspace-store.ts`](../src/stores/workspace-store.ts)
  - 패널 열림 상태, 현재 프로젝트 정보, 활성 터미널 탭, 캡처된 agent context를 저장한다.
  - 최근 프로젝트 목록은 브라우저 `localStorage`에 저장한다.

### English

- [`src/App.tsx`](../src/App.tsx)
  - the current main orchestration file
  - composes project open, file focus, line anchors, terminal polling, provider connect, suggestion requests, approval execution, and restore
  - it is intentionally the current baseline even though future feature-level decomposition is still desirable
- [`src/lib/runtime.ts`](../src/lib/runtime.ts)
  - the shared frontend contract layer
  - exposes typed entrypoints such as `readProjectOverview`, `readProjectFile`, `createTerminalSession`, `requestAgentSuggestions`, and `readAgentProviderDiagnostics`
  - also owns preview/mock contracts when Tauri is not available
- [`src/stores/workspace-store.ts`](../src/stores/workspace-store.ts)
  - stores panel visibility, active project metadata, active terminal tab, and captured agent context
  - persists recent projects in browser `localStorage`

## 런타임 모듈 지도 / Runtime Module Map

### 한국어

- [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)
  - 전체 Tauri command boundary다.
  - `AgentAuthManager`, `TerminalSessionManager`, `WorkspaceStateManager`, `TelegramBridgeManager`를 등록한다.
- [`src-tauri/src/runtime/filesystem/mod.rs`](../src-tauri/src/runtime/filesystem/mod.rs)
  - 프로젝트 overview, 파일 트리, Git overview, read-only file snapshot을 만든다.
  - project root 밖 파일 접근을 차단하고, binary/large-file fallback 기준도 여기에 있다.
- [`src-tauri/src/runtime/pty/mod.rs`](../src-tauri/src/runtime/pty/mod.rs)
  - PTY 세션 생성, 최근 로그 읽기, command injection, reader/reaper thread, bounded log buffer를 담당한다.
- [`src-tauri/src/runtime/auth/mod.rs`](../src-tauri/src/runtime/auth/mod.rs)
  - provider 연결 상태와 저장을 관리한다.
  - 현재 real daily-use 기준은 `Codex`이며, `Claude`는 deferred 상태로 유지한다.
- [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs)
  - `Codex CLI` 진단, ChatGPT session 검증, `codex exec` 기반 suggestion request, request payload normalization을 담당한다.
  - 현재 source of truth는 `OAuth/session login`이며 `API key` 경로는 개발용 임시 경로다.
- [`src-tauri/src/runtime/workspace.rs`](../src-tauri/src/runtime/workspace.rs)
  - 최근 프로젝트, 마지막 프로젝트, execution mode를 저장한다.
- [`src-tauri/src/runtime/telegram.rs`](../src-tauri/src/runtime/telegram.rs)
  - post-MVP Telegram draft/bridge/runtime state를 관리한다.
- [`src-tauri/src/runtime/platform/mod.rs`](../src-tauri/src/runtime/platform/mod.rs)
  - OS별 path normalization, shell candidate, git command helper를 제공한다.

### English

- [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)
  - the top-level Tauri command boundary
  - registers `AgentAuthManager`, `TerminalSessionManager`, `WorkspaceStateManager`, and `TelegramBridgeManager`
- [`src-tauri/src/runtime/filesystem/mod.rs`](../src-tauri/src/runtime/filesystem/mod.rs)
  - builds project overview, file trees, Git overview, and read-only file snapshots
  - enforces project-root containment and the current binary/large-file fallback rules
- [`src-tauri/src/runtime/pty/mod.rs`](../src-tauri/src/runtime/pty/mod.rs)
  - owns PTY session creation, recent log reads, command injection, reader/reaper threads, and bounded log buffers
- [`src-tauri/src/runtime/auth/mod.rs`](../src-tauri/src/runtime/auth/mod.rs)
  - manages provider connection state and persistence
  - the current real daily-use baseline is `Codex`, while `Claude` remains deferred
- [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs)
  - owns `Codex CLI` diagnostics, ChatGPT-session validation, `codex exec`-based suggestion requests, and payload normalization
  - the source-of-truth path is `OAuth/session login`, while `API key` is only a temporary development bridge
- [`src-tauri/src/runtime/workspace.rs`](../src-tauri/src/runtime/workspace.rs)
  - persists recent projects, last opened project, and execution mode
- [`src-tauri/src/runtime/telegram.rs`](../src-tauri/src/runtime/telegram.rs)
  - manages post-MVP Telegram draft, bridge, and runtime state
- [`src-tauri/src/runtime/platform/mod.rs`](../src-tauri/src/runtime/platform/mod.rs)
  - provides OS-aware path normalization, shell candidates, and git helpers

## Tauri Command 경계 / Tauri Command Boundary

### 한국어

현재 command는 아래 도메인으로 묶인다.

- 프로젝트와 파일
  - `read_project_overview`
  - `read_project_file`
- 터미널
  - `create_terminal_session`
  - `create_terminal_session_with_command`
  - `list_terminal_sessions`
  - `rename_terminal_session`
  - `close_terminal_session`
  - `read_terminal_session_logs`
  - `execute_terminal_session_command`
- provider/auth
  - `list_agent_connections`
  - `begin_agent_login`
  - `complete_agent_login`
  - `read_agent_provider_diagnostics`
  - `disconnect_agent_provider`
  - `request_agent_suggestions`
- workspace persistence
  - `read_workspace_runtime_snapshot`
  - `save_workspace_runtime_snapshot`
  - `remember_workspace_project`
  - `set_workspace_execution_mode`
- Telegram
  - `read_telegram_runtime_snapshot`
  - `begin_telegram_link`
  - `complete_telegram_link`
  - `disconnect_telegram_bridge`
  - `create_telegram_report`
  - `queue_telegram_remote_command`
  - `resolve_telegram_remote_command`

### English

The current commands group into these domains:

- project and file
  - `read_project_overview`
  - `read_project_file`
- terminal
  - `create_terminal_session`
  - `create_terminal_session_with_command`
  - `list_terminal_sessions`
  - `rename_terminal_session`
  - `close_terminal_session`
  - `read_terminal_session_logs`
  - `execute_terminal_session_command`
- provider/auth
  - `list_agent_connections`
  - `begin_agent_login`
  - `complete_agent_login`
  - `read_agent_provider_diagnostics`
  - `disconnect_agent_provider`
  - `request_agent_suggestions`
- workspace persistence
  - `read_workspace_runtime_snapshot`
  - `save_workspace_runtime_snapshot`
  - `remember_workspace_project`
  - `set_workspace_execution_mode`
- Telegram
  - `read_telegram_runtime_snapshot`
  - `begin_telegram_link`
  - `complete_telegram_link`
  - `disconnect_telegram_bridge`
  - `create_telegram_report`
  - `queue_telegram_remote_command`
  - `resolve_telegram_remote_command`

## 상태와 저장 위치 / State And Persistence

### 한국어

현재 저장 위치는 아래처럼 나뉜다.

- 프론트엔드 `localStorage`
  - 최근 프로젝트 목록
  - 마지막 프로젝트 경로
  - 선택 파일 경로와 line anchor
  - 선택 provider
  - execution mode
  - task history
  - Telegram draft UI 상태
- 런타임 app data JSON
  - agent auth state
  - workspace state
  - Telegram state
- 메모리 전용 상태
  - PTY 세션 객체
  - bounded terminal logs
  - 현재 렌더 중인 UI 계산 상태

즉, restore는 두 층으로 분리된다.

- 프론트엔드 restore
  - 현재 보고 있던 파일, line anchor, task history 같은 UI 맥락
- 런타임 restore
  - provider 연결 상태, workspace 메타데이터, Telegram 상태 같은 앱 저장 맥락

### English

Current persistence is split like this:

- frontend `localStorage`
  - recent project list
  - last project path
  - selected file path and line anchor
  - selected provider
  - execution mode
  - task history
  - Telegram draft UI state
- runtime app-data JSON
  - agent auth state
  - workspace state
  - Telegram state
- memory-only state
  - PTY session objects
  - bounded terminal logs
  - transient UI-derived state

Restore is therefore split into two layers:

- frontend restore
  - UI context such as the viewed file, line anchor, and task history
- runtime restore
  - app-persisted context such as provider state, workspace metadata, and Telegram state

## 현재 구조상 중요한 판단 / Important Current Architectural Truths

### 한국어

- 메인 사용 surface는 `terminal + code surface + agent approval`의 peer 구조다.
- 승인 전에는 runtime이 임의 명령을 실행하지 않는다.
- `Codex` real path는 `Codex CLI`와 ChatGPT session 검증을 통과해야 한다.
- `Windows`는 첫 실사용 검증 기준이며, path/shell 차이는 `platform` 계층에서 흡수해야 한다.
- `WORKLOG`는 진행 중 스프린트의 임시 추적 문서일 뿐 source of truth가 아니며, 닫힌 스프린트의 구조 변경은 이 문서나 [`message-flow.md`](./message-flow.md), [`development-guide.md`](./development-guide.md), [`technical-design.md`](./technical-design.md)에 흡수한 뒤 `WORKLOG`를 삭제한다.

### English

- the main product surface is a peer structure of `terminal + code surface + agent approval`
- the runtime does not execute arbitrary commands before user approval
- the real `Codex` path must pass `Codex CLI` and ChatGPT-session validation
- `Windows` is the first daily-use validation baseline, and path/shell differences should be absorbed in the `platform` layer
- a `WORKLOG` is only a temporary in-sprint trace, not a source of truth; once the sprint closes, structural changes should be absorbed into this doc or into [`message-flow.md`](./message-flow.md), [`development-guide.md`](./development-guide.md), and [`technical-design.md`](./technical-design.md), and then the `WORKLOG` should be deleted

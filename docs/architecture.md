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

## Current System Boundaries

As of the 2026-05-28 frontend reset, the implemented system is best read as three active layers:

1. `TSX App Shell And Legacy Design Prototype`
   - [`index.html`](../index.html)
   - [`src/app/main.tsx`](../src/app/main.tsx)
   - [`src/app/providers/legacy-prototype.ts`](../src/app/providers/legacy-prototype.ts)
   - [`src/widgets/app-shell/ui/Titlebar.tsx`](../src/widgets/app-shell/ui/Titlebar.tsx)
   - [`src/widgets/app-shell/ui/StatusBar.tsx`](../src/widgets/app-shell/ui/StatusBar.tsx)
   - [`src/prototype.jsx`](../src/prototype.jsx)
   - [`src/styles.css`](../src/styles.css)
   - The active browser entry now starts at `src/app/main.tsx`, which is the TSX/FSD migration entrypoint.
   - `src/app/providers/legacy-prototype.ts` mounts the current uploaded design module while reusable TSX components are extracted by feature slice.
   - `src/prototype.jsx` is a clean Vite entry assembled from the uploaded draft files in `/Users/kwon/Downloads/test (1)`: `tweaks-panel.jsx`, `data.jsx`, `workspace-store.jsx`, `sidebar.jsx`, `workspace.jsx`, `agent.jsx`, `modals.jsx`, and `app.jsx`.
   - `src/widgets/app-shell/ui/Titlebar.tsx` and `src/widgets/app-shell/ui/StatusBar.tsx` are the first extracted TSX/FSD app-shell components. They preserve the uploaded design class names and visible shell contract.
   - `src/prototype.jsx` owns the native folder picker behavior, then routes project overview and file reads through `src/shared/api/runtimeProjects.ts`.
   - `src/shared/api/runtimeWorkspace.ts` is the typed frontend seam for workspace restore and repeated-use persistence. The prototype reads the runtime workspace snapshot on desktop startup, reopens the last project through `runtimeProjects.ts`, and persists successful runtime-backed project opens.
   - `src/shared/api/runtimeTerminals.ts` is the typed frontend seam for terminal runtime sessions. The prototype uses it for user-created PTY tabs, log polling, tab close termination, approved command writes when an existing tab is runtime-backed, and approved-command output sessions when the agent creates a new runtime target.
   - `src/shared/api/runtimeAgentAuth.ts` is the typed frontend seam for provider connection snapshots, disconnects, and `begin_agent_login` validation. It does not own terminal creation; setup guidance stays in the Agent panel.
   - `src/shared/api/runtimeAgentSuggestions.ts` is the typed frontend seam for provider diagnostics, provider capabilities, and `request_agent_suggestions`. The prototype uses it for runtime-backed model/attachment metadata and Codex suggestion requests; when Tauri is unavailable, browser preview shows a runtime-unavailable state instead of canned agent replies.
   - Desktop runtime provider flows must not silently fall back to prototype data. Non-`Codex` providers surface an explicit deferred state. Codex command-bearing responses remain reviewable in the Agent panel until explicit approval; `Allow once` and `Always allow` then dispatch through the terminal runtime.
   - The fixed uploaded-design shell is `1320x824`; `src-tauri/tauri.conf.json` uses the same default launch size so the frameless desktop window opens without shell letterboxing.
   - New FSD-style type and service seams under `src/entities`, `src/features`, and `src/shared` are the target for reusable React components and backend-backed state.
   - `src/styles.css` is copied from the uploaded draft source.
2. `Runtime Layer`
   - [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)
   - registers Tauri commands, initializes managers, and resolves app storage paths
   - ensures the resolved app-data root is a directory before state managers start; a legacy file at that path is moved to a sibling `.legacy-file-<timestamp>.json` backup
   - [`src-tauri/tauri.windows.conf.json`](../src-tauri/tauri.windows.conf.json) and [`src-tauri/tauri.macos.conf.json`](../src-tauri/tauri.macos.conf.json) pin platform bundle targets while the base Tauri config keeps shared app settings
   - [`src-tauri/capabilities/default.json`](../src-tauri/capabilities/default.json) grants `core:default`, `dialog:allow-open`, and only the explicit native window permissions needed by the custom chrome (`close`, `minimize`, `toggleMaximize`, `startDragging`, `startResizeDragging`) before calling filesystem commands
3. `Runtime Modules`
   - `filesystem`, `pty`, `auth`, `codex`, `workspace`, `telegram`, `platform`
   - own the actual system behavior and persistence

The frontend reset intentionally removes the old frontend contract layer from the active app. Reintroducing runtime-backed behavior should be planned as a new integration slice on top of the clean design prototype, not by restoring the deleted FSD UI wholesale.

## Frontend Module Map

- [`index.html`](../index.html)
  - loads the TSX app entry and the Geist font links used by the uploaded design
- [`src/app/main.tsx`](../src/app/main.tsx)
  - active frontend entrypoint for the FSD migration
  - delegates to the legacy prototype provider until each design area is extracted into reusable TSX components
- [`src/app/providers/legacy-prototype.ts`](../src/app/providers/legacy-prototype.ts)
  - compatibility provider that imports the uploaded JSX prototype module
- [`src/widgets/app-shell/ui/Titlebar.tsx`](../src/widgets/app-shell/ui/Titlebar.tsx)
  - extracted TSX titlebar preserving the uploaded design root `.titlebar` and `data-comment-anchor="titlebar"`
  - renders project name, branch, active tab, workspace status, connected provider count, and settings entry
  - owns the macOS traffic-light and Windows caption-button layouts, and forwards native window actions/dragging through the runtime window bridge
- [`src/widgets/app-shell/ui/StatusBar.tsx`](../src/widgets/app-shell/ui/StatusBar.tsx)
  - extracted TSX statusbar preserving the uploaded design root `.statusbar` and `data-comment-anchor="statusbar"`
  - renders readiness, branch, changed-file count, ahead/behind, tab/group status, and palette hint
- [`src/prototype.jsx`](../src/prototype.jsx)
  - legacy uploaded design module used by the TSX app entry during migration
  - contains the shell, sidebar, workbench, agent panel, modals, approval policy, and tweak controls; the default project/workspace state is now empty until a real runtime project opens
  - consumes `src/shared/api/runtimeProjects.ts` for `ProjectOverview` and `ProjectFileSnapshot` payloads while browser preview stays on an empty no-runtime fallback
  - consumes `src/shared/api/runtimeWorkspace.ts` for desktop workspace snapshot restore and `remember_workspace_project`
  - consumes `src/shared/api/runtimeWindow.ts` so the custom titlebar controls the frameless Tauri window while keeping browser preview no-op fallbacks
  - preserves browser/Vite preview fallback so design E2E tests do not require the desktop runtime, without bundling a demo project or file tree
- [`src/shared/api/runtimeProjects.ts`](../src/shared/api/runtimeProjects.ts)
  - typed project/file runtime service for future TSX components
  - wraps Tauri filesystem commands and browser fallback project/file snapshots
  - supports injected E2E runtime overrides through `window.__GTUM_PROJECT_RUNTIME__`
  - supports injected test file readers, while the product browser fallback itself remains empty and runtime-required
  - exposes the same injected runtime override shape as the other `src/shared/api/*` seams so E2E can verify runtime-backed project states without launching Tauri
- [`src/shared/api/runtimeWorkspace.ts`](../src/shared/api/runtimeWorkspace.ts)
  - typed workspace persistence service for future TSX components
  - wraps `read_workspace_runtime_snapshot`, `save_workspace_runtime_snapshot`, and `remember_workspace_project`
  - returns `null` in browser preview instead of pretending desktop persistence succeeded
  - supports injected E2E runtime overrides through `window.__GTUM_WORKSPACE_RUNTIME__`
- [`src/shared/api/runtimeWindow.ts`](../src/shared/api/runtimeWindow.ts)
  - typed native window-control service for custom chrome
  - wraps Tauri `getCurrentWindow()` actions behind injected/browser fallbacks for deterministic E2E coverage
  - owns frameless edge/corner resize dragging through `startResizeDragging`
  - intentionally avoids native maximize-state polling; the prototype keeps maximize as local UI state to prevent macOS installed-app resize/style-mask feedback
- [`src/entities`, `src/features`, `src/shared`](../src)
  - initial FSD-style type, policy, and service seams for extracting the uploaded design into reusable TSX components
- [`src/shared/api/runtimeAgentSuggestions.ts`](../src/shared/api/runtimeAgentSuggestions.ts)
  - owns the frontend command seam for `read_agent_provider_capabilities`, `read_agent_provider_diagnostics`, and `request_agent_suggestions`
  - forwards selected provider model ids only when they came from runtime-backed capabilities
- [`src/styles.css`](../src/styles.css)
  - single active frontend stylesheet copied from the uploaded design source

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
  - 최근 프로젝트와 마지막 프로젝트를 저장한다.
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
  - also owns Windows approved-command output sessions created through `create_terminal_session_with_command`; those sessions run direct shell-free `.exe`/`.com` processes, capture stdout/stderr into runtime logs, and reject shell syntax or batch shims instead of launching an interactive shell
- [`src-tauri/src/runtime/auth/mod.rs`](../src-tauri/src/runtime/auth/mod.rs)
  - manages provider connection state and persistence
  - the current real daily-use baseline is `Codex`, while `Claude` remains deferred
- [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs)
  - owns `Codex CLI` diagnostics, ChatGPT-session validation, `codex exec`-based suggestion requests, and payload normalization
  - the source-of-truth path is `OAuth/session login`, while `API key` is only a temporary development bridge
- [`src-tauri/src/runtime/workspace.rs`](../src-tauri/src/runtime/workspace.rs)
  - persists recent projects and the last opened project
- [`src-tauri/src/runtime/telegram.rs`](../src-tauri/src/runtime/telegram.rs)
  - manages post-MVP Telegram draft, bridge, and runtime state
- [`src-tauri/src/runtime/platform/mod.rs`](../src-tauri/src/runtime/platform/mod.rs)
  - provides OS-aware path normalization, `~` home-directory expansion, shell candidates, and git helpers
  - owns runtime OS branching for shell candidates and terminal newline submission so feature modules do not duplicate Windows/macOS checks

## Tauri Command Boundary

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
  - `agent_auth_runtime_snapshot`
  - `read_agent_provider_diagnostics`
  - `disconnect_agent_provider`
  - `request_agent_suggestions`
- workspace persistence
  - `read_workspace_runtime_snapshot`
  - `save_workspace_runtime_snapshot`
  - `remember_workspace_project`
- Telegram
  - `read_telegram_runtime_snapshot`
  - `begin_telegram_link`
  - `complete_telegram_link`
  - `disconnect_telegram_bridge`
  - `create_telegram_report`
  - `queue_telegram_remote_command`
  - `resolve_telegram_remote_command`

## State And Persistence

Current persistence is split like this:

- runtime app-data JSON
  - startup normalizes the app-data root before any manager initializes storage
  - if an older install left a file at the app-data root, startup renames it to a sibling `.legacy-file-<timestamp>.json` backup, creates the directory, and then initializes the per-store files
  - agent auth state
  - workspace state: recent project paths, last opened project path, storage version, and timestamps
  - Telegram state
- frontend `localStorage`
  - tweak/edit-mode values used by the design prototype
  - browser-preview-only UI defaults
  - future selected-file, line-anchor, provider-choice, and task-history restore metadata once those fields receive a runtime contract
- memory-only state
  - PTY session objects
  - bounded terminal logs
  - transient UI-derived state

Restore is split into two layers:

- runtime restore
  - app-persisted context such as provider state, workspace metadata, and Telegram state
  - desktop startup reads `read_workspace_runtime_snapshot` and reopens the saved project through `read_project_overview`
- frontend restore
  - UI context such as the viewed file, line anchor, and task history
  - this remains deferred until the runtime workspace contract expands beyond project paths

## 현재 구조상 중요한 판단 / Important Current Architectural Truths

### 한국어

- 메인 사용 surface는 `terminal + code surface + agent approval`의 peer 구조다.
- 승인 전에는 runtime이 임의 명령을 실행하지 않는다.
- `Codex` real path는 `Codex CLI`와 ChatGPT session 검증을 통과해야 한다.
- `Windows`는 첫 실사용 검증 기준이며, path/shell 차이는 `platform` 계층에서 흡수해야 한다.
- `WORKLOG`는 진행 중 스프린트의 임시 추적 문서일 뿐 source of truth가 아니며, 닫힌 스프린트의 구조 변경은 이 문서나 [`message-flow.md`](./message-flow.md), [`development-guide.md`](./development-guide.md), [`technical-design.md`](./technical-design.md)에 흡수한 뒤 `WORKLOG`를 삭제한다.

### English

- the main product surface is a peer structure of `terminal + code surface + agent approval`
- the runtime does not execute arbitrary commands before user approval; after explicit approval, agent commands dispatch through the terminal runtime rather than through provider-side execution
- the real `Codex` path must pass `Codex CLI` and ChatGPT-session validation
- `Windows` is the first daily-use validation baseline, and path/shell differences should be absorbed in the `platform` layer
- a `WORKLOG` is only a temporary in-sprint trace, not a source of truth; once the sprint closes, structural changes should be absorbed into this doc or into [`message-flow.md`](./message-flow.md), [`development-guide.md`](./development-guide.md), and [`technical-design.md`](./technical-design.md), and then the `WORKLOG` should be deleted

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

### 2026-07-15 Agent Runtime, Claude CLI Session, And Provider Models

- `src/features/agents/model/useAgentJobLifecycle.ts` owns the bounded project/session-scoped job view, hydration generations, polling, read/cancel deduplication, stale-response rejection, and final structured-log collection.
- `src/features/agents/ui/AgentJobActivity.tsx` renders job state, command, structured output, exit metadata, error categories, and Cancel only in the right Agent workspace.
- `src/prototype.jsx` persists the Agent session directory metadata needed to keep durable ownership addressable across reload, including the session `providerId` and trimmed `selectedModels` keyed by `codex` or `claude`. Conversation content remains outside that directory, and neither provider nor model selection is global.
- `src-tauri/src/runtime/agent_jobs.rs` owns durable Agent jobs and `agent-jobs.json`; the PTY manager remains a separate user-terminal subsystem.
- `src-tauri/src/runtime/auth/mod.rs` exposes `Codex` and `Claude` as available, real providers. Both gate connect/request completion through stored-connection revision leases so stale work cannot change auth state or publish a response. Claude validates an explicit API key, then a strict helper, then an installed user-owned CLI session; availability still does not imply a connected credential or a live-inference-validated state.
- `src-tauri/src/runtime/claude.rs` owns bounded Claude model discovery and exact-value request validation. It runs the authenticated CLI with one prompt-free SDK `initialize` control request, accepts only the sanitized `value` fields from one matching successful response, builds labels from `displayName` plus the leading description segment, and discards identity/subscription data. A malformed, excessive, timed-out, or version-incompatible response fails closed with no static or historical fallback. Explicit requests refresh the catalog before spawn and add one separate `--model <value>` pair only after exact membership validation; implicit default requests add no model flag.
- `src-tauri/src/lib.rs` exposes capability reads as async Tauri commands and moves the blocking CLI discovery work to `spawn_blocking`, keeping the IPC executor responsive during the bounded probe.

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
   - `src/shared/api/runtimeTerminals.ts` is the typed frontend seam for user-owned terminal runtime sessions. The prototype uses it for user-created PTY tabs, user-submitted terminal input, log polling, and tab close termination. Agent approval decisions must not call this seam to create command tabs or write reviewed commands into existing terminals.
   - `src/shared/api/runtimeAgentJobs.ts` is the typed frontend seam for agent-owned background execution. Approved agent commands use this job surface and stream/log through the Agent panel/task history path instead of mutating the center terminal.
   - `src/shared/api/runtimeAgentAuth.ts` is the typed frontend seam for provider connection snapshots, disconnects, and `begin_agent_login` validation. It does not own terminal creation; setup guidance stays in the Agent panel.
   - `src/shared/api/runtimeAgentSuggestions.ts` is the typed frontend seam for provider diagnostics, provider capabilities, and `request_agent_suggestions`. Requests require the owning `agentSessionId`; the seam rejects blank ownership, provider-mismatched responses, cross-provider model rows, blank model metadata, and duplicate model IDs before either Codex or Claude state can render. When Tauri is unavailable, browser preview shows a runtime-unavailable state instead of canned agent replies.
   - Desktop runtime provider flows must not silently fall back to prototype data. A provider is requestable only after its real runtime connection succeeds. Command-bearing responses remain reviewable in the owning Agent session until explicit approval; `Allow once` creates one isolated Agent job and `Deny` starts no work.
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
   - `filesystem`, `pty`, `auth`, `codex`, `claude`, `workspace`, `telegram`, `platform`
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
  - contains the shell, sidebar, workbench, agent panel, settings, explicit per-command review flow, and tweak controls; the default project/workspace state is now empty until a real runtime project opens
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
  - validates top-level and per-model provider ownership plus nonblank, unique model metadata
  - forwards a stored provider model ID only while it remains in the active provider's supported runtime catalog; a definitively stale value becomes `null`, while unavailable or not-yet-loaded capability state does not erase persistence
  - renderer orchestration owns provider-scoped capability generations: each successfully returned startup connection plus connect, disconnect, reconnect, provider-action error, and capability-read error reconciliation invalidates older reads; a connected active provider receives a fresh read, and late success or rejection cannot replace the current catalog or connection presentation
- [`src/shared/api/runtimeAgentJobs.ts`](../src/shared/api/runtimeAgentJobs.ts)
  - validates and maps project-scoped Agent-job create/list/read/cancel payloads
  - never invokes a terminal command and returns explicit unavailable state for non-runtime projects
- [`src/features/agents/model/useAgentJobLifecycle.ts`](../src/features/agents/model/useAgentJobLifecycle.ts)
  - owns session-scoped hydration, bounded view state, polling, final-log reads, cancellation, and stale async-response rejection
- [`src/features/agents/ui/AgentJobActivity.tsx`](../src/features/agents/ui/AgentJobActivity.tsx)
  - renders Agent-job lifecycle and structured errors only in the right panel
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
  - on Windows, user-created center terminal sessions use a hidden persistent PowerShell-first shell process with stdin/stdout pipes, so user-submitted commands such as `dir`, `cd`, `ls`, and `clear` keep shell state without opening an external console window
  - keeps `create_terminal_session_with_command` as a terminal-owned command-output helper, but Agent-panel approval must not route through it because center terminal surfaces are user-owned
- `src-tauri/src/runtime/agent_jobs.rs`
  - owns agent-approved background process jobs, hidden subprocess spawning, stdout/stderr capture, idempotent cancellation, bounded structured logs, and bounded `agent-jobs.json` persistence
  - requires canonical project ownership for create/list/read/cancel; optional session ownership filters the right-panel history
  - restores persisted `running`/`cancelling` jobs as `interrupted` without relaunching them, and exposes terminal states only after process exit and log-reader drain
  - uses shell-free Windows command resolution for direct `.exe`/`.com` execution and rejects shell syntax or batch shims without opening center terminal tabs
- [`src-tauri/src/runtime/auth/mod.rs`](../src-tauri/src/runtime/auth/mod.rs)
  - manages provider connection state and persistence
  - preserves `Codex` and `Claude` as available, real providers while requiring provider-specific validation before connected state and applying blocking connect/request results only while their captured revision lease is current
- [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs)
  - owns `Codex CLI` diagnostics, ChatGPT-session validation, `codex exec`-based suggestion requests, and payload normalization
  - the source-of-truth path is `OAuth/session login`, while `API key` is only a temporary development bridge
- `src-tauri/src/runtime/claude.rs`
  - owns Claude CLI discovery, explicit API-key/strict-helper/local-CLI-session credential selection, auth-status classification, structured-output parsing, bounded subprocess behavior, and redaction
  - uses source precedence `ANTHROPIC_API_KEY -> apiKeyHelper -> claude_cli_session`; the helper must be one canonical absolute regular executable path, while a CLI session is read only by the installed CLI after the user authenticates externally with `claude auth login`
  - executes the Claude CLI and helper by canonical absolute path, accepts a custom config root only when it is an existing canonical directory under the current-user home, pins/revalidates that context across validation and request, supplies an absolute-only child `PATH`, removes competing credentials plus inherited provider/debug/telemetry/process-wrapper controls, explicitly disables nonessential traffic and official-marketplace auto-install, and bounds stdin/stdout/stderr plus child completion under one deadline while discarding stderr
  - uses `--safe-mode --setting-sources ""` for CLI-session status/requests and retains `--bare` for API-key/helper requests; model tools, MCP, slash commands, Chrome integration, and session persistence are disabled
  - discovers the current account/policy model catalog through one bounded SDK initialization control request with no user prompt or inference turn; only a matching successful response can produce selectable models
  - retains sanitized returned `value` IDs and human labels only, rejects the entire catalog on malformed or excessive data, and does not retain account identity, email, organization, or subscription fields
  - refreshes the catalog for an explicit request, requires exact returned-value membership before inference spawn, adds one `--model <value>` pair, and adds no flag or extra catalog probe for the implicit default
  - treats the raw initialization envelope as version-coupled and fails closed without static, cached, historical, or entitlement-inferred model fallbacks; a failed read leaves persisted selection available for a later valid read but cannot forward it
  - excludes user/project customizations but cannot override organization-managed policy hooks, status-line commands, or file-suggestion commands; no absolute process-level no-hooks claim is made
  - persists only non-secret source metadata and scopes, never raw keys, helper output, identity, tokens, or subscription metadata; no live `claude -p` inference was run without explicit user approval
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
- agent jobs
  - `create_agent_job`
  - `list_agent_jobs`
  - `read_agent_job_logs`
  - `cancel_agent_job`
- file edits
  - `write_project_file`
  - `apply_project_patch`
- provider/auth
  - `list_agent_connections`
  - `begin_agent_login`
  - `complete_agent_login`
  - `agent_auth_runtime_snapshot`
  - `read_agent_provider_diagnostics`
  - `read_agent_provider_capabilities`
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

`read_agent_provider_capabilities` is an async command boundary. Provider-specific synchronous discovery executes on a blocking worker; join failure becomes a typed command error rather than blocking or panicking the IPC executor.

## State And Persistence

Current persistence is split like this:

- runtime app-data JSON
  - startup normalizes the app-data root before any manager initializes storage
  - if an older install left a file at the app-data root, startup renames it to a sibling `.legacy-file-<timestamp>.json` backup, creates the directory, and then initializes the per-store files
  - agent auth state
  - workspace state: recent project paths, last opened project path, storage version, and timestamps
  - Agent job state: bounded snapshots and structured logs in `agent-jobs.json`
  - Telegram state
- frontend `localStorage`
  - tweak/edit-mode values used by the design prototype
  - browser-preview-only UI defaults
  - minimal Agent session directory metadata (`id`, title, active session, `providerId`, trimmed provider-keyed `selectedModels`, timestamps) used to address persisted session-owned requests, model choices, and jobs after reload; conversation content is not stored in this directory
  - future selected-file, line-anchor, and task-history restore metadata once those fields receive a runtime contract
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
- the center terminal remains user-owned; explicit Agent-panel approval may execute only through the isolated Agent-job runtime and must never dispatch through the terminal runtime or provider-side execution
- the real `Codex` path must pass `Codex CLI` and ChatGPT-session validation
- the real `Claude` path must pass explicit first-party API-key, strict user-level `apiKeyHelper`, or installed first-party CLI-session validation. GTUM never performs Claude.ai OAuth or reads the credential store; provider availability is distinct from connection readiness, and implemented revision leases fail stale completion closed before any UI result is accepted
- every provider request is owned by `projectPath + agentSessionId + providerId`, and a session switch or delayed completion must not move results into another owner
- model selection is additionally owned by the provider inside that project/session. Only a supported provider-owned catalog can validate it; a definitively removed model falls back to `null`/runtime default without deleting another provider's selection
- Claude model availability is account/policy response data rather than a repository-owned list. Only exact sanitized returned `value` fields are selectable, and failed discovery preserves but does not authorize a stored value
- `Windows` is the first daily-use validation baseline, and path/shell differences should be absorbed in the `platform` layer
- a `WORKLOG` is only a temporary in-sprint trace, not a source of truth; once the sprint closes, structural changes should be absorbed into this doc or into [`message-flow.md`](./message-flow.md), [`development-guide.md`](./development-guide.md), and [`technical-design.md`](./technical-design.md), and then the `WORKLOG` should be deleted

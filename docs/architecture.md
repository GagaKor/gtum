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

### 2026-07-20 Multi-Account Agent Profiles

- `src-tauri/src/runtime/auth/mod.rs` owns the versioned v2 profile registry, atomic v1 migration, reserved ambient profiles, immutable IDs/incarnations, separate metadata and credential revisions, bounded tombstones, exact account leases, owned-root provisioning, and profile lifecycle operations. `agent-auth.json` contains non-secret registry/connection metadata only; it never contains copied provider credentials, setup commands, raw child diagnostics, or provider-derived identity.
- `src-tauri/src/runtime/codex.rs` executes one frozen Codex account context. Additional profiles use a revalidated owned `CODEX_HOME`, a behaviorally proven file credential store, and a scrubbed child environment. The adapter validates through CLI status and never reads or parses `auth.json`.
- `src-tauri/src/runtime/claude.rs` executes one frozen Claude account context. Additional Linux/Windows profiles use a revalidated owned `CLAUDE_CONFIG_DIR` with competing credential sources removed. Additional macOS Claude profiles stop as unsupported before child launch; the reserved ambient profile alone retains existing Keychain-backed CLI/helper/environment precedence.
- `src-tauri/src/lib.rs` exposes an atomic all-provider profile snapshot, exact profile lifecycle/guidance commands, full-lease diagnostics/capabilities/suggestions, and atomic account-authorized Agent-job creation. Runtime work requires and successful results echo `provider + accountId + incarnation + credentialRevision`; all incarnation and revision values cross IPC as canonical decimal strings.
- `src/shared/api/runtimeAgentAuth.ts` and `src/shared/api/runtimeAgentSuggestions.ts` are the typed v2 seams. Account lifecycle targets the exact provider/account, while diagnostics, capabilities, and suggestions require and validate the complete lease. Both reject malformed, stale, or mismatched owners, keep browser fallback inert, and do not translate a missing `accountId` into a provider default.
- `src/features/agents/model/projectAgentContext.ts` coordinates the session-v2 persistence boundary. Startup waits for the authoritative profile snapshot; legacy provider-only session state can bind only to the matching reserved ambient ID. Existing missing, forgotten, disconnected, or unavailable selections remain explicit and never redirect. Persisted Connected profiles advance credential revision at restart; a generated profile remains selected as `Needs verification` and is not runtime-eligible until its exact Check succeeds.
- `src/prototype.jsx` owns account-scoped capability/action generations, in-flight request reconciliation, exact attachment catalogs, immutable request turns, and account-attributed errors/suggestions/permissions. Approval calls `createAuthorizedProjectJob` exactly once with the captured full lease and project/session owner; the backend atomically verifies that lease and creates the isolated job. Jobs remain project/session-owned while turns and approvals retain the originating account lease.
- Profile setup commands are generated only on demand and remain transient copy-only UI data. Profile management and Agent work never route through `runtimeTerminals.ts` or mutate the center workbench terminal.

### 2026-07-16 Agent Runtime, Claude Startup Recovery, And Provider Models

- `src/features/agents/model/useAgentJobLifecycle.ts` owns the bounded project/session-scoped job view, hydration generations, polling, read/cancel deduplication, stale-response rejection, and final structured-log collection.
- `src/features/agents/ui/AgentJobActivity.tsx` renders job state, command, structured output, exit metadata, error categories, and Cancel only in the right Agent workspace.
- `src/prototype.jsx` persists the Agent session directory metadata needed to keep durable ownership addressable across reload, including `providerId`, provider-keyed `selectedAccountIds`, and account-nested `selectedModels`, `selectedReasoningLevels`, and `fastModes`. Conversation content and account-scoped attachment catalogs remain outside that directory.
- `src/prototype.jsx` also owns startup capability scheduling. It resolves the exact selected account after the atomic profile snapshot and calls `read_agent_account_capabilities` only while that profile is exactly connected. Account-lease connection and capability generations suppress stale success/rejection across check, disconnect, Forget, context change, and account switching; none of this orchestration uses the center-terminal service.
- `src-tauri/src/runtime/agent_jobs.rs` owns durable Agent jobs and `agent-jobs.json`; the PTY manager remains a separate user-terminal subsystem.
- `src-tauri/src/runtime/auth/mod.rs` exposes `Codex` and `Claude` as available, real providers and owns the authoritative desktop-startup connection refresh. Both gate connect/request completion through stored-connection revision leases so stale work cannot change auth state or publish a response. Startup may lease a persisted real Claude `Error` for fresh current CLI validation and promote a successful result to `Connected` with the validated source/scopes and no identity/error data. Explicit `Disconnected` Claude state is never auto-connected, while non-real legacy errors normalize to disconnected/untrusted state. Disconnect publishes only after a synchronized temporary candidate atomically replaces the auth store; pre-commit persistence failure returns through IPC without changing memory, and canonical pre-deserialization migration drops malformed, duplicate, noncanonical, or key/provider-mismatched connection entries. Claude validation failures are replaced with one generic actionable redacted message before publication or persistence; Codex error behavior is unchanged. Claude validates an explicit API key, then a strict helper, then an installed user-owned CLI session; availability still does not imply a connected credential or a live-inference-validated state.
- `src-tauri/src/runtime/claude.rs` owns bounded Claude model discovery and exact-value request validation. It runs the authenticated CLI with one prompt-free SDK `initialize` control request, accepts only sanitized model fields from one matching successful response, and retains each model's bounded `executionOptions` as the authority for effort/Fast support while discarding identity/subscription data. An explicit model, explicit effort, or enabled Fast refreshes the catalog before spawn. Valid selections map to separate `--model <value>` and `--effort <level>` pairs; every inference request receives one sanitized settings JSON with explicit Fast and optional helper path.
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
   - `src/shared/api/runtimeAgentAuth.ts` is the typed frontend seam for the atomic profile snapshot, exact profile lifecycle/check/disconnect/Forget operations, transient setup guidance, and account-lease authorization. Its provider-only connection methods remain migration-compatible; it does not own terminal creation.
   - `src/shared/api/runtimeAgentSuggestions.ts` is the typed frontend seam for account diagnostics, capabilities, and `request_agent_account_suggestions`. Runtime requests require `provider + accountId + incarnation + credentialRevision`; suggestions additionally require `agentSessionId`. The seam rejects blank, stale, or mismatched full-lease ownership, cross-provider model rows, blank model metadata, and duplicate model IDs before either Codex or Claude state can render. When Tauri is unavailable, browser preview is inert.
   - Desktop runtime provider flows must not silently fall back to prototype data or another account. An exact profile is requestable only after its real connection succeeds. Command-bearing responses remain reviewable under the captured account lease until explicit approval; `Allow once` creates one isolated Agent job and `Deny` starts no work.
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
  - owns the v2 frontend seam for `read_agent_account_capabilities`, `read_agent_account_diagnostics`, and `request_agent_account_suggestions`; provider-only methods remain migration-compatible
  - validates the top-level provider/account owner, each model's provider, nonblank unique model metadata, and bounded model `executionOptions`
  - forwards a stored account model ID only while it remains in that exact account's supported catalog; invalid or unavailable state never selects another account
  - renderer orchestration waits for authoritative profile hydration and reads capabilities only when the exact selected profile is connected
  - account-lease generations invalidate older reads across profile lifecycle/context changes; late success or rejection cannot replace another account's catalog or presentation
  - the effective selected model's `executionOptions` override provider compatibility fields; model-owned Claude `Default` is UI-only/null, while absent options retain the Codex provider-level contract
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
  - retains sanitized returned model fields and bounded per-model `executionOptions`, rejects the entire catalog on malformed or excessive data, and does not retain account identity, email, organization, or subscription fields
  - refreshes the catalog for an explicit model, explicit effort, or enabled Fast, requires exact effective-model support before inference spawn, and adds separate `--model <value>` and `--effort <level>` pairs only when selected
  - emits exactly one sanitized `--settings` JSON object for every inference request with explicit `fastMode`; helper mode merges only `apiKeyHelper`. It removes `CLAUDE_CODE_EFFORT_LEVEL` and rejects enabled Fast when `CLAUDE_CODE_DISABLE_FAST_MODE=1`
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
  - `create_authorized_agent_job`
  - `list_agent_jobs`
  - `read_agent_job_logs`
  - `cancel_agent_job`
- file edits
  - `write_project_file`
  - `apply_project_patch`
- provider/auth v2
  - `list_agent_profiles`
  - `read_agent_profile_snapshot`
  - `create_agent_profile`
  - `rename_agent_profile`
  - `set_default_agent_profile`
  - `check_agent_profile`
  - `disconnect_agent_profile`
  - `forget_agent_profile`
  - `read_agent_profile_setup_guidance`
  - `authorize_agent_profile_lease`
  - `read_agent_account_diagnostics`
  - `read_agent_account_capabilities`
  - `request_agent_account_suggestions`

`create_authorized_agent_job` is the only renderer-callable job-creation command. It verifies the exact connected `providerId + accountId + incarnation + credentialRevision` lease and creates the project/session-owned job while the same auth-store critical section is held. The provider-less `create_agent_job` command is not registered, so approval cannot race a Disconnect, Forget, or credential-context refresh through a generic job boundary.
- provider/auth legacy compatibility
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

`read_agent_account_capabilities` is the v2 async command boundary for current account-owned discovery; `read_agent_provider_capabilities` remains a legacy migration-compatible boundary. Provider-specific synchronous discovery executes on a blocking worker; join failure becomes a typed command error rather than blocking or panicking the IPC executor.

## State And Persistence

Current persistence is split like this:

- runtime app-data storage
  - startup normalizes the app-data root before any manager initializes storage
  - if an older install left a file at the app-data root, startup renames it to a sibling `.legacy-file-<timestamp>.json` backup, creates the directory, and then initializes the per-store files
  - agent auth state: versioned profile registry, visible profile metadata, bounded tombstones, exact connection state, and revision counters in `agent-auth.json`; no credentials, raw diagnostics, setup command, or provider-derived identity
  - app-owned credential roots referenced by profile kind, retained after Forget and validated independently of the JSON registry before every provider launch
  - workspace state: recent project paths, last opened project path, storage version, and timestamps
  - Agent job state: bounded snapshots and structured logs in `agent-jobs.json`
  - Telegram state
- frontend `localStorage`
  - tweak/edit-mode values used by the design prototype
  - browser-preview-only UI defaults
  - versioned Agent session directory metadata (`id`, title, active session, `providerId`, provider-keyed `selectedAccountIds`, account-nested `selectedModels`, `selectedReasoningLevels`, `fastModes`, timestamps) used to address persisted session/account-owned requests, choices, and jobs after reload; conversation content and attachment catalogs are not stored in this directory
  - future selected-file, line-anchor, and task-history restore metadata once those fields receive a runtime contract
- memory-only state
  - PTY session objects
  - bounded terminal logs
  - transient UI-derived state
  - account-scoped attachment catalogs, capability caches, action generations, immutable in-flight request snapshots, and transient setup guidance

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
- every v2 provider request is owned by `projectPath + agentSessionId + providerId + accountId + incarnation + credentialRevision`, and a session/account switch or delayed completion must not move results into another owner
- model, reasoning, Fast, attachment, capability, and conversation-turn state is additionally owned by the exact account inside that project/session. Only a supported account-owned catalog can validate it; an invalid selection is blocked without selecting another account or deleting another account's preference
- Claude model availability is account/policy response data rather than a repository-owned list. Only exact sanitized returned `value` fields are selectable, and failed discovery preserves but does not authorize a stored value
- Claude reasoning/Fast availability is also returned per model. Selected-model `executionOptions` take precedence, model-owned stale effort becomes `null`/`Default`, and unsupported controls become effective `null`/`false` without deleting the exact account-scoped preferences. Codex provider-level stale reasoning instead recovers only within that account's current supported catalog.
- A send freezes provider, account, alias, incarnation, credential revision, model, attachments, reasoning, Fast, project/session, and tab context before any asynchronous boundary. Approval atomically reauthorizes that exact credential lease before creating a project/session-owned Agent job. These paths remain entirely within the Agent execution surface and never mutate the user-visible center terminal.
- `Windows` is the first daily-use validation baseline, and path/shell differences should be absorbed in the `platform` layer
- a `WORKLOG` is only a temporary in-sprint trace, not a source of truth; once the sprint closes, structural changes should be absorbed into this doc or into [`message-flow.md`](./message-flow.md), [`development-guide.md`](./development-guide.md), and [`technical-design.md`](./technical-design.md), and then the `WORKLOG` should be deleted

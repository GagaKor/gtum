# gtum Message Flow

## Document Purpose

This document is the source of truth for the major user-facing and runtime-facing flows in `gtum`.

Its goals are:

- align what the user sees with what the system actually does
- preserve request payloads, approval boundaries, and restore behavior in canonical docs rather than leaving them inside temporary sprint `WORKLOG`s
- make it clear where UI changes and runtime-contract changes must meet

## When To Read This Document

Read this document when:

- you are changing project-open, code-surface, provider-connect, suggestion-request, approval, or restore behavior
- you need to confirm the order in which data moves through the system
- you need to align E2E scenario names with real user flows

## Long-Doc Routing

This document exceeds 200 lines. Do not reread every flow by default.

- when you need project-open or file-restore behavior
  - read only `Flow 1` and `Flow 2`
- when you need provider connect or request-and-approval behavior
  - read only `Flow 3`, `Flow 4`, and `Flow 5`
- when you need restore or repeated-use behavior
  - read only `Flow 6` plus the linked test section

## Flow 1. Project Open And Baseline Restore

1. The frontend starts at [`src/app/main.tsx`](../src/app/main.tsx), then mounts the legacy prototype through [`src/app/providers/legacy-prototype.ts`](../src/app/providers/legacy-prototype.ts).
2. In browser/Vite preview, `hasTauriRuntime()` is false. The app starts from an empty `Open a project` shell, exposes `window.__GTUM_BACKEND_BRIDGE__` for E2E verification, and does not load a bundled demo project.
3. In the Tauri desktop runtime, the sidebar `Open Project Folder` action opens the native directory picker through `@tauri-apps/plugin-dialog`.
4. After a folder is selected, [`src/prototype.jsx`](../src/prototype.jsx) calls the typed service seam in [`src/shared/api/runtimeProjects.ts`](../src/shared/api/runtimeProjects.ts).
5. `runtimeProjects.ts` calls `invoke("read_project_overview", { path })` in desktop runtime and returns an empty browser fallback project when Tauri is unavailable.
6. [`src-tauri/src/runtime/filesystem/mod.rs`](../src-tauri/src/runtime/filesystem/mod.rs) returns project metadata, file tree, and Git overview.
7. After a runtime-backed project opens successfully, [`src/prototype.jsx`](../src/prototype.jsx) calls `remember_workspace_project` through [`src/shared/api/runtimeWorkspace.ts`](../src/shared/api/runtimeWorkspace.ts).
8. The frontend maps the normalized `RuntimeProject` into the titlebar, sidebar project card, file tree, agent context branch, and statusbar.
9. PTY/session restore remains deferred for a later backend slice. It must be added on top of the TSX/FSD migration seam instead of restoring the deleted FSD frontend.

## Flow 2. File Focus And Code Surface

1. The user selects a file from the sidebar file tree.
2. Browser/Vite preview does not expose bundled files. The file tree remains empty until a runtime-backed project is opened.
3. The current legacy prototype and future extracted TSX components route file reads through [`src/shared/api/runtimeProjects.ts`](../src/shared/api/runtimeProjects.ts).
4. If the active project is runtime-backed, `runtimeProjects.ts` calls `invoke("read_project_file", { projectPath, filePath })`.
5. [`src-tauri/src/runtime/filesystem/mod.rs`](../src-tauri/src/runtime/filesystem/mod.rs) rejects paths outside the active project root and returns a `ProjectFileSnapshot` with a stable `contentHash`.
6. `runtimeProjects.ts` maps the snapshot into the editor tab shape, using `displayPath`, text content, content hash, language extension, and bounded binary/truncated fallbacks. Browser preview may use injected test readers, but the product shell does not ship curated file content.
7. The opened file is inserted into the current workbench group through the existing prototype `openFile` store action.
8. User edits stay in the center workbench buffer until the user presses `Save`. Save calls `write_project_file` with the last read `contentHash`; if the file changed on disk, the runtime rejects the write and the UI keeps the tab dirty for reload/manual resolution. Truncated previews cannot be saved.
9. Line anchors and terminal-log file references are still deferred until terminal/session integration is reintroduced.

## Flow 3. Provider Diagnostics And Connect

1. On initial desktop load, [`src/shared/api/runtimeAgentAuth.ts`](../src/shared/api/runtimeAgentAuth.ts) reads one atomic `read_agent_profile_snapshot` before Agent-session hydration or capability discovery. `list_agent_profiles` remains a provider-filtered visible-row query. Browser preview returns no fabricated profile.
2. Before that snapshot is published, the auth manager atomically migrates legacy provider-only state into `codex-default` and `claude-default`. It copies no credential, scrubs identity/callback/pending-login data, preserves explicit disconnect, and fails closed on invalid or future-version state.
3. The renderer hydrates session v2 only after the authoritative snapshot arrives. Legacy provider-only session data may bind only to the matching reserved ambient ID. Existing missing, forgotten, disconnected, malformed, or unavailable selections remain explicit and cannot redirect to the current default or first visible row. On every desktop restart, a persisted Connected profile advances its credential revision and becomes `Needs verification`; reserved ambient profiles may recover through serialized startup validation, while generated profiles remain selected but block capabilities, Send, approval, and provider child launch until their exact Check succeeds.
4. Settings groups visible profiles under Codex and Claude. Creating a profile accepts only a user-authored 1–64-byte alias and provisions the provider-specific owned root. The provider limit counts both visible rows and retained tombstones, up to 16 total.
5. Additional Codex creation succeeds only when the installed CLI behaviorally proves that an isolated `CODEX_HOME` honors `cli_auth_credentials_store = "file"`. Additional Claude CLI-session creation is supported on Linux and Windows; macOS returns an actionable unsupported result before child launch because Claude credentials remain in Keychain.
6. The user requests copyable setup guidance for one exact profile and shell. The runtime returns structured program, environment, and argument fields plus a rendered command. The renderer does not persist, log, execute, or send this transient command into conversation or the center terminal; the user runs login in their own external terminal.
7. `check_agent_profile` validates only the targeted provider/account root. Success or failure updates that exact profile's connection/credential revision. It never checks another profile to recover and never falls back to an ambient credential.
8. Codex validation and execution remove competing Codex/OpenAI credential overrides, set the exact isolated `CODEX_HOME`, and use `codex login status`. GTUM never reads or parses `auth.json`. The ambient profile preserves the user-owned default CLI path while remaining bound to its frozen lease.
9. An isolated Claude profile removes API keys, OAuth tokens, helper/base-url/cloud selectors, and other competing sources before setting the exact `CLAUDE_CONFIG_DIR`. The reserved ambient profile retains the existing explicit API-key, strict helper, then installed CLI-session precedence. GTUM never performs Claude.ai OAuth or reads Keychain/credential files.
10. Successful validation persists only non-secret profile connection metadata. Raw keys, tokens, helper output, email, organization, subscription metadata, setup commands, and raw child diagnostics are never stored or rendered.
11. Rename and Set Default advance metadata only. Disconnect advances the exact profile's credential state. Forget hides a non-default profile while retaining a bounded tombstone and root. Neither Disconnect nor Forget logs out the provider, deletes a credential, deletes the root, or revokes the provider session; ambient profiles cannot be forgotten.
12. Diagnostics and capability discovery start only when the exact selected profile is connected. `read_agent_account_diagnostics` and `read_agent_account_capabilities` run synchronous provider probes on blocking workers and require and return the same `provider + accountId + incarnation + credentialRevision` lease. The frontend rejects any lease mismatch, blank or duplicate models, and cross-account state.
13. Claude catalog discovery uses the selected frozen context, sends one bounded prompt-free SDK `initialize` request, and accepts only sanitized returned values and their model-owned execution options. Discovery never falls back to another account, a static list, a historical cache, or inferred entitlement.
14. Connection, capability, and action generations are keyed by account lease. A disconnect, Forget, or credential-context change invalidates old capability/request work; rename or default metadata changes do not. Late success and late rejection cannot cross account ownership.
15. The combined provider/account picker shows the exact provider, user alias, and connection status in its accessible name and opened grouped list. A missing or disconnected selection stays visible and blocks Send. Fast remains a direct capability-backed boolean button, not an account or provider fallback control.
16. Every profile lifecycle, setup, capability, and connection flow remains in Settings or the owning Agent workspace and makes zero center-terminal mutations.

## Flow 4. Agent Request Envelope

The v2 input contract for `request_agent_account_suggestions` is fixed around these fields:

- `provider`
- `accountId`
- `incarnation` (canonical decimal string)
- `credentialRevision` (canonical decimal string)
- `agentSessionId`
- `model` (optional; only set from runtime-backed provider capabilities)
- `reasoningLevel` (optional; set only when the active provider capability exposes supported reasoning levels)
- `fastMode` (boolean; true only when the active provider capability reports `supportsFastMode`)
- `attachments` (optional; local paths selected through runtime-backed attachment capabilities)
- `projectName`
- `projectPath`
- `activeTabId`
- `activeTabTitle`
- `activeFilePath`
- `activeFileLine`
- `activeFileSnippet`
- `lastNLogLines`
- `userTask`

The active design prototype captures `projectPath + agentSessionId + providerId + accountId + incarnation + credentialRevision` from the owning Agent session before calling this runtime command through [`src/shared/api/runtimeAgentSuggestions.ts`](../src/shared/api/runtimeAgentSuggestions.ts). A blank session/account owner is rejected before IPC, and every successful diagnostic, capability, or suggestion response must echo that complete lease before rendering or permission handling. A provider/account mismatch or stale incarnation/revision fails closed. Browser preview no longer fabricates agent replies and surfaces a runtime-unavailable message. Model, reasoning, Fast, and attachment metadata comes from `read_agent_account_capabilities`; the frontend must not show these controls from hardcoded or another account's values. Each session persists account selection and model/reasoning/Fast preferences by provider/account, while runtime work is authorized by the full lease. At Send, one immutable turn also captures the current alias, full lease, attachments, and active-tab context before state mutation or any await. The backend independently leases the current exact account context for provider work.

## Flow 5. Suggestion Request And Approval Execution

1. The user must enter a request while the exact selected provider/account profile is connected.
2. The active prototype routes runtime-backed v2 requests through `requestAccountSuggestions` in [`src/shared/api/runtimeAgentSuggestions.ts`](../src/shared/api/runtimeAgentSuggestions.ts). Browser preview must not create canned agent replies; it may only show an explicit desktop-runtime-required message.
3. In the desktop runtime, provider requests require a runtime-backed project opened through the native project flow. If the active project is still the empty browser fallback, the UI must show an "open a real local folder first" state and must not call `request_agent_account_suggestions`.
4. Claude and Codex share the frontend request boundary, but each exact profile remains gated by its own canonical connected state. A missing, forgotten, unsupported, stale, or disconnected profile shows setup/unavailable guidance and must not fall back to another account, another provider, or a canned response.
5. The renderer freezes provider, account, displayed alias, incarnation, credential revision, validated model/options, attachments, project/session, active tab, and user request before the first await. The runtime then captures its own exact profile lease and immutable provider context. An asynchronous account/provider/session/tab switch after Send cannot rewrite either owner.
6. While a runtime-backed provider request is pending, the owning Agent session creates a persistent assistant conversation turn and reveals live progress inside that turn one stage at a time: reading the current project context first, sending the request to the provider runtime second, and waiting for the provider response third. The UI must not render all pending stages at once on request start. When the request completes successfully, those internal progress rows are cleared from the visible thread, the same turn records `Answered HH:MM / elapsed`, and the turn reads as a normal assistant reply. Command-bearing replies leave only a lightweight execution-suggestion activity row in the turn; the actionable permission request opens directly above the composer. Failures keep enough progress/error context to explain what stopped.
   - If the user presses the composer stop control during a pending request, the frontend marks the active turn as stopped and invalidates that request generation so any later provider response cannot create a reply or approval panel. This is a UI cancellation boundary; provider/runtime-level subprocess abort remains a future explicit contract unless the adapter exposes it.
7. Inside one blocking-worker attempt, the `Codex` runtime uses the exact frozen account context, revalidates its root and lease, validates the CLI session, and only then runs response generation through `codex exec --sandbox read-only`. An isolated profile receives its scrubbed environment plus exact `CODEX_HOME`; no ambient key or another profile can override it. Model/reasoning/image arguments retain the existing validated capability contract. The prompt and permission-card behavior remain unchanged, and bounded child execution never uses the center terminal.
8. Inside a Claude blocking-worker attempt, the adapter pins the exact account context for validation, catalog refresh, and request. An isolated Linux/Windows profile receives a scrubbed environment plus exact `CLAUDE_CONFIG_DIR`; an additional macOS profile has already failed before spawn. The ambient profile retains the existing source-specific safe/bare mode. Model, effort, Fast, structured output, bounded I/O, and tool/MCP/session prohibitions remain unchanged and never authorize an account fallback.
9. The response is normalized into:
   - `summary`
   - `command` (optional; present only for reviewable actions)
   - `preferredTarget`
   - `confidence`
   - `error`
10. If a provider runtime exits non-zero, returns unstructured output, returns an empty response without a command or error reason, identifies a different provider/account, or completes after its credential lease became stale, the frontend appends an error to the captured originating turn and does not create an approval card or redirect the result.
11. If a provider returns a reply-only structured response, the frontend renders that as a normal assistant message with no review card. If the reply contains numbered choices, the frontend extracts those choices into a selectable decision event card and sends the selected option back through the same Agent session and provider path. An error-only structured response renders as a provider-labeled message with no approval action.
12. `src/prototype.jsx` owns the agent decision UI state. Provider responses render as conversational Agent turns in their captured project/session/account owner: pending turns show inline progress, completed reply-only turns show normal assistant copy, numbered-choice replies add a decision event card, and command-bearing turns add a compact execution-suggestion row with the captured account attribution.
13. Command-bearing turns must not rely on a generic assistant sentence or an intermediate `Review command` step. The detailed permission request appears only while its captured account lease is actionable, directly above the composer, with the command preview, risk, reason, isolated-Agent-job target, and direct `Allow once` and `Deny` actions. `create_authorized_agent_job` carries the captured provider, account ID, incarnation, credential revision, project, and Agent-session owner in one request. The backend holds the auth-store lock across exact connected-lease verification and Agent-job creation, so Disconnect, Forget, or context refresh cannot commit between authorization and spawn; rename/default changes do not stale the lease. A synchronous decision guard still prevents duplicate jobs.
14. Agent-tab requests, permission cards, and approved agent work must never create, select, rename, split, focus, write into, close, or otherwise mutate any user-visible center terminal tab or pane. The center terminal is exclusively user-owned before, during, and after approval. Implementations must not route agent approval through `create_terminal_session`, `create_terminal_session_with_command`, `execute_terminal_session_command`, or any future equivalent if the result appears in the center terminal/workbench.
15. `Allow once` invokes `create_authorized_agent_job` exactly once per approved command and registers the returned snapshot under its captured project/session owner. The provider-less `create_agent_job` IPC is unavailable, so renderer code cannot bypass the account lease through the legacy job-create surface. The job store remains project/session-owned rather than serving as an auth ledger; the originating conversation/permission turn retains the exact account lease. If isolated execution is unavailable, the app shows explicit manual-run guidance instead of opening or touching a center terminal tab.
16. The right-panel lifecycle polls `running` and `cancelling` jobs until a terminal state also reports `logsComplete`. It renders bounded structured command/stdout/stderr/system entries, exit metadata, and separate log-read, capture, process, action, and persistence errors. Cancel is visible only while the job can accept cancellation.
17. Job persistence uses bounded `agent-jobs.json` history. Runtime restart converts stored `running` and `cancelling` records to `interrupted`, flushes that state, and never relaunches the process. A session with a live job cannot be removed from the UI because that would orphan observation and cancellation. Session close checks both current create-in-flight ownership and a monotonic per-session create-start generation before and after its asynchronous job listing, so neither `Allow -> Close` nor `Close -> Allow -> create completes -> stale list response` can orphan a job.
18. Windows-approved agent commands must not launch `cmd.exe`, `powershell.exe`, `pwsh.exe`, batch shims, shell syntax, or a long-lived PTY shell. Such commands are rejected into the agent/worklog state for manual terminal execution by the user. This rejection must not open a center terminal tab.
19. If a provider suggestion targets the current tab but that tab is not a dedicated agent-owned execution surface, the app must keep the suggestion in the right panel and show the unavailable/manual-run state rather than silently simulating success or creating a terminal tab.
20. Browser preview must keep only deterministic empty fallback state and must not simulate agent execution, provider answers, project files, or terminal success.
21. Agent patch application uses `apply_project_patch`, which applies explicit file-content edits under the project root with per-file content-hash guards. The runtime preflights every edit for path, size, duplicate target, binary overwrite, and expected-hash validity before writing any file so a stale edit cannot partially apply a multi-file patch. It must not type into the center editor, and the center editor refreshes through the normal file snapshot path after application.
22. Task history records request, approval, file-save, patch, and agent-job outcomes.

## Flow 6. Restore And Repeated Use

1. Browser/Vite preview starts from the empty `Open a project` shell and keeps workspace persistence local-only.
2. Desktop startup calls `read_workspace_runtime_snapshot` through [`src/shared/api/runtimeWorkspace.ts`](../src/shared/api/runtimeWorkspace.ts).
3. Before provider, workspace, or Telegram stores initialize, the Rust runtime ensures the app-data root is a directory. If an older install left a file at that path, it is backed up beside the app-data root as `.legacy-file-<timestamp>.json`.
4. If the snapshot includes `lastOpenedProjectPath`, the frontend reopens that path through Flow 1 by calling `read_project_overview`; the stored path is not treated as a complete project object.
5. Successful runtime-backed project opens call `remember_workspace_project`.
6. The Rust workspace contract persists recent project paths, last opened project path, storage version, and timestamps. Profile registry/connection metadata remains in the separate v2 auth store; credentials and setup commands are never copied into either store.
7. Desktop startup reads the atomic profile snapshot before hydrating session v2. Only the matching reserved ambient profile can receive a provider-only legacy selection. Existing missing, forgotten, disconnected, malformed, or unavailable selections stay visible/unassigned and cannot switch to a default. Exact connected account state alone schedules capability work, and account-lease generations suppress stale completion without touching the center terminal.
8. Agent session-directory metadata is stored separately from conversation content so a restored session keeps the same ID, provider, provider-keyed account selection, account-nested model/reasoning/Fast preferences, and persisted-job address after reload. Attachment catalogs and in-flight turns remain memory-only. A failed v2 write leaves v1 intact for retry; unsupported/malformed v2 state never downgrades into ambiguous provider-only ownership.
9. `AgentJobManager` loads `agent-jobs.json`, preserves bounded terminal history, and converts unfinished records to `interrupted` without resuming processes. The right panel hydrates only jobs owned by the active canonical project and Agent session.
10. PTY session objects are memory-backed and are not fully restorable after a process restart.

## Linked Test Flows

The current E2E-aligned coverage is [`tests/e2e/design-prototype.spec.ts`](../tests/e2e/design-prototype.spec.ts).

It covers:

- clean design shell rendering without bundled project data
- design proportions after the frontend reset
- project and files accordion behavior without legacy frontend state
- browser fallback for the backend bridge state
- injected terminal runtime bridge coverage for new-tab creation and close/terminate routing
- terminal runtime service contract coverage through [`tests/e2e/runtime-terminal-service.spec.ts`](../tests/e2e/runtime-terminal-service.spec.ts)
- workspace runtime service contract coverage through [`tests/e2e/workspace-runtime-service.spec.ts`](../tests/e2e/workspace-runtime-service.spec.ts)
- workspace restore coverage that verifies startup reopens the saved runtime project
- workspace persistence coverage that verifies project opens call the runtime workspace command and do not write hidden execution-mode state
- agent auth and suggestion runtime service contract coverage through [`tests/e2e/runtime-agent-auth-service.spec.ts`](../tests/e2e/runtime-agent-auth-service.spec.ts) and [`tests/e2e/runtime-agent-suggestions-service.spec.ts`](../tests/e2e/runtime-agent-suggestions-service.spec.ts); exact current counts belong in the final multi-account gate rather than this durable flow document
- injected Codex suggestion runtime bridge coverage in `tests/e2e/design-prototype.spec.ts`
- fixed-model/fixed-mode regression coverage that verifies the right agent panel, settings modal, statusbar, and Codex request envelope do not expose unsynced model or execution-mode values
- live Codex activity coverage that verifies pending runtime requests reveal concrete operation progress rows sequentially, then clear those rows after the response while keeping the final assistant turn and answer-time metadata
- reply-only Codex coverage that verifies normal answers do not create review cards or composer approval panels
- numbered-choice Codex coverage that verifies reply choices render as selectable event cards and selected options continue through the agent request path
- command approval coverage that verifies command-bearing turns render compact execution-suggestion rows, then expose the detailed permission request directly above the composer with `Allow once` and `Deny`, while proving approval creates exactly one isolated Agent job and never mutates user-visible center terminal tabs
- Codex runtime failure and error-only response coverage that verifies failed requests do not create approval cards
- browser-preview runtime-unavailable coverage that verifies no canned Codex/Test/Coder suggestion is created without the desktop runtime
- runtime-project gating coverage that verifies Codex does not call `request_agent_account_suggestions` while the active project is still the empty browser fallback
- Agent-session provider/account coverage in `tests/e2e/claude-provider-workspaces.spec.ts` covers explicit selected-owner marks, direct pointer/keyboard Fast toggling without a listbox, auth-first startup, exact returned labels/values, account capability ownership, stale success/rejection suppression, narrow containment, persistence, request ownership, and zero center-terminal calls; exact current counts belong in the final multi-account gate
- modified design-prototype coverage, including the focused 2/2 selection used for this provider slice
- disconnected-provider coverage that verifies the UI does not answer with canned prototype data
- setup-guidance coverage that verifies Codex login/setup guidance stays in the right panel without creating terminal tabs or runtime terminal commands
- the focused Claude workspace suite distinguishes CLI-session and API-credential source labels, covers external missing-login guidance, pending-connect deduplication, reverse-order project/session responses, a command-bearing Claude result, `Allow once`, exactly one isolated Agent job, project switching, and completion while asserting the center-terminal runtime call log stays empty
- Codex connect setup-guidance and reconnect coverage in `tests/e2e/design-prototype.spec.ts`
- Codex diagnostic status normalization coverage in Rust unit tests under [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs)

- Agent-job service and lifecycle boundaries through `tests/e2e/runtime-agent-jobs-service.spec.ts` and `tests/e2e/agent-runtime-boundaries.spec.ts`, including malformed payloads, duplicate approval, stale hydration, session-close protection, distinct log-read errors, auth gating, and expired-session blocking
- repeated-use and reload coverage through `tests/e2e/agent-runtime-aging.spec.ts`, including 30 approve/finish/fail/cancel cycles, a 25-row UI bound, project switching, durable session ownership, final-poll quiescence, and center-terminal isolation

Deleted FSD-era E2E specs must not be referenced as current coverage. The new-shell aging and restore coverage above is the current automated baseline; it does not replace long-duration or native installed-app validation.

## Documentation Rule

This document should capture only durable flow knowledge:

- flow contracts that survive beyond one sprint
- payload shapes where UI and runtime meet
- boundaries that will need to be re-explained, such as restore, approval, and execution

One-off progress notes may live in an active `WORKLOG`, but they should be absorbed into canonical docs before sprint close rather than retained as long-term history.

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

1. On initial desktop load, the app reads provider connections through [`src/shared/api/runtimeAgentAuth.ts`](../src/shared/api/runtimeAgentAuth.ts). This auth discovery is authoritative and must resolve before the renderer may read capabilities for the active provider.
2. `Codex` diagnostics in [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs) check:
   - whether the `codex` CLI exists
   - whether `~/.codex/auth.json` exists
   - whether a ChatGPT-backed session is available and not stale
3. CLI discovery first checks `PATH`, then the macOS `Codex.app` bundle locations so installed apps launched with a limited Finder PATH can still validate and run Codex.
4. When the user clicks `Connect Codex` in settings, the prototype calls `begin_agent_login` with the `Codex` provider and documented runtime scopes. It does not open a terminal tab, run `codex login`, or write into the user-owned center terminal.
5. The auth manager updates state based on the real path being local `Codex CLI` ChatGPT-session validation rather than callback-only auth.
6. Successful validation sets the provider to `connected`, appends a concise Agent-panel status message, and closes settings.
7. Failure sets `error` with the exact runtime message in the existing provider row subtext and appends the same setup guidance to the right Agent conversation. The user can run `codex login` manually outside the Agent decision flow, then reconnect.
8. Reconnect is an explicit second `Connect Codex` attempt after the CLI login completes. The app calls `begin_agent_login` again and replaces the error row with the connected CLI-session state on success.
9. Every Codex request is gated on the normalized `connected` state. The runtime obtains a stored-connection revision lease, performs exactly one fresh CLI validation on a blocking worker, skips execution when validation fails, and applies the result only if the lease is still current. The frontend refreshes the canonical connection list after a request error so another request cannot bypass reconnect.
10. `Claude` is normalized as an available, real provider. Its Connect and Disconnect actions pass through the same typed auth runtime IPC as Codex; browser preview does not fabricate connected state.
11. A Claude connection selects credentials in this order: a non-empty explicit `ANTHROPIC_API_KEY`, a valid top-level user `apiKeyHelper`, then an already authenticated session in the installed user-owned Claude Code CLI. The helper value must resolve to one canonical absolute regular executable path; arguments, whitespace, and shell syntax fail closed, and any argument-bearing behavior belongs in a user-owned, cwd-independent executable wrapper.
12. CLI-session validation uses `claude --safe-mode --setting-sources "" auth status --json`. GTUM never starts Claude.ai OAuth, reads the Keychain/credential store, or captures a token. If the CLI reports no valid first-party login, the UI instructs the user to run `claude auth login` in their own terminal and reconnect. Bedrock, Vertex, Foundry, unknown providers, and source mismatches fail closed.
13. Successful validation persists only a non-secret credential-source label and source-specific scopes: `credential:cli_session` for the local CLI session or `credential:api_key` for API-key/helper paths. GTUM does not persist or render the key, helper output, email, organization, token, subscription metadata, or raw child diagnostics. Reloaded provider state requires fresh runtime validation.
14. During startup, the auth manager may refresh a persisted real `Connected` provider or a persisted real Claude `Error`. A Claude error is retried only through fresh current CLI validation; success replaces it with `Connected`, the validated credential source and scopes, a current connection timestamp, and no identity/error data. An explicit Claude `Disconnected` snapshot receives no automatic validation or connection, and a non-real legacy Claude error normalizes to disconnected/untrusted state.
15. Claude connect, startup refresh, and request attempts capture a connection revision before blocking work. Only the current lease may update connection state or publish a response, so an old refresh cannot overwrite a later disconnect or reconnect. Disconnect first synchronizes a temporary candidate and atomically replaces the auth store; only that commit publishes the in-memory snapshot, while a pre-commit failure rejects the IPC call and preserves the prior state/revision. Legacy load admits only canonical `codex` and `claude` entries before typed deserialization and discards malformed or mismatched extras. Any Claude validation failure becomes the single generic actionable redacted message before runtime publication or persistence; Codex error behavior remains unchanged. No live `claude -p` inference has been run without explicit user approval.
16. Capability discovery starts only after the active provider snapshot is exactly `Connected`. A deferred initial connection list performs zero capability reads, connected startup performs exactly one, disconnected startup performs zero, and a successful Connect performs the first read for that provider. Provider-scoped connection and capability generations invalidate the old catalog synchronously and ignore both stale success and stale rejection after startup, connect, disconnect, reconnect, provider-action error, or capability-read error.
17. The async `read_agent_provider_capabilities` command runs its synchronous provider probe on a blocking worker. The frontend accepts the catalog only when the response owner and every current/available model owner match the requested provider, IDs and labels are nonblank, and model IDs are unique.
18. Claude catalog discovery starts the authenticated installed CLI in the same source-specific isolated mode as requests, sends exactly one SDK `initialize` control request, closes stdin, and accepts only a bounded matching success response. It sends no user prompt, `--print`, assistant turn, or inference request. Each sanitized returned `value` becomes the only selectable ID, and each model's bounded `executionOptions` is the authority for its effort levels and Fast support. Identity, email, organization, subscription, and unrelated response data are discarded. Protocol drift or invalid data fails closed without a static, historical, cached, or inferred entitlement list.
19. Provider connect, failure, reconnect, disconnect, capability state, and every option popup stay in the owning Agent panel and settings row. The active Agent header and closed composer provider marks use an explicit selected/current treatment for both real providers; neutral provider identity styling does not imply selection or readiness. Provider, model, and reasoning remain compact non-wrapping menus whose opened lists render exact full names and current state. Fast is a capability-gated direct boolean button with no popup/listbox: one native pointer, Enter, or Space activation inverts it exactly once, closes any open provider/model/reasoning popup, and exposes exact `Fast mode: Enabled` or `Fast mode: Disabled` through `aria-label`, `title`, and matching `aria-pressed`. Current account labels remain on one line at the default desktop width; longer valid labels wrap inside their option, and all menus plus the Fast trigger remain contained without horizontal overflow at 240 px and 260 px Agent widths. Failed/unavailable discovery preserves a stored selection for a later valid read but cannot forward it, and unsupported models hide Fast without erasing the saved preference. None of these paths may create, focus, write to, execute in, or close the user-owned center terminal.

## Flow 4. Agent Request Envelope

The input contract for `request_agent_suggestions` is fixed around these fields:

- `provider`
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

The active design prototype captures `projectPath + agentSessionId + providerId` from the owning Agent session before calling this runtime command through [`src/shared/api/runtimeAgentSuggestions.ts`](../src/shared/api/runtimeAgentSuggestions.ts). A blank `agentSessionId` is rejected before IPC, and every returned suggestion must identify the requested provider before rendering or permission handling. Browser preview no longer fabricates agent replies and surfaces a runtime-unavailable message. Provider model, reasoning, fast-mode, and attachment metadata comes from `read_agent_provider_capabilities`; the frontend must not show these controls from hardcoded values. Claude selected-model `executionOptions` override provider compatibility fields; the UI-only `Default` effort sends `reasoningLevel: null`. Each workspace-scoped Agent session persists `selectedModels`, `selectedReasoningLevels`, and `fastModes` separately for Codex and Claude. When Fast is supported, direct activation writes the inverse boolean to this existing owner and closes another open composer popup without introducing an intermediate selection state; when unsupported, the control is hidden and the effective value is `false` without deleting the saved preference. A stale Codex provider-level effort falls back to its supported default, while a stale Claude model-owned effort remains `null`. At send time one immutable snapshot freezes provider, model, attachments, reasoning, and Fast with the original project/session owner before state mutation or any await.

## Flow 5. Suggestion Request And Approval Execution

1. The user must enter a request while the provider is connected.
2. The active prototype routes runtime-backed provider requests through [`src/shared/api/runtimeAgentSuggestions.ts`](../src/shared/api/runtimeAgentSuggestions.ts). Browser preview must not create canned agent replies; it may only show an explicit desktop-runtime-required message.
3. In the desktop runtime, provider requests require a runtime-backed project opened through the native project flow. If the active project is still the empty browser fallback, the UI must show an "open a real local folder first" state and must not call `request_agent_suggestions`.
4. Claude and Codex share the frontend request boundary, but each remains gated by its own canonical connected state. Selecting an available-but-disconnected provider must show setup guidance and must not fall back to another provider or a canned response.
5. The runtime path snapshots the captured provider together with its validated explicit model selection, then packs that provider/model owner, Agent session owner, active project metadata, selected file context, recent terminal logs, supported provider options, selected attachments, and the user request into the Flow 4 envelope. An asynchronous provider switch after Send cannot rewrite this request pair.
6. While a runtime-backed provider request is pending, the owning Agent session creates a persistent assistant conversation turn and reveals live progress inside that turn one stage at a time: reading the current project context first, sending the request to the provider runtime second, and waiting for the provider response third. The UI must not render all pending stages at once on request start. When the request completes successfully, those internal progress rows are cleared from the visible thread, the same turn records `Answered HH:MM / elapsed`, and the turn reads as a normal assistant reply. Command-bearing replies leave only a lightweight execution-suggestion activity row in the turn; the actionable permission request opens directly above the composer. Failures keep enough progress/error context to explain what stopped.
   - If the user presses the composer stop control during a pending request, the frontend marks the active turn as stopped and invalidates that request generation so any later provider response cannot create a reply or approval panel. This is a UI cancellation boundary; provider/runtime-level subprocess abort remains a future explicit contract unless the adapter exposes it.
7. Inside one blocking-worker attempt, the `Codex` runtime validates the local ChatGPT session exactly once and, only on success, runs response generation through `codex exec --sandbox read-only`. It adds `--model <id>` only when the selected model came from provider capabilities, `-c model_reasoning_effort="<level>"` only when a provider-supported reasoning level is selected, and `--image <path>` for selected Codex image attachments. The prompt asks for a normal assistant reply by default and only asks for a command when user review, permission, or a terminal decision is actually needed. The `command` field is a gtum permission-card preview until the user explicitly approves it; Codex CLI approval or sandbox settings such as `approval_policy=never` must not block harmless permission-card suggestions. When the user asks for an Agent-panel event card, choice card, options, or numbered choices, the runtime prompt keeps `command` empty and formats the choices in `summary`; it must not use shell `read`, `printf`, or `echo` to collect Agent-panel choices. Status/catalog probes are bounded to five seconds and the execution child is killed and surfaced as a visible error if it does not finish within 60 seconds. On Windows, the runtime sends the prompt over stdin, prefers the Node `codex.js` entrypoint behind `codex.cmd` to avoid batch-file argument escaping failures, and suppresses subprocess console windows so prompt submission does not flash terminal windows over the UI.
8. Inside a Claude blocking-worker attempt, the adapter pins one credential/config context for validation, any required catalog refresh, and the request. A custom config root is accepted only as an existing canonical directory under the current-user home and is revalidated before child launch. CLI-session mode uses `--safe-mode --setting-sources ""`; API-key/helper mode retains `--bare`. The CLI and helper are canonical absolute regular executables, and the child receives an absolute-only `PATH` with competing credential/provider/debug/telemetry/process-wrapper controls removed. An explicit model, explicit effort, or enabled Fast repeats the bounded prompt-free catalog initialization and requires exact support on the effective selected/default model before inference. A valid model becomes separate `--model <value>` arguments, and a valid effort becomes separate `--effort <level>` arguments. Every inference request receives exactly one sanitized `--settings` JSON object containing explicit `fastMode: true` or `false`; helper mode merges only `apiKeyHelper`. `CLAUDE_CODE_EFFORT_LEVEL` is removed, while `CLAUDE_CODE_DISABLE_FAST_MODE=1` rejects enabled Fast before spawn. Model tools, MCP, slash commands, Chrome integration, resume/session flags, and session persistence remain disabled. Fast may also require organization enablement and usage credits. Catalog discovery is not inference, and no live paid inference or billing verification is claimed for this slice.
9. The response is normalized into:
   - `summary`
   - `command` (optional; present only for reviewable actions)
   - `preferredTarget`
   - `confidence`
   - `error`
10. If a provider runtime exits non-zero, returns unstructured output, returns an empty response without a command or error reason, or identifies a provider different from the request, the frontend appends a provider-specific error message and does not create an approval card.
11. If a provider returns a reply-only structured response, the frontend renders that as a normal assistant message with no review card. If the reply contains numbered choices, the frontend extracts those choices into a selectable decision event card and sends the selected option back through the same Agent session and provider path. An error-only structured response renders as a provider-labeled message with no approval action.
12. `src/prototype.jsx` owns the agent decision UI state. Provider responses render as conversational Agent turns in their captured session: pending turns show inline progress, completed reply-only turns show normal assistant copy, numbered-choice replies add a decision event card, and command-bearing turns add a compact execution-suggestion row that shows the command count, risk, and decision state.
13. Command-bearing turns must not rely on a generic assistant sentence or an intermediate `Review command` step. The detailed permission request appears only when a decision is pending, directly above the composer, with the command preview, risk, reason, isolated-Agent-job target, and direct `Allow once` and `Deny` actions. A synchronous in-flight decision guard records the decision before IPC so double-click or Allow-then-Deny input cannot create duplicate jobs. `Deny` records the refusal in the right panel and starts no work.
14. Agent-tab requests, permission cards, and approved agent work must never create, select, rename, split, focus, write into, close, or otherwise mutate any user-visible center terminal tab or pane. The center terminal is exclusively user-owned before, during, and after approval. Implementations must not route agent approval through `create_terminal_session`, `create_terminal_session_with_command`, `execute_terminal_session_command`, or any future equivalent if the result appears in the center terminal/workbench.
15. `Allow once` invokes `create_agent_job` exactly once per approved command and immediately registers the returned snapshot in the active project/session context. `list_agent_jobs`, `read_agent_job_logs`, and `cancel_agent_job` require the canonical owning project; list additionally filters by durable Agent session ID. If the isolated contract does not exist for the platform or command, the app shows an explicit unavailable/manual-run state instead of opening or touching a center terminal tab.
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
6. The current Rust workspace contract persists recent project paths, last opened project path, storage version, and timestamps. Selected file, provider choice, task history, line anchors, and future scheduling policy remain future contract fields.
7. Provider connection lists reload through the auth-first contract in Flow 3. On each eligible connection-list refresh, a stored real Claude error receives fresh current validation; an explicit disconnect terminates that eligibility, and untrusted legacy error state remains disconnected. The renderer waits for the resulting active-provider state: only exact `Connected` schedules one capability read, while unresolved, disconnected, or error startup schedules none. Generation leases keep late success and late rejection from changing the latest connection/catalog state, and this repeated-use path does not touch the center terminal.
8. Agent session-directory metadata is stored separately from conversation content so a restored session keeps the same ID, provider, provider-keyed model/reasoning/Fast selections, and persisted-job address after reload. Only bounded `codex` and `claude` keys are restored; invalid legacy values safely fall back through the effective provider/model capability rules.
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
- agent auth and suggestion runtime service contract coverage through [`tests/e2e/runtime-agent-auth-service.spec.ts`](../tests/e2e/runtime-agent-auth-service.spec.ts) and [`tests/e2e/runtime-agent-suggestions-service.spec.ts`](../tests/e2e/runtime-agent-suggestions-service.spec.ts); the current runtime suggestion service passes 24/24 focused cases
- injected Codex suggestion runtime bridge coverage in `tests/e2e/design-prototype.spec.ts`
- fixed-model/fixed-mode regression coverage that verifies the right agent panel, settings modal, statusbar, and Codex request envelope do not expose unsynced model or execution-mode values
- live Codex activity coverage that verifies pending runtime requests reveal concrete operation progress rows sequentially, then clear those rows after the response while keeping the final assistant turn and answer-time metadata
- reply-only Codex coverage that verifies normal answers do not create review cards or composer approval panels
- numbered-choice Codex coverage that verifies reply choices render as selectable event cards and selected options continue through the agent request path
- command approval coverage that verifies command-bearing turns render compact execution-suggestion rows, then expose the detailed permission request directly above the composer with `Allow once` and `Deny`, while proving approval creates exactly one isolated Agent job and never mutates user-visible center terminal tabs
- Codex runtime failure and error-only response coverage that verifies failed requests do not create approval cards
- browser-preview runtime-unavailable coverage that verifies no canned Codex/Test/Coder suggestion is created without the desktop runtime
- runtime-project gating coverage that verifies Codex does not call `request_agent_suggestions` while the active project is still the empty browser fallback
- Agent-session provider coverage in `tests/e2e/claude-provider-workspaces.spec.ts`; the current workspace suite passes 23/23 and covers explicit selected-provider marks, direct pointer/keyboard Fast toggling without a listbox, auth-first connected/disconnected/error startup reads, Connect as the first read after disconnected startup, exact returned labels and values, connect/disconnect/reconnect capability ownership, stale success and rejection suppression, default-width current-label readability, maximum-length label wrapping, selected-bottom-row visibility after reopen, compact-control containment at 240 px and 260 px, persistence, request ownership, and zero center-terminal calls
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

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
5. [`src-tauri/src/runtime/filesystem/mod.rs`](../src-tauri/src/runtime/filesystem/mod.rs) rejects paths outside the active project root and returns a `ProjectFileSnapshot`.
6. `runtimeProjects.ts` maps the snapshot into the editor tab shape, using `displayPath`, text content, language extension, and bounded binary/truncated fallbacks. Browser preview may use injected test readers, but the product shell does not ship curated file content.
7. The opened file is inserted into the current workbench group through the existing prototype `openFile` store action.
8. Line anchors and terminal-log file references are still deferred until terminal/session integration is reintroduced.

## Flow 3. Provider Diagnostics And Codex Connect

1. On initial load, the app reads provider connections through [`src/shared/api/runtimeAgentAuth.ts`](../src/shared/api/runtimeAgentAuth.ts) when the desktop runtime is available.
2. `Codex` diagnostics in [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs) check:
   - whether the `codex` CLI exists
   - whether `~/.codex/auth.json` exists
   - whether a ChatGPT-backed session is available and not stale
3. When the user clicks `Connect Codex` in settings, the prototype opens a runtime-backed terminal tab and runs `codex login --device-auth`.
4. If the login terminal is cancelled, failed, or exits before validation can begin, the UI keeps settings open, marks Codex as `error`, and does not call `begin_agent_login`.
5. After the login terminal starts successfully, the frontend calls `begin_agent_login` with the `Codex` provider and the documented runtime scopes.
6. The auth manager updates state based on the real path being local `Codex CLI` ChatGPT-session validation rather than callback-only auth.
7. Successful validation sets the provider to `connected` and closes settings. Failure sets `error` with the exact runtime message in the existing provider row subtext so the user can finish CLI login and reconnect.
8. Reconnect is an explicit second `Connect Codex` attempt after the CLI login completes. The app reopens the login helper, calls `begin_agent_login` again, and replaces the error row with the connected CLI-session state on success.
9. `Claude` remains in a deferred/not-yet-daily-use state.

## Flow 4. Agent Request Envelope

The input contract for `request_agent_suggestions` is fixed around these fields:

- `provider`
- `projectName`
- `projectPath`
- `activeTabId`
- `activeTabTitle`
- `activeFilePath`
- `activeFileLine`
- `activeFileSnippet`
- `lastNLogLines`
- `userTask`
- `executionMode`

The active design prototype now calls this runtime command through [`src/shared/api/runtimeAgentSuggestions.ts`](../src/shared/api/runtimeAgentSuggestions.ts) when the desktop runtime is available, the active provider is `Codex`, and the active project is runtime-backed. Browser preview no longer fabricates agent replies and surfaces a runtime-unavailable message for Codex requests.

## Flow 5. Suggestion Request And Approval Execution

1. The user must enter a request while the provider is connected.
2. The active prototype routes runtime-backed `Codex` requests through [`src/shared/api/runtimeAgentSuggestions.ts`](../src/shared/api/runtimeAgentSuggestions.ts). Browser preview must not create canned agent replies; it may only show an explicit desktop-runtime-required message.
3. In the desktop runtime, `Codex` requests require a runtime-backed project opened through the native project flow. If the active project is still the empty browser fallback, the UI must show an "open a real local folder first" state and must not call `request_agent_suggestions`.
4. In the desktop runtime, non-`Codex` providers must not silently fall back to canned replies. `Claude` remains deferred until a real provider contract exists, and the UI must show that state explicitly.
5. The runtime path packs active project metadata, selected file context, recent terminal logs, and the user request into the Flow 4 envelope.
6. After validating the connection, the `Codex` runtime requests suggestions through `codex exec --sandbox read-only`. On Windows, the runtime sends the prompt over stdin and prefers the Node `codex.js` entrypoint behind `codex.cmd` to avoid batch-file argument escaping failures.
7. The response is normalized into:
   - `summary`
   - `command`
   - `preferredTarget`
   - `confidence`
   - `error`
8. If the `Codex` runtime exits non-zero, returns unstructured output, or returns an empty command without an error reason, the frontend appends a visible Codex error message and does not create an approval card.
9. If `Codex` returns an error-only structured response, the frontend renders that as a Codex message with no approval action.
10. `src/prototype.jsx` owns the approval UI state. No command runs before approval unless the current approval policy auto-runs the command.
11. Runtime-backed terminal tabs route approved commands through `src/shared/api/runtimeTerminals.ts`, which writes to `execute_terminal_session_command` or starts a new PTY through `create_terminal_session_with_command`.
12. If a Codex suggestion targets the current tab but that tab is not runtime-backed, the command must be rerouted into a new runtime-backed PTY tab instead of simulating success in place.
13. Browser preview must keep only deterministic empty fallback state and must not simulate agent execution, provider answers, project files, or terminal success.
14. Task history records request and approval outcomes.

## Flow 6. Restore And Repeated Use

1. Browser/Vite preview starts from the empty `Open a project` shell and keeps workspace persistence local-only.
2. Desktop startup calls `read_workspace_runtime_snapshot` through [`src/shared/api/runtimeWorkspace.ts`](../src/shared/api/runtimeWorkspace.ts).
3. Before provider, workspace, or Telegram stores initialize, the Rust runtime ensures the app-data root is a directory. If an older install left a file at that path, it is backed up beside the app-data root as `.legacy-file-<timestamp>.json`.
4. If the snapshot includes an execution mode, the frontend applies it locally without writing it back during restore.
5. If the snapshot includes `lastOpenedProjectPath`, the frontend reopens that path through Flow 1 by calling `read_project_overview`; the stored path is not treated as a complete project object.
6. Successful runtime-backed project opens call `remember_workspace_project`.
7. Execution mode changes from the agent panel, settings modal, or tweak controls call `set_workspace_execution_mode`.
8. The current Rust workspace contract persists recent project paths, last opened project path, execution mode, storage version, and timestamps. Selected file, provider choice, task history, and line anchors remain future contract fields.
9. Provider connection lists reload from the runtime, but real-provider state must be revalidated so stale connected state does not survive unchecked.
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
- workspace restore coverage that verifies startup reopens the saved runtime project and applies the saved execution mode
- workspace persistence coverage that verifies project opens and execution mode changes call the runtime workspace commands
- agent suggestion runtime service contract coverage through [`tests/e2e/runtime-agent-suggestions-service.spec.ts`](../tests/e2e/runtime-agent-suggestions-service.spec.ts)
- injected Codex suggestion runtime bridge coverage in `tests/e2e/design-prototype.spec.ts`
- Codex runtime failure and error-only response coverage that verifies failed requests do not create approval cards
- browser-preview runtime-unavailable coverage that verifies no canned Codex/Test/Coder suggestion is created without the desktop runtime
- runtime-project gating coverage that verifies Codex does not call `request_agent_suggestions` while the active project is still the empty browser fallback
- deferred desktop-provider coverage that verifies the UI does not answer with canned prototype data
- PTY reroute coverage that verifies Codex commands targeting non-runtime-backed tabs start a new runtime-backed terminal session
- agent auth runtime service contract coverage through [`tests/e2e/runtime-agent-auth-service.spec.ts`](../tests/e2e/runtime-agent-auth-service.spec.ts)
- injected Codex CLI login launcher coverage in `tests/e2e/design-prototype.spec.ts`
- Codex login error, cancellation, and reconnect coverage in `tests/e2e/design-prototype.spec.ts`
- Codex diagnostic status normalization coverage in Rust unit tests under [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs)

Deleted FSD-era E2E specs must not be referenced as current coverage. Provider login launcher coverage now exists for the new shell, but aging and restore behavior still need new-shell coverage beside `design-prototype.spec.ts` or split coverage only after those flows exist again.

## Documentation Rule

This document should capture only durable flow knowledge:

- flow contracts that survive beyond one sprint
- payload shapes where UI and runtime meet
- boundaries that will need to be re-explained, such as restore, approval, and execution

One-off progress notes may live in an active `WORKLOG`, but they should be absorbed into canonical docs before sprint close rather than retained as long-term history.

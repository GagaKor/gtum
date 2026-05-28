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

1. The frontend starts at [`src/app/main.tsx`](../src/app/main.tsx), then loads the uploaded design fixture through [`src/app/providers/legacy-prototype.ts`](../src/app/providers/legacy-prototype.ts).
2. In browser/Vite preview, `hasTauriRuntime()` is false. The project opener keeps the design fixture active and exposes `window.__GTUM_BACKEND_BRIDGE__` for E2E verification.
3. In the Tauri desktop runtime, the sidebar `Open Project Folder` action opens the native directory picker through `@tauri-apps/plugin-dialog`.
4. After a folder is selected, [`src/prototype.jsx`](../src/prototype.jsx) calls `invoke("read_project_overview", { path })`.
5. New TSX components should consume the typed service seam in [`src/shared/api/runtimeProjects.ts`](../src/shared/api/runtimeProjects.ts) instead of duplicating invoke details.
6. [`src-tauri/src/runtime/filesystem/mod.rs`](../src-tauri/src/runtime/filesystem/mod.rs) returns project metadata, file tree, and Git overview.
7. The frontend maps the Tauri `ProjectOverview` into the prototype project shape, updates the titlebar, sidebar project card, file tree, agent context branch, and statusbar.
8. PTY/session restore remains deferred for the next backend slice. It must be added on top of the TSX/FSD migration seam instead of restoring the deleted FSD frontend.

## Flow 2. File Focus And Code Surface

1. The user selects a file from the sidebar file tree.
2. Browser/Vite preview keeps using the uploaded fixture through `tabFromFile` so design tests can run without Tauri.
3. If the active project is runtime-backed, the current legacy prototype calls `invoke("read_project_file", { projectPath, filePath })`.
4. Extracted TSX components should route the same behavior through [`src/shared/api/runtimeProjects.ts`](../src/shared/api/runtimeProjects.ts).
5. [`src-tauri/src/runtime/filesystem/mod.rs`](../src-tauri/src/runtime/filesystem/mod.rs) rejects paths outside the active project root and returns a `ProjectFileSnapshot`.
6. The frontend maps the snapshot into the editor tab shape, using `displayPath`, text content, language extension, and bounded binary/truncated fallbacks.
7. The opened file is inserted into the current workbench group through the existing prototype `openFile` store action.
8. Line anchors and terminal-log file references are still deferred until terminal/session integration is reintroduced.

## Flow 3. Provider Diagnostics And Codex Connect

1. On initial load, the app reads both provider connections and provider diagnostics.
2. `Codex` diagnostics in [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs) check:
   - whether the `codex` CLI exists
   - whether `~/.codex/auth.json` exists
   - whether a ChatGPT-backed session is available
3. When the user clicks `Connect Codex`, `begin_agent_login` runs.
4. The auth manager updates state based on the real path being local `Codex CLI` session validation rather than callback-only auth.
5. When the user clicks `Open Codex Login`, the app launches `codex login --device-auth` in a new terminal session.
6. Successful validation sets the provider to `connected`, failure sets `error`, and `Claude` remains in a deferred/not-yet-daily-use state.

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

The active design prototype does not currently call this runtime command. When this slice is reintroduced, TSX/FSD components should assemble the payload from active project state, active editor/terminal tab, provider state, and execution mode. The runtime receiver remains [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs).

## Flow 5. Suggestion Request And Approval Execution

1. The user must enter a request while the provider is connected.
2. The active prototype currently returns canned chat responses and simulated approval suggestions from [`src/prototype.jsx`](../src/prototype.jsx).
3. The durable runtime path should pack active project metadata, selected file context, recent terminal logs, and the user request into the Flow 4 envelope.
4. After validating the connection, the `Codex` runtime requests suggestions through `codex exec --sandbox read-only`.
5. The response is normalized into:
   - `summary`
   - `command`
   - `preferredTarget`
   - `confidence`
   - `error`
6. `src/prototype.jsx` owns the approval UI state. No command runs before approval.
7. After approval, current prototype behavior appends simulated command output into the chosen tab. A future terminal slice must replace this with the existing Tauri PTY commands instead of restoring deleted FSD frontend helpers.
8. Task history records request and approval outcomes.

## Flow 6. Restore And Repeated Use

1. The active prototype starts from design fixture state on page load.
2. Runtime persistence commands still exist in Tauri: `read_workspace_runtime_snapshot`, `save_workspace_runtime_snapshot`, `remember_workspace_project`, and `set_workspace_execution_mode`.
3. Repeated-use behavior should persist the last project path, selected file, provider choice, execution mode, and task history from the prototype state.
4. On app restart, the frontend should reopen the last project through Flow 1 and prefer the previously selected file through Flow 2 when still valid.
5. Provider connection lists should reload from the runtime, but real-provider state must be revalidated so stale connected state does not survive unchecked.
6. PTY session objects are memory-backed and are not fully restorable after a process restart.

## Linked Test Flows

The current E2E-aligned coverage is [`tests/e2e/design-prototype.spec.ts`](../tests/e2e/design-prototype.spec.ts).

It covers:

- clean uploaded design shell rendering
- design proportions after the frontend reset
- project and files accordion behavior without legacy frontend state
- browser fallback for the backend bridge state

Deleted FSD-era E2E specs must not be referenced as current coverage. When terminal, provider, agent request, aging, or restore behavior is reintroduced on top of the prototype, add new tests beside `design-prototype.spec.ts` or split coverage only after those flows exist again.

## Documentation Rule

This document should capture only durable flow knowledge:

- flow contracts that survive beyond one sprint
- payload shapes where UI and runtime meet
- boundaries that will need to be re-explained, such as restore, approval, and execution

One-off progress notes may live in an active `WORKLOG`, but they should be absorbed into canonical docs before sprint close rather than retained as long-term history.

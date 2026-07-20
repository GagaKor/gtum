# Multi-Project Agent Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep several projects open, show one active workbench at a time, and preserve project-owned editor, terminal, Codex-request, Agent-session, and Agent-job state while users switch freely.

**Architecture:** Upgrade workspace persistence to an explicit v2 `openProjectPaths + activeProjectPath + recentProjects` state machine, then consume it through a project registry and a project-keyed workbench directory. Capture immutable `projectPath + agentSessionId` ownership at every async boundary so inactive requests and jobs complete in their original context. Rust PTYs and Agent jobs stay alive across UI switches; the frontend polls only lightweight inactive summaries and keeps detailed terminal/log rendering limited to visible work.

**Tech Stack:** React 19, TypeScript, Tauri 2, Rust/Serde, Playwright, Cargo tests.

**Requirement source:** `.context/multi-project-editor-spec.md`

---

## File map and ownership

- Create `src/features/projects/model/projectWorkspaceStore.ts`: pure open/activate/close and project-keyed workbench transitions.
- Create `src/features/projects/model/useProjectWorkspaces.ts`: runtime hydration, lazy project loading, stale-response guards, and active-workbench facade.
- Create `src/widgets/project-sidebar/ui/ProjectSwitcher.tsx`: open-project rows, active selection, status, and guarded close UI.
- Create `src/features/agents/model/useProjectAgentFleet.ts`: bounded summary state for open projects; detailed logs remain active-session only.
- Modify `src/shared/api/runtimeWorkspace.ts`: workspace v2 types and atomic open/activate/close commands.
- Modify `src/shared/api/runtimeProjects.ts` and `runtimeTerminals.ts`: preserve immutable project ownership on tabs.
- Modify `src-tauri/src/runtime/workspace.rs` and `src-tauri/src/lib.rs`: v1-to-v2 migration and atomic commands.
- Modify `src/prototype.jsx` once during integration; do not overwrite the existing Agent-runtime stabilization work.
- Create focused store and multi-project E2E specs; extend aging/boundary specs only where required.
- Update canonical product, architecture, flow, sidebar, sprint, and validation documents after behavior is green.

Only the integrator edits `src/prototype.jsx` and `src/styles.css`; other workers own focused new files or backend contracts.

### Task 1: Lock the project-workspace state model with pure tests

**Files:**
- Create: `src/features/projects/model/projectWorkspaceStore.ts`
- Create: `tests/e2e/project-workspace-store.spec.ts`
- Read: `src/features/workbench/model/types.ts`

- [ ] **Step 1: Write failing tests for open A/open B, activate A without discarding B, update only A's workbench, reject unopened activation, and block closing a busy project.**
- [ ] **Step 2: Run `npx playwright test tests/e2e/project-workspace-store.spec.ts` and confirm failure is caused by the missing model.**
- [ ] **Step 3: Implement the minimal serializable state:**

```ts
export type ProjectWorkspaceStore<W> = {
  openOrder: string[]
  activePath: string | null
  entriesByPath: Record<string, {
    path: string
    project: RuntimeProject | null
    workbench: W
    hydration: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
    closeBlockedReason?: string | null
  }>
}
```

All functions return new objects, dedupe paths, enforce `activePath` membership, and update only the specified entry.

- [ ] **Step 4: Re-run the focused spec and confirm it passes.**
- [ ] **Step 5: Commit only these files with `feat(projects): add project workspace state model`.**

### Task 2: Upgrade persisted workspace state to v2

**Files:**
- Modify: `src-tauri/src/runtime/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shared/api/runtimeWorkspace.ts`
- Modify: `tests/e2e/workspace-runtime-service.spec.ts`

- [ ] **Step 1: Add failing Rust tests for v1 migration, open A/B, activate A, close B, unopened activation rejection, path dedupe, and `activeProjectPath` membership.**
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml runtime::workspace::tests -- --nocapture` and confirm the new expectations fail.**
- [ ] **Step 3: Extend the snapshot:**

```rust
pub struct WorkspaceSnapshot {
    pub recent_projects: Vec<String>,
    pub open_project_paths: Vec<String>,
    pub active_project_path: Option<String>,
    pub last_opened_project_path: Option<String>,
    pub updated_at: u64,
    pub storage_version: u32,
}
```

`last_opened_project_path` remains a compatibility alias during v2. Add `open_workspace_project`, `activate_workspace_project`, and `close_workspace_project`; each transition and persistence write is atomic and never touches PTY or Agent managers.

- [ ] **Step 4: Add failing TypeScript command-envelope assertions for all three commands and v1-compatible reads.**
- [ ] **Step 5: Run `npx playwright test tests/e2e/workspace-runtime-service.spec.ts` and observe missing-command failures.**
- [ ] **Step 6: Implement the TypeScript seam and rerun both focused suites.**
- [ ] **Step 7: Format-check touched Rust files and record any unrelated repository-wide format gap.**
- [ ] **Step 8: Commit with `feat(workspace): persist open project registry`.**

### Task 3A: Preserve immutable project ownership on files

**Files:**
- Modify: `src/shared/api/runtimeProjects.ts`
- Modify: `src/features/workbench/model/types.ts`
- Modify: `src-tauri/src/runtime/filesystem/mod.rs` only if the existing response is insufficient
- Modify: `tests/e2e/runtime-project-service.spec.ts`

- [ ] **Step 1: Write failing tests asserting every runtime and fallback editor snapshot retains immutable canonical `projectPath`.**
- [ ] **Step 2: Add failing save/patch tests proving an A-owned file cannot be submitted through project B and that mixed-owner patch batches are rejected before runtime invocation.**
- [ ] **Step 3: Run the focused service tests and confirm the missing ownership assertions fail.**
- [ ] **Step 4: Preserve `projectPath` through runtime mapping, `WorkbenchTab`, and save/patch requests. Use the backend-returned canonical root; never substitute the currently active project.**
- [ ] **Step 5: Re-run focused TypeScript and filesystem tests and commit with `fix(files): preserve project ownership on editor tabs`.**

### Task 3B: Make terminal ownership a backend-enforced contract

**Files:**
- Modify: `src/shared/api/runtimeTerminals.ts`
- Modify: `src-tauri/src/runtime/pty/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `tests/e2e/runtime-terminal-service.spec.ts`
- Create: `src-tauri/src/runtime/pty/ownership_tests.rs` if separating the focused Rust tests keeps the existing module readable

- [ ] **Step 1: Write failing frontend tests requiring `projectPath` in terminal create/list/read/write/execute/resize/rename/close envelopes and in terminal snapshots, logs, raw output, and tabs.**
- [ ] **Step 2: Write failing Rust tests proving a session created for A rejects every B-owned lookup or mutation, while A remains accepted.**
- [ ] **Step 3: Add a test proving terminal ownership remains A after the shell changes cwd to a child or unrelated directory. `cwd` is display/process state, never ownership.**
- [ ] **Step 4: Store one canonical immutable `project_path` at session creation. Require `{ projectPath, sessionId }` for every later command and filter list results by project.**
- [ ] **Step 5: Return `projectPath` on snapshots, logs, and raw output so the frontend can reject a mismatched response instead of attaching it to the active project.**
- [ ] **Step 6: Re-run focused Playwright and PTY tests. Stage only terminal-related hunks from the already-dirty `pty/mod.rs` and `lib.rs`, then commit with `fix(terminals): enforce immutable project ownership`.**

### Task 3C: Integrate owner-aware file and terminal calls without losing in-flight work

**Files:**
- Modify: `src/prototype.jsx`
- Modify: `src/shared/api/runtimeAgentSuggestions.ts`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `tests/e2e/runtime-agent-suggestions-service.spec.ts`
- Modify: `tests/e2e/runtime-terminal-service.spec.ts` only for integration fixtures

- [ ] **Step 1: Add failing integration coverage proving every center-terminal callback captures `{ projectPath, terminalSessionId }` before await and continues to target its owner after the active project changes.**
- [ ] **Step 2: Add a failing Agent-context test proving an A project can never be combined with a B-owned active file or terminal tab, and that a missing owner is rejected for runtime-backed context.**
- [ ] **Step 3: Update create/list/poll/input/resize/rename/close call sites to the owner-aware service without changing Agent-tab execution or mutating the center terminal from Agent approvals.**
- [ ] **Step 4: Route editor save through the tab's immutable owner, not the render-time active project, and validate Agent context ownership before invoking a provider.**
- [ ] **Step 5: Re-run the design, runtime-project, runtime-terminal, Agent-suggestion, and Agent-boundary specs. Stage only ownership-related hunks from the dirty integration files.**
- [ ] **Step 6: Commit with `fix(workbench): route runtime actions to project owners`.**

### Task 4: Hydrate and switch the open-project registry

**Files:**
- Create: `src/features/projects/model/useProjectWorkspaces.ts`
- Create: `src/widgets/project-sidebar/ui/ProjectSwitcher.tsx`
- Modify: `src/prototype.jsx`
- Modify: `src/styles.css`
- Create: `tests/e2e/multi-project-workspace.spec.ts`

- [ ] **Step 1: Add E2E restoring `openProjectPaths: [A, B]`, `activeProjectPath: B`; expect two rows plus B title/files.**
- [ ] **Step 2: Assert clicking A invokes `activate_workspace_project`, switches to A, and never invokes the folder picker.**
- [ ] **Step 3: Run the focused spec and observe the singleton-project failure.**
- [ ] **Step 4: Implement immediate basename rows, active-only startup hydration, lazy selection hydration, per-path stale-response generations, visible missing-path errors, append-and-activate folder open, and selection-only row switching.**
- [ ] **Step 5: Remove `RECENT_PROJECTS = []` and all no-op project handlers.**
- [ ] **Step 6: Re-run the focused E2E and commit with `feat(projects): switch open projects from the sidebar`.**

### Task 5: Make the center workbench project-scoped

**Files:**
- Modify: `src/features/projects/model/useProjectWorkspaces.ts`
- Modify: `src/features/projects/model/projectWorkspaceStore.ts`
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/multi-project-workspace.spec.ts`

- [ ] **Step 1: Add failing E2E:** open a file and terminal in A, switch to B and see B's independent workbench, then return to A and see A's exact tab IDs, layout, dirty buffer, terminal session ID, and selected file.
- [ ] **Step 2: Add a failing inactive-PTY continuation test. Produce delayed A output, switch to B, assert no close/cancel, return to A, and observe the same live session ID plus the delayed output.**
- [ ] **Step 3: Add a cross-project save test proving an A editor always calls `write_project_file` with `projectPath: A`, even when save finishes after switching to B.**
- [ ] **Step 4: Add a cross-project context test proving A file/terminal context can never be sent with B request ownership.**
- [ ] **Step 5: Run the focused spec and confirm singleton workbench ownership and inactive PTY rendering cause the expected failures.**
- [ ] **Step 6: Replace singleton `workspace` with `workbenchByProject[path]`; every asynchronous callback captures its owner before awaiting.**
- [ ] **Step 7: Poll raw xterm output only for mounted terminals. Keep inactive PTYs alive without multiplying 60ms raw loops or overlapping one-second summary loops. On return, the mounted view resumes reading the same live runtime session.**
- [ ] **Step 8: Re-run focused E2E/runtime specs and commit with `feat(workbench): isolate state by project`.**

### Task 6: Keep Codex requests and Agent jobs attached to their origin

**Files:**
- Create: `src/features/agents/model/useProjectAgentFleet.ts`
- Modify: `src/features/agents/model/useAgentJobLifecycle.ts`
- Modify: `src/prototype.jsx`
- Modify: `src/widgets/project-sidebar/ui/ProjectSwitcher.tsx`
- Modify: `tests/e2e/agent-runtime-boundaries.spec.ts`
- Modify: `tests/e2e/agent-runtime-aging.spec.ts`
- Modify: `tests/e2e/multi-project-workspace.spec.ts`

- [ ] **Step 1: Add the failing A-late/B-fast request scenario. Start A, switch to B, finish B, finish A last; B must show only B and A must show only A after returning. Stopping B must not invalidate A.**
- [ ] **Step 2: Add a failing A-to-B-to-A scenario that preserves A's selected Agent session, conversation, in-flight progress, permission card, and stop target exactly while B owns independent state.**
- [ ] **Step 3: Add a failing background-job scenario. Create A job, switch to B while A is running, advance A independently of UI reads, and expect A row `Working` then `Done` without cancel or center-terminal mutation.**
- [ ] **Step 4: Before implementation, capture the center DOM, active tab/session, focus, and counts of terminal mutation commands. Approve A work across a project switch and assert all remain unchanged.**
- [ ] **Step 5: Run focused specs and confirm globally keyed generation/activity state, active-only job views, and any terminal side effect cause the expected failures.**
- [ ] **Step 6: Key request generations, typing/progress, permission decisions, and create-in-flight state by `canonicalProjectPath + "\0" + agentSessionId`. Capture `{ project, sessionId, contextKey }` before every provider or job await.**
- [ ] **Step 7: Implement a bounded fleet summary: low-cadence list snapshots for open projects, detailed logs only for the active project/session, and no per-inactive-project detailed one-second hook.**
- [ ] **Step 8: Block close while that project has a provider request, job creation, `running`, or `cancelling` work. Switching remains allowed.**
- [ ] **Step 9: Verify duplicate suggestion IDs in A and B create exactly one correctly owned job each.**
- [ ] **Step 10: Re-run focused specs, including the center-terminal regression, and commit with `feat(agents): preserve work across project switches`.**

### Task 7: Restore, age, document, and verify the complete contract

**Files:**
- Modify: `tests/e2e/multi-project-workspace.spec.ts`
- Modify: `tests/e2e/agent-runtime-aging.spec.ts`
- Modify: `docs/product-plan.md`
- Modify: `docs/technical-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/message-flow.md`
- Modify: `docs/left-menu-views.md`
- Modify: `docs/design-system.md`
- Modify: `docs/frontend-design-benchmarks.md`
- Modify: `docs/ui-ux-wireframes.md`
- Modify: `docs/mvp-backlog.md`
- Modify: `docs/sprint-plan.md`
- Modify after fresh evidence: `docs/MVP_VALIDATION_NOTES.md`
- Modify if migration/install behavior changes: `docs/release-build-ci.md`

- [ ] **Step 1: Add reload/native-restart coverage for open-set/active restore and v1 migration. Unfinished Agent jobs restore as `interrupted`; prior PTY session IDs restore only as disconnected/empty placeholders according to the chosen UX. Neither PTYs nor Agent jobs relaunch automatically.**
- [ ] **Step 2: Extend the 30-cycle aging scenario so work remains running while projects switch; runtime completion must not depend on UI log reads.**
- [ ] **Step 3: Assert Agent approval causes no increase in center-terminal mutation commands (`create`, `write`, `execute`, `close`) and preserves active center tab/session/focus. Visible-terminal resize/read calls are not Agent mutations.**
- [ ] **Step 4: Update canonical English docs. Replace obsolete `single project context` wording with multiple open projects and one visible active workbench. Document v2 migration, close blocking, inactive execution, polling bounds, and restart safety.**
- [ ] **Step 5: Record Claude, Git operations, and file-level diff inspection as the next independent implementation plans; do not imply they shipped here.**
- [ ] **Step 6: Run fresh verification:**

```bash
npm run lint
npm run build
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

- [ ] **Step 7: Perform native installed-app smoke on available platforms: open A/B through the picker, switch via rows, keep A work running while B is active, and verify center-terminal isolation. Record unavailable Windows/macOS evidence explicitly.**
- [ ] **Step 8: Commit documentation and fresh evidence with `docs: define multi-project agent workspace contract`.**

## Explicit non-goals and follow-ons

- Do not show several project workbenches simultaneously in the center; several remain open while one is visible.
- Do not automatically resume PTY processes or Agent jobs after native app restart.
- Do not start Claude integration, Git write operations, or diff UI in this plan.
- Decide fairness for the global 100-job Agent retention bound before sustained multi-project use.
- Define behavior for an open project path renamed or deleted while a job is running.

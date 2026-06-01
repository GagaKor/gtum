# Real Runtime Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the installable `gtum` app into working software by completing the real `Codex login -> suggestion -> approval -> PTY execution -> restore` loop and keeping mock behavior limited to browser-preview regression tests.

**Architecture:** Browser/Vite preview may use fixture projects, canned replies, and simulated terminal output only as design-test scaffolding. The Tauri desktop runtime must either call real runtime contracts or show explicit unavailable/deferred states; it must never silently report mock success. Codex is the first daily-use provider path, while Claude remains deferred until Codex reaches an installable-app smoke baseline.

**Tech Stack:** React 19, TypeScript, Vite, Tauri v2, Rust, Codex CLI session auth, PTY runtime, Playwright E2E, Cargo checks, GitHub Actions release gates.

---

## Current Baseline

- Active branch: `dev`.
- Active frontend entry: `src/app/main.tsx`.
- Integration shell: `src/prototype.jsx`.
- Runtime seams already present:
  - `src/shared/api/runtimeProjects.ts`
  - `src/shared/api/runtimeTerminals.ts`
  - `src/shared/api/runtimeAgentAuth.ts`
  - `src/shared/api/runtimeAgentSuggestions.ts`
  - `src/shared/api/runtimeWindow.ts`
- Tauri commands already present:
  - project/file read
  - PTY create/read/write/close
  - provider auth snapshots
  - Codex diagnostics and suggestion request
  - workspace persistence commands
- Latest guardrail already landed:
  - desktop runtime no longer falls through to canned provider replies
  - Codex commands targeting mock tabs reroute to a new PTY-backed tab

## Acceptance Criteria

- In the installable desktop app, a user can open a real project folder and see runtime-backed project metadata.
- The app can launch `codex login --device-auth` in a real PTY tab.
- After login, provider diagnostics clearly show whether the Codex CLI session is ready, expired, missing, or failed.
- A user request goes through `request_agent_suggestions` and `codex exec --sandbox read-only`, not canned prototype replies.
- Approved commands run through a PTY-backed tab. Desktop runtime must not append simulated `✓ done` output.
- Reload restores last project, selected file, execution mode, and provider state from runtime-backed persistence.
- Browser preview remains usable for design regression but is visibly treated as non-desktop fallback.
- macOS installable smoke passes locally; Windows installable smoke remains the release gate before master.

## Team Ownership

- `Planner`: keep scope focused on the real runtime loop and defer Claude until Codex passes smoke.
- `Orchestrator`: sequence tasks so tests land before implementation and commits stay small.
- `Designer`: ensure unavailable/deferred states are visible without adding explanatory cards or breaking the uploaded design.
- `Frontend`: own `src/prototype.jsx` and `src/shared/api/*` consumer behavior.
- `Backend`: own `src-tauri/src/runtime/*` and command diagnostics.
- `QA`: own acceptance criteria, mock-vs-runtime boundaries, and doc sync.
- `Tester`: own Playwright regression, native smoke steps, and aging notes.

## File Structure Target

- `src/prototype.jsx`
  - Keep as the integration shell until the runtime loop is stable.
  - Remove desktop-runtime success paths that depend on `EXEC_OUTPUTS` or canned provider replies.
- `src/shared/api/runtimeWorkspace.ts`
  - Create typed wrapper for workspace persistence commands.
- `src/shared/api/runtimeAgentAuth.ts`
  - Keep Codex CLI login and diagnostics contract strict.
- `src/shared/api/runtimeAgentSuggestions.ts`
  - Keep runtime request envelope and target routing strict.
- `src/shared/api/runtimeTerminals.ts`
  - Keep PTY create/read/write/close as the only desktop command execution path.
- `src-tauri/src/runtime/auth/mod.rs`
  - Own provider connection state and stale-session behavior.
- `src-tauri/src/runtime/codex.rs`
  - Own Codex CLI diagnostics and `codex exec` response normalization.
- `src-tauri/src/runtime/workspace.rs`
  - Own runtime-backed restore state.
- `tests/e2e/design-prototype.spec.ts`
  - Keep UI flow coverage while the prototype remains the integration shell.
- `tests/e2e/runtime-agent-auth-service.spec.ts`
  - Add Codex auth edge cases.
- `tests/e2e/runtime-agent-suggestions-service.spec.ts`
  - Add request-envelope and failure-state coverage.
- `tests/e2e/runtime-terminal-service.spec.ts`
  - Add no-simulation desktop execution coverage.
- `tests/e2e/workspace-runtime-service.spec.ts`
  - Create for workspace persistence seam.
- `docs/message-flow.md`, `docs/architecture.md`, `docs/technical-design.md`, `docs/sprint-plan.md`
  - Update whenever runtime contracts or user-visible flow rules change.

---

## Task 1: Add A Desktop Runtime Project Gate

**Files:**
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `docs/message-flow.md`

- [ ] **Step 1: Write failing E2E for runtime-without-real-project**

Add a test that injects `__GTUM_AGENT_RUNTIME__.hasRuntime() === true`, keeps the active project as the browser fixture (`runtimeBacked: false`), sends a Codex request, and expects an explicit "open a real project first" message instead of calling `request_agent_suggestions`.

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run build
npm run test:e2e -- --grep "requires a runtime-backed project before Codex requests"
```

Expected: FAIL because the current shell still sends the fixture project path into the runtime request.

- [ ] **Step 3: Implement the project gate**

In `src/prototype.jsx`, before `requestRuntimeAgentSuggestions`, require `activeProject.runtimeBacked === true` when `agentSuggestionRuntimeService.hasRuntime()` is true.

- [ ] **Step 4: Show the state in the agent thread**

Append a system/assistant message that tells the user to open a real project folder through the native picker. Do not open a modal or add a new page.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build
npm run test:e2e -- --grep "requires a runtime-backed project before Codex requests"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/prototype.jsx tests/e2e/design-prototype.spec.ts docs/message-flow.md
git commit -m "fix(runtime): require real project for desktop Codex requests"
```

---

## Task 2: Add Workspace Runtime Restore Seam

**Files:**
- Create: `src/shared/api/runtimeWorkspace.ts`
- Create: `tests/e2e/workspace-runtime-service.spec.ts`
- Modify: `src/prototype.jsx`
- Modify: `docs/architecture.md`
- Modify: `docs/message-flow.md`

- [ ] **Step 1: Write service tests for runtime snapshot commands**

Cover:
- `read_workspace_runtime_snapshot`
- `save_workspace_runtime_snapshot`
- `remember_workspace_project`
- `set_workspace_execution_mode`
- browser-preview fallback returns `null` or no-op state without pretending desktop persistence exists

- [ ] **Step 2: Run the failing service test**

Run:

```bash
npm run test:e2e -- tests/e2e/workspace-runtime-service.spec.ts
```

Expected: FAIL because `runtimeWorkspace.ts` does not exist.

- [ ] **Step 3: Implement `runtimeWorkspace.ts`**

Create a typed service following the style of `runtimeProjects.ts`, `runtimeTerminals.ts`, and `runtimeAgentAuth.ts`.

- [ ] **Step 4: Wire project and execution mode persistence**

In `src/prototype.jsx`:
- call `rememberWorkspaceProject` after a successful native project open
- call `setWorkspaceExecutionMode` when execution mode changes
- call `readWorkspaceRuntimeSnapshot` on startup when desktop runtime is available

- [ ] **Step 5: Verify restore coverage**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/workspace-runtime-service.spec.ts tests/e2e/design-prototype.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/api/runtimeWorkspace.ts tests/e2e/workspace-runtime-service.spec.ts src/prototype.jsx docs/architecture.md docs/message-flow.md
git commit -m "feat(runtime): add workspace restore service"
```

---

## Task 3: Harden Codex Login And Diagnostics

**Files:**
- Modify: `src/shared/api/runtimeAgentAuth.ts`
- Modify: `src-tauri/src/runtime/auth/mod.rs`
- Modify: `src-tauri/src/runtime/codex.rs`
- Modify: `tests/e2e/runtime-agent-auth-service.spec.ts`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `docs/message-flow.md`

- [ ] **Step 1: Add tests for stale and missing Codex session states**

Cover:
- Codex CLI missing
- `~/.codex/auth.json` missing
- ChatGPT session missing or expired
- user cancels login terminal
- reconnect after completing CLI login

- [ ] **Step 2: Run the focused tests**

Run:

```bash
npm run test:e2e -- tests/e2e/runtime-agent-auth-service.spec.ts --grep "Codex"
```

Expected: FAIL for newly added cases.

- [ ] **Step 3: Normalize diagnostics into user-facing connection states**

Use only these desktop states:
- `disconnected`
- `pending`
- `connected`
- `error`

Keep `connectionKind: "real"` for Codex. Do not emit `mock` for desktop runtime.

- [ ] **Step 4: Make Settings display the exact failure reason**

Keep the existing design layout. Use existing provider row subtext/error surfaces; do not add a large instructional card.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/runtime-agent-auth-service.spec.ts tests/e2e/design-prototype.spec.ts
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/api/runtimeAgentAuth.ts src-tauri/src/runtime/auth/mod.rs src-tauri/src/runtime/codex.rs tests/e2e/runtime-agent-auth-service.spec.ts tests/e2e/design-prototype.spec.ts docs/message-flow.md
git commit -m "fix(auth): harden Codex session diagnostics"
```

---

## Task 4: Complete Real Codex Suggestion Request Handling

**Files:**
- Modify: `src/shared/api/runtimeAgentSuggestions.ts`
- Modify: `src-tauri/src/runtime/codex.rs`
- Modify: `tests/e2e/runtime-agent-suggestions-service.spec.ts`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `docs/message-flow.md`

- [ ] **Step 1: Add tests for runtime Codex failures**

Cover:
- Codex CLI exits non-zero
- Codex returns text that cannot be normalized into a command
- Codex returns an empty command
- request envelope includes selected editor context when an editor tab is active
- request envelope includes recent PTY logs when a terminal tab is active

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run test:e2e -- tests/e2e/runtime-agent-suggestions-service.spec.ts
```

Expected: FAIL for missing normalization/error cases.

- [ ] **Step 3: Normalize runtime failures into agent messages**

Runtime failure should append a visible Codex error message. It must not append canned replies or empty success cards.

- [ ] **Step 4: Keep commands approval-bound**

Even when Codex returns a high-confidence command, no command should execute before approval unless the explicit approval policy says auto-run.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/runtime-agent-suggestions-service.spec.ts tests/e2e/design-prototype.spec.ts
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/api/runtimeAgentSuggestions.ts src-tauri/src/runtime/codex.rs tests/e2e/runtime-agent-suggestions-service.spec.ts tests/e2e/design-prototype.spec.ts docs/message-flow.md
git commit -m "fix(codex): surface real suggestion failures"
```

---

## Task 5: Remove Desktop Command Simulation From Approval Execution

**Files:**
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `tests/e2e/runtime-terminal-service.spec.ts`
- Modify: `docs/message-flow.md`

- [ ] **Step 1: Add failing E2E for desktop runtime no-simulation**

Inject desktop terminal runtime as available, then make PTY creation fail. Approve a command and assert the UI shows the runtime failure instead of appending simulated `✓ done`.

- [ ] **Step 2: Run failing E2E**

Run:

```bash
npm run build
npm run test:e2e -- --grep "does not simulate approved command success in desktop runtime"
```

Expected: FAIL because `EXEC_OUTPUTS` can still backfill simulated output in some desktop paths.

- [ ] **Step 3: Implement strict desktop execution policy**

In `onApprove`:
- if `terminalRuntimeService.hasRuntime()` is true, every approved command must call `createTerminalTabWithCommand` or `executeCommand`
- if runtime execution fails, mark the tab failed and append the error
- do not call `EXEC_OUTPUTS` in desktop runtime
- keep `EXEC_OUTPUTS` for browser preview only

- [ ] **Step 4: Verify**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/design-prototype.spec.ts tests/e2e/runtime-terminal-service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prototype.jsx tests/e2e/design-prototype.spec.ts tests/e2e/runtime-terminal-service.spec.ts docs/message-flow.md
git commit -m "fix(runtime): forbid simulated desktop command success"
```

---

## Task 6: Installable App Smoke Runbook And Evidence

**Files:**
- Modify: `docs/MVP_VALIDATION_NOTES.md`
- Modify: `docs/release-build-ci.md`
- Modify: `docs/sprint-plan.md`

- [ ] **Step 1: Run macOS installable smoke**

Run:

```bash
npx tauri build --bundles dmg --verbose
```

Then validate:
- DMG mounts
- app launches
- window fills resized viewport
- native project picker opens
- real project opens
- Codex login terminal launches
- Codex diagnostics update
- Codex request either returns a real suggestion or visible runtime failure
- approved command creates or writes to a PTY-backed tab

- [ ] **Step 2: Record exact results**

Update `docs/MVP_VALIDATION_NOTES.md` with date, platform, artifact path, pass/fail, and residual issues.

- [ ] **Step 3: Keep Windows as release gate**

Update `docs/release-build-ci.md` so Windows install/launch smoke remains required before master/release readiness.

- [ ] **Step 4: Verify docs**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/MVP_VALIDATION_NOTES.md docs/release-build-ci.md docs/sprint-plan.md
git commit -m "docs: record installable runtime smoke plan"
```

---

## Task 7: Keep Claude Deferred Until Codex Passes

**Files:**
- Modify: `docs/product-plan.md`
- Modify: `docs/technical-design.md`
- Modify: `docs/message-flow.md`
- Modify: `tests/e2e/design-prototype.spec.ts`

- [ ] **Step 1: Add/keep E2E guard for Claude deferred state**

The test should verify that desktop runtime does not connect Claude through mock OAuth and does not answer with canned provider replies.

- [ ] **Step 2: Document the rule**

State that Claude is not the next implementation target until Codex passes installable smoke for login, request, approval, PTY execution, and restore.

- [ ] **Step 3: Verify**

Run:

```bash
npm run test:e2e -- --grep "deferred desktop providers"
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/product-plan.md docs/technical-design.md docs/message-flow.md tests/e2e/design-prototype.spec.ts
git commit -m "docs: keep Claude deferred until Codex runtime loop passes"
```

---

## Final Verification Gate

Run this before merging the completed slice:

```bash
npm run lint
npm run build
npm run test:e2e
cargo check --manifest-path src-tauri/Cargo.toml
npx tauri build --no-bundle
git diff --check
```

Expected:
- lint passes
- production build passes
- all Playwright tests pass
- Rust check passes
- native no-bundle build passes
- no whitespace errors

## Release Readiness Gate

Before master:

- macOS installable smoke must be recorded.
- Windows installable smoke must be recorded.
- GitHub Actions must produce platform artifacts for Windows and macOS.
- Any remaining browser-preview fallback must be documented as design-test-only.
- No desktop runtime flow may report mock provider or mock terminal success.


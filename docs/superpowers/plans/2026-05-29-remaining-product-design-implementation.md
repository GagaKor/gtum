# Remaining Product Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the migration from the uploaded JSX product design into reusable TSX/FSD React components, then reconnect the backend runtime flows each component needs.

**Architecture:** Keep the uploaded design DOM and CSS as the visual source of truth until each zone is extracted. Extract one workbench zone at a time from `src/prototype.jsx` into TSX components that preserve class names, behavior, and E2E landmarks. Backend behavior must move behind typed `src/shared/api/*` service seams instead of direct `invoke()` calls inside UI components.

**Tech Stack:** React 19, TypeScript, Vite, Zustand-ready FSD boundaries, Tauri v2 commands, Playwright E2E, ESLint.

---

## Current Baseline

- Active branch: `dev`.
- Latest completed backend seam: `src/shared/api/runtimeProjects.ts`.
- Active frontend entry: `src/app/main.tsx`.
- Legacy uploaded design module: `src/prototype.jsx`.
- Visual source of truth: `/Users/kwon/Downloads/test (1)`.
- Current E2E coverage:
  - `tests/e2e/design-prototype.spec.ts`
  - `tests/e2e/runtime-project-service.spec.ts`

## File Structure Target

- `src/app/main.tsx`
  - Keep as the thin app entry.
- `src/app/providers/legacy-prototype.ts`
  - Remove only after all major zones are extracted.
- `src/prototype.jsx`
  - Shrink gradually. It remains the integration shell until each extracted zone is proven.
- `src/widgets/app-shell/ui/Titlebar.tsx`
  - Extract titlebar markup and shell actions.
- `src/widgets/app-shell/ui/StatusBar.tsx`
  - Extract statusbar runtime indicators.
- `src/widgets/project-sidebar/ui/ProjectSidebar.tsx`
  - Extract projects/files accordion and project open/file open actions.
- `src/widgets/workspace-stage/ui/WorkspaceStage.tsx`
  - Extract workbench layout, editor tabs, terminal tabs, split groups.
- `src/widgets/agent-sidebar/ui/AgentPanel.tsx`
  - Extract provider/model row, context summary, messages, quick prompts, composer.
- `src/widgets/settings/ui/SettingsModal.tsx`
  - Extract settings sections and provider/model/appearance/execution controls.
- `src/widgets/approval/ui/ApprovalModal.tsx`
  - Extract approval modal and auto-run toast surfaces.
- `src/entities/project/model/types.ts`
  - Extend only when UI needs stable project domain fields.
- `src/entities/workspace/model/types.ts`
  - Extend for active group, active file, execution mode, and persisted layout.
- `src/entities/agent/model/types.ts`
  - Extend for provider, model, message, suggestion, and approval state.
- `src/features/workbench/model/types.ts`
  - Extend for editor/terminal tab registry and split layout actions.
- `src/features/workbench/model/workbenchStore.ts`
  - Create pure workbench state transition helpers before React wiring.
- `src/features/agents/model/approval-policy.ts`
  - Extend to match prototype policy behavior and tests.
- `src/shared/api/runtimeProjects.ts`
  - Keep as the project/file service seam.
- `src/shared/api/runtimeTerminals.ts`
  - Create typed wrapper for PTY commands.
- `src/shared/api/runtimeAgentSuggestions.ts`
  - Create typed wrapper for provider diagnostics and suggestion request.
- `src/shared/api/runtimeWorkspace.ts`
  - Create typed wrapper for workspace restore/persistence.
- `tests/e2e/design-prototype.spec.ts`
  - Keep visual smoke coverage green until extraction is complete.
- `tests/e2e/workbench-tabs.spec.ts`
  - Create for editor/terminal tabs, split groups, and file focus.
- `tests/e2e/terminal-runtime.spec.ts`
  - Create for PTY session bridge.
- `tests/e2e/agent-runtime.spec.ts`
  - Create for provider/suggestion/approval flow.
- `tests/e2e/workspace-restore.spec.ts`
  - Create for last project, selected file, execution mode, and task history restore.
- `docs/architecture.md`, `docs/message-flow.md`, `docs/sprint-plan.md`, `docs/technical-design.md`
  - Update whenever a runtime contract, component ownership boundary, or persisted state changes.

---

## Sprint 18: TSX Shell And Project Sidebar Extraction

**Goal:** Extract the stable shell and project explorer zones from `src/prototype.jsx` without changing the uploaded design visually.

### Task 1: Add Shell Extraction E2E Guards

**Files:**
- Modify: `tests/e2e/design-prototype.spec.ts`

- [ ] **Step 1: Write failing test assertions for stable landmarks**

Add assertions that titlebar, sidebar, center, agent panel, and statusbar still render after TSX extraction.

- [ ] **Step 2: Run the focused test**

Run: `npm run test:e2e -- tests/e2e/design-prototype.spec.ts`

Expected: PASS before implementation; this is a guard test for upcoming refactors.

- [ ] **Step 3: Commit guard coverage**

Run:

```bash
git add tests/e2e/design-prototype.spec.ts
git commit -m "test: guard design shell extraction"
```

### Task 2: Extract Titlebar And StatusBar

**Files:**
- Create: `src/widgets/app-shell/ui/Titlebar.tsx`
- Create: `src/widgets/app-shell/ui/StatusBar.tsx`
- Modify: `src/prototype.jsx`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Move titlebar JSX into `Titlebar.tsx`**
- [ ] **Step 2: Move statusbar JSX into `StatusBar.tsx`**
- [ ] **Step 3: Keep existing class names and visible copy unchanged**
- [ ] **Step 4: Import TSX components from `src/prototype.jsx`**
- [ ] **Step 5: Run verification**

Run:

```bash
npm run build
npm run lint
npm run test:e2e -- tests/e2e/design-prototype.spec.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/widgets/app-shell/ui src/prototype.jsx docs/architecture.md tests/e2e/design-prototype.spec.ts
git commit -m "refactor: extract app shell components"
```

### Task 3: Extract ProjectSidebar

**Files:**
- Create: `src/widgets/project-sidebar/ui/ProjectSidebar.tsx`
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `docs/message-flow.md`

- [ ] **Step 1: Write test that `Projects` and `Files` accordions still collapse independently**
- [ ] **Step 2: Move sidebar JSX and tree node JSX into `ProjectSidebar.tsx`**
- [ ] **Step 3: Pass `runtimeProjects`-backed callbacks as props**
- [ ] **Step 4: Keep folder dialog ownership in the integration layer**
- [ ] **Step 5: Run focused verification**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/design-prototype.spec.ts tests/e2e/runtime-project-service.spec.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/widgets/project-sidebar/ui src/prototype.jsx tests/e2e/design-prototype.spec.ts docs/message-flow.md
git commit -m "refactor: extract project sidebar"
```

---

## Sprint 19: Workbench Tabs, Terminal Runtime, And Restore Base

**Goal:** Turn the center workbench into reusable TSX state and reconnect terminal runtime behavior behind typed service seams.

### Task 4: Create Pure Workbench State Helpers

**Files:**
- Modify: `src/features/workbench/model/types.ts`
- Create: `src/features/workbench/model/workbenchStore.ts`
- Create: `src/features/workbench/model/workbenchStore.test.ts`

- [ ] **Step 1: Write failing unit-style TypeScript contract test for opening an editor tab**
- [ ] **Step 2: Add helpers for `openFile`, `setActiveTab`, `splitGroup`, `moveTab`, and `closeTab`**
- [ ] **Step 3: Run build to type-check the contract**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/workbench/model
git commit -m "feat: add workbench state helpers"
```

### Task 5: Extract WorkspaceStage

**Files:**
- Create: `src/widgets/workspace-stage/ui/WorkspaceStage.tsx`
- Modify: `src/prototype.jsx`
- Create: `tests/e2e/workbench-tabs.spec.ts`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Write E2E for opening `OnboardingFunnel.tsx` into an editor tab**
- [ ] **Step 2: Write E2E for split group rendering**
- [ ] **Step 3: Extract center workspace JSX into `WorkspaceStage.tsx`**
- [ ] **Step 4: Keep editor/terminal classes unchanged**
- [ ] **Step 5: Run verification**

Run:

```bash
npm run build
npm run lint
npm run test:e2e -- tests/e2e/workbench-tabs.spec.ts tests/e2e/design-prototype.spec.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/widgets/workspace-stage/ui src/prototype.jsx tests/e2e/workbench-tabs.spec.ts docs/architecture.md
git commit -m "refactor: extract workspace stage"
```

### Task 6: Add Terminal Runtime Service

**Files:**
- Create: `src/shared/api/runtimeTerminals.ts`
- Create: `tests/e2e/terminal-runtime.spec.ts`
- Modify: `docs/message-flow.md`
- Modify: `docs/technical-design.md`

- [ ] **Step 1: Write service contract test for `create_terminal_session_with_command`**
- [ ] **Step 2: Implement `createTerminalSession`, `readTerminalLogs`, `executeTerminalCommand`, and `closeTerminalSession` wrappers**
- [ ] **Step 3: Wire a first terminal tab action to the service behind browser fallback**
- [ ] **Step 4: Run verification**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/terminal-runtime.spec.ts
```

Expected: PASS in browser fallback and type-checks desktop command payloads.

- [ ] **Step 5: Commit**

```bash
git add src/shared/api/runtimeTerminals.ts tests/e2e/terminal-runtime.spec.ts docs/message-flow.md docs/technical-design.md
git commit -m "feat: add terminal runtime service"
```

---

## Sprint 20: Agent Panel, Provider Runtime, And Approval Execution

**Goal:** Replace canned agent behavior with typed provider/suggestion/approval contracts while preserving the uploaded design agent panel.

### Task 7: Extract AgentPanel

**Files:**
- Create: `src/widgets/agent-sidebar/ui/AgentPanel.tsx`
- Modify: `src/prototype.jsx`
- Create: `tests/e2e/agent-runtime.spec.ts`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Write E2E for provider/model/mode row visibility**
- [ ] **Step 2: Extract right panel JSX into `AgentPanel.tsx`**
- [ ] **Step 3: Preserve composer, quick prompt, context summary, and approval suggestion DOM**
- [ ] **Step 4: Run verification**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/agent-runtime.spec.ts tests/e2e/design-prototype.spec.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/agent-sidebar/ui src/prototype.jsx tests/e2e/agent-runtime.spec.ts docs/architecture.md
git commit -m "refactor: extract agent panel"
```

### Task 8: Add Provider And Suggestion Runtime Service

**Files:**
- Create: `src/shared/api/runtimeAgentSuggestions.ts`
- Modify: `src/entities/agent/model/types.ts`
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/agent-runtime.spec.ts`
- Modify: `docs/message-flow.md`

- [ ] **Step 1: Write failing test for `request_agent_suggestions` payload shape**
- [ ] **Step 2: Implement provider diagnostics and suggestion request wrappers**
- [ ] **Step 3: Replace canned suggestion path only behind a runtime-backed feature branch**
- [ ] **Step 4: Keep browser fallback canned replies for design preview**
- [ ] **Step 5: Run verification**

Run:

```bash
npm run build
npm run lint
npm run test:e2e -- tests/e2e/agent-runtime.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/api/runtimeAgentSuggestions.ts src/entities/agent/model/types.ts src/prototype.jsx tests/e2e/agent-runtime.spec.ts docs/message-flow.md
git commit -m "feat: add agent suggestion runtime service"
```

### Task 9: Implement Approval Execution Path

**Files:**
- Modify: `src/features/agents/model/approval-policy.ts`
- Create: `src/widgets/approval/ui/ApprovalModal.tsx`
- Modify: `src/shared/api/runtimeTerminals.ts`
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/agent-runtime.spec.ts`
- Modify: `docs/message-flow.md`

- [ ] **Step 1: Write tests for low-risk auto-run, high-risk ask, and forbidden-pattern ask**
- [ ] **Step 2: Extract approval modal JSX into `ApprovalModal.tsx`**
- [ ] **Step 3: Route approved command execution through terminal runtime service**
- [ ] **Step 4: Keep undo/toast behavior visible**
- [ ] **Step 5: Run verification**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/agent-runtime.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agents/model/approval-policy.ts src/widgets/approval/ui src/shared/api/runtimeTerminals.ts src/prototype.jsx tests/e2e/agent-runtime.spec.ts docs/message-flow.md
git commit -m "feat: connect approval execution path"
```

---

## Sprint 21: Settings, Workspace Persistence, And Prototype Retirement

**Goal:** Persist repeated-use workspace state and retire `src/prototype.jsx` as the primary owner after extracted components cover the app surface.

### Task 10: Extract SettingsModal

**Files:**
- Create: `src/widgets/settings/ui/SettingsModal.tsx`
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Write E2E for opening settings and switching sections**
- [ ] **Step 2: Extract settings JSX into `SettingsModal.tsx`**
- [ ] **Step 3: Preserve provider/model/appearance/execution controls**
- [ ] **Step 4: Run verification**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/design-prototype.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/settings/ui src/prototype.jsx tests/e2e/design-prototype.spec.ts docs/architecture.md
git commit -m "refactor: extract settings modal"
```

### Task 11: Add Workspace Runtime Persistence

**Files:**
- Create: `src/shared/api/runtimeWorkspace.ts`
- Modify: `src/entities/workspace/model/types.ts`
- Create: `tests/e2e/workspace-restore.spec.ts`
- Modify: `docs/message-flow.md`
- Modify: `docs/technical-design.md`

- [ ] **Step 1: Write service contract test for snapshot read/write payloads**
- [ ] **Step 2: Wrap `read_workspace_runtime_snapshot`, `save_workspace_runtime_snapshot`, `remember_workspace_project`, and `set_workspace_execution_mode`**
- [ ] **Step 3: Persist last project path, selected file, execution mode, and task history**
- [ ] **Step 4: Run verification**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/workspace-restore.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/api/runtimeWorkspace.ts src/entities/workspace/model/types.ts tests/e2e/workspace-restore.spec.ts docs/message-flow.md docs/technical-design.md
git commit -m "feat: add workspace restore service"
```

### Task 12: Retire Legacy Prototype Provider

**Files:**
- Modify: `src/app/main.tsx`
- Modify: `src/app/providers/legacy-prototype.ts`
- Modify: `src/prototype.jsx`
- Modify: `docs/architecture.md`
- Modify: `docs/sprint-plan.md`

- [ ] **Step 1: Confirm extracted TSX components cover shell, sidebar, workspace, agent panel, approval, and settings**
- [ ] **Step 2: Replace dynamic import of `src/prototype.jsx` with the TSX composition root**
- [ ] **Step 3: Keep `src/prototype.jsx` only as archived reference or delete it if no longer imported**
- [ ] **Step 4: Run full verification**

Run:

```bash
npm run build
npm run lint
npm run test:e2e
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app src/prototype.jsx docs/architecture.md docs/sprint-plan.md
git commit -m "refactor: retire legacy prototype entry"
```

---

## Final Verification Gate

- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test:e2e`.
- [ ] Run `npm run tauri:build` if local Rust/Cargo is available.
- [ ] Update `docs/README.md`, `docs/architecture.md`, `docs/message-flow.md`, `docs/technical-design.md`, and `docs/sprint-plan.md` for any changed source-of-truth boundaries.
- [ ] Push `dev`.

Expected final state:

- The app loads from TSX/FSD components instead of `src/prototype.jsx`.
- The uploaded design visual baseline is preserved.
- Project, file, terminal, provider, suggestion, approval, and restore flows all go through typed runtime services.
- Browser preview has stable fallback behavior for design E2E.
- Desktop runtime paths are ready for Tauri verification.

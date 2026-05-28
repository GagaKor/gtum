# New Product Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the live `gtum` app to follow the new product design draft even when it conflicts with the existing implementation.

**Architecture:** Treat `docs/product-plan.md`, `docs/design-system.md`, and `/Users/kwon/Downloads/test (1)` as the product/design source of truth. Keep the existing FSD-style `app / widgets / features / shared` boundaries, but replace conflicting UI structure with the new design: title/status shell, left `Projects/Files` accordion, unified editor/terminal workbench tabs, right agent model row, settings, and risk-based approval policy.

**Tech Stack:** React 19, TypeScript, Vite, Zustand, Playwright E2E, Tauri runtime contract stubs in `src/lib/runtime.ts`.

---

## Design Override Policy

- New design wins over current implementation whenever they conflict.
- Current cards, panels, support sections, and Telegram/runtime debug surfaces can move to secondary surfaces if they weaken the new design.
- Do not preserve old UI copy or layout solely for backward compatibility.
- Runtime contracts should remain stable unless the new UI needs explicit data that cannot be derived safely.
- Every slice must leave E2E coverage that proves the new user-facing behavior.

## Source Documents

- `docs/product-plan.md`
- `docs/design-system.md`
- `docs/frontend-design-benchmarks.md`
- `docs/left-menu-views.md`
- `/Users/kwon/Downloads/test (1)/src/app.jsx`
- `/Users/kwon/Downloads/test (1)/src/sidebar.jsx`
- `/Users/kwon/Downloads/test (1)/src/workspace.jsx`
- `/Users/kwon/Downloads/test (1)/src/agent.jsx`
- `/Users/kwon/Downloads/test (1)/src/modals.jsx`

## File Structure Map

- Modify: `src/app/App.tsx`
  - Owns composition, persisted state wiring, title/status shell placement, side panel width state, and feature hook wiring.
- Modify: `src/App.css`
  - Owns global shell layout, dock resize handles, workbench group styling, agent/settings/approval visual states.
- Modify: `src/stores/workspace-store.ts`
  - Owns durable workbench UI state: panel visibility, active tab/group identifiers, captured agent context.
- Modify: `src/features/workspace/model/ui-state.ts`
  - Persists new shell state that should survive reload.
- Modify: `src/features/workspace/model/useWorkbenchLayout.ts`
  - Keeps left view mode, source control, search, outline, and diff state; should stop owning center workbench tab semantics once those are split out.
- Create: `src/features/workbench/model/types.ts`
  - Defines `WorkbenchTab`, `WorkbenchGroup`, `WorkbenchLayoutNode`, split direction, tab kind, and drag/drop actions.
- Create: `src/features/workbench/model/useWorkbenchTabs.ts`
  - Owns editor/terminal tab registry, active group state, tab move, split, close, and restore semantics.
- Create: `src/widgets/app-shell/ui/Titlebar.tsx`
  - Renders project, branch, active tab, group count, provider count, settings entry.
- Create: `src/widgets/app-shell/ui/StatusBar.tsx`
  - Renders branch, changed files, ahead/behind, tab/group count, active execution mode.
- Modify: `src/widgets/project-sidebar/ui/ProjectSidebar.tsx`
  - Replaces generic project hub sections with the new `Projects` and `Files` accordion baseline while keeping existing views available behind the rail.
- Modify: `src/widgets/workspace-stage/ui/WorkspaceStage.tsx`
  - Replaces current stage/support layout with unified editor/terminal workbench groups.
- Modify: `src/widgets/agent-sidebar/ui/AgentSidebar.tsx`
  - Promotes provider header, model picker, mode row, context summary, thread, quick prompts, composer, and pending review flow.
- Create: `src/features/agents/model/approval-policy.ts`
  - Defines risk levels, approval behavior, trusted dirs, forbidden patterns, and policy decisions.
- Create: `src/widgets/settings/ui/SettingsModal.tsx`
  - Renders `Connections`, `Models`, `Appearance`, `Execution`, `About`.
- Modify: `src/features/agents/model/useAgentSuggestions.ts`
  - Applies approval policy before opening approval UI or auto-running allowed low-risk actions.
- Modify: `tests/e2e/project-workspace.spec.ts`
  - Updates shell/sidebar/workbench expectations.
- Create: `tests/e2e/new-design-shell.spec.ts`
  - Covers titlebar/statusbar, left accordion, right agent model row, settings entry.
- Create: `tests/e2e/workbench-tabs.spec.ts`
  - Covers editor/terminal tab opening, tab move, split group, active group.
- Create: `tests/e2e/approval-policy.spec.ts`
  - Covers low-risk auto-run toast, high-risk explicit approval, forbidden pattern override.
- Modify: `docs/sprint-plan.md`
  - Declares Sprint 17 as active new-design implementation sprint.
- Modify: `docs/mvp-backlog.md`
  - Aligns workspace redesign backlog with the new design baseline.

---

## Sprint 17: New Design Shell And Left Accordion

**Goal:** Make the first viewport visibly follow the new design: titlebar, statusbar, resizable side docks, `Projects/Files` accordion, and compact agent model row.

**Exit Criteria:**
- The default screen no longer reads as the older mission-header/card layout.
- Left side starts with `Projects` and `Files` accordion sections.
- Right side starts with provider/model/mode control.
- Existing project-open and provider E2E flows still pass.

### Task 1: New Shell E2E Baseline

**Files:**
- Create: `tests/e2e/new-design-shell.spec.ts`
- Modify: `tests/e2e/project-workspace.spec.ts`

- [ ] **Step 1: Write failing shell tests**

```ts
import { expect, test } from '@playwright/test'

test('renders the new product design shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-titlebar')).toBeVisible()
  await expect(page.getByTestId('app-statusbar')).toBeVisible()
  await expect(page.getByTestId('left-projects-section')).toBeVisible()
  await expect(page.getByTestId('left-files-section')).toBeVisible()
  await expect(page.getByTestId('agent-model-row')).toBeVisible()
})
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test:e2e -- tests/e2e/new-design-shell.spec.ts`

Expected: FAIL because the new `data-testid` shell landmarks do not exist yet.

- [ ] **Step 3: Commit the failing test only if starting a TDD branch**

Run:

```bash
git add tests/e2e/new-design-shell.spec.ts
git commit -m "test: cover new design shell baseline"
```

### Task 2: Add Titlebar And Statusbar

**Files:**
- Create: `src/widgets/app-shell/ui/Titlebar.tsx`
- Create: `src/widgets/app-shell/ui/StatusBar.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Implement `Titlebar`**

Expose `data-testid="app-titlebar"` and render project name, branch, active tab label, group count, connected provider count, and settings action.

- [ ] **Step 2: Implement `StatusBar`**

Expose `data-testid="app-statusbar"` and render branch, changed-file count, active terminal/editor tab count, execution mode, and active context.

- [ ] **Step 3: Replace old mission header**

In `src/app/App.tsx`, replace the old `mission-header` as the first visual element. Keep old data calculations if still useful, but route them into `Titlebar` and `StatusBar`.

- [ ] **Step 4: Run verification**

Run: `npm run build`

Expected: PASS.

Run: `npm run test:e2e -- tests/e2e/new-design-shell.spec.ts -g "renders the new product design shell"`

Expected: shell assertions pass except accordion details if Task 3 is not done yet.

### Task 3: Rebuild Left Sidebar Around Projects/Files Accordion

**Files:**
- Modify: `src/widgets/project-sidebar/ui/ProjectSidebar.tsx`
- Modify: `src/App.css`
- Modify: `tests/e2e/project-workspace.spec.ts`
- Modify: `tests/e2e/new-design-shell.spec.ts`

- [ ] **Step 1: Write accordion interaction tests**

Add assertions that `Projects` and `Files` can collapse independently and that project rows show current/recent project metadata.

- [ ] **Step 2: Implement `Projects` accordion section**

Use current project, recent projects, branch, changed-file count, open-folder action, and compact single-line rows.

- [ ] **Step 3: Implement `Files` accordion section**

Move file tree into the default `Files` section and preserve `FileTreeNodeView` selection behavior.

- [ ] **Step 4: Preserve rail views without letting them dominate**

Keep `project`, `explorer`, `source-control`, `outline`, `settings` modes accessible, but make default project mode match the new `Projects/Files` baseline.

- [ ] **Step 5: Run verification**

Run: `npm run test:e2e -- tests/e2e/project-workspace.spec.ts tests/e2e/new-design-shell.spec.ts`

Expected: PASS.

### Task 4: Promote Agent Model Row

**Files:**
- Modify: `src/widgets/agent-sidebar/ui/AgentSidebar.tsx`
- Modify: `src/features/auth/model/provider-ui.ts`
- Modify: `src/App.css`
- Modify: `tests/e2e/new-design-shell.spec.ts`

- [ ] **Step 1: Add test for active provider/model/mode row**

Assert `agent-model-row` contains provider/model text and the active execution mode.

- [ ] **Step 2: Implement provider/model display contract**

Map the selected provider diagnostics to a readable model label. If a provider has no model, fall back to session/provider label.

- [ ] **Step 3: Keep mode switching usable**

Either reuse existing execution-mode radio controls or move them into a compact segmented row that updates `executionMode`.

- [ ] **Step 4: Run verification**

Run: `npm run test:e2e -- tests/e2e/provider-auth.spec.ts tests/e2e/new-design-shell.spec.ts`

Expected: PASS.

### Task 5: Sprint 17 Close

**Files:**
- Modify: `docs/sprint-plan.md`
- Modify: `docs/MVP_VALIDATION_NOTES.md` if validation evidence changes

- [ ] **Step 1: Run full verification**

Run: `npm run build`

Expected: PASS.

Run: `npm run test:e2e`

Expected: all Playwright tests pass.

Run: `npm run lint`

Expected: Either PASS, or document existing unrelated lint blockers with file/line evidence.

- [ ] **Step 2: Commit**

Run:

```bash
git add src tests docs
git commit -m "feat: implement new design shell"
git push origin dev
```

---

## Sprint 18: Unified Workbench Tabs And Split Groups

**Goal:** Replace the current center stage with the new design's editor/terminal tab model and split-group behavior.

**Exit Criteria:**
- Editor and terminal tabs share a common workbench tab model.
- Each group has its own tab strip.
- Users can create, activate, close, and split groups.
- Existing terminal and selected-file flows still work.

### Task 1: Workbench Model Tests

**Files:**
- Create: `src/features/workbench/model/types.ts`
- Create: `src/features/workbench/model/workbench-reducer.ts`
- Create: `src/features/workbench/model/workbench-reducer.test.ts` if a unit-test runner is added, otherwise cover with Playwright first
- Create: `tests/e2e/workbench-tabs.spec.ts`

- [ ] **Step 1: Write Playwright coverage**

Cover opening a project, selecting a file, creating a terminal tab, splitting right, and verifying two group tab strips.

- [ ] **Step 2: Run failing test**

Run: `npm run test:e2e -- tests/e2e/workbench-tabs.spec.ts`

Expected: FAIL until the workbench model exists.

### Task 2: Implement Workbench Types And Actions

**Files:**
- Create: `src/features/workbench/model/types.ts`
- Create: `src/features/workbench/model/useWorkbenchTabs.ts`
- Modify: `src/features/workspace/model/ui-state.ts`
- Modify: `src/stores/workspace-store.ts`

- [ ] **Step 1: Define tab and group types**

Use `kind: 'editor' | 'terminal' | 'diff' | 'test' | 'preview'`.

- [ ] **Step 2: Add actions**

Implement `openEditorTab`, `openTerminalTab`, `closeTab`, `setActiveTab`, `splitGroup`, `moveTabToGroup`, and `restoreWorkbench`.

- [ ] **Step 3: Persist only durable UI state**

Persist active group, active tab, tab layout, selected file path, and terminal ids. Do not persist transient drag state.

- [ ] **Step 4: Run verification**

Run: `npm run build`

Expected: PASS.

### Task 3: Replace WorkspaceStage With Group Renderer

**Files:**
- Modify: `src/widgets/workspace-stage/ui/WorkspaceStage.tsx`
- Modify: `src/App.css`
- Modify: `tests/e2e/project-workspace.spec.ts`
- Modify: `tests/e2e/terminal-workspace.spec.ts`
- Modify: `tests/e2e/workbench-tabs.spec.ts`

- [ ] **Step 1: Render group tab strips**

Each group must expose `data-testid="workbench-group"` and `data-testid="workbench-tab-strip"`.

- [ ] **Step 2: Render editor tabs**

Use existing selected-file content, line numbers, active line, bounded fallback, and line anchor behavior.

- [ ] **Step 3: Render terminal tabs**

Use existing terminal session/log hooks while presenting them as workbench tabs.

- [ ] **Step 4: Move support surfaces out of default path**

Task History, Telegram, runtime/debug, and secondary panels should not interrupt the main workbench first viewport.

- [ ] **Step 5: Run verification**

Run: `npm run test:e2e -- tests/e2e/project-workspace.spec.ts tests/e2e/terminal-workspace.spec.ts tests/e2e/workbench-tabs.spec.ts`

Expected: PASS.

---

## Sprint 19: Settings, Models, And Approval Policy

**Goal:** Implement the new settings and execution-control surface, including risk-based approval policy and low-risk auto-run audit/undo behavior.

**Exit Criteria:**
- Settings modal has `Connections`, `Models`, `Appearance`, `Execution`, `About`.
- Provider/model selection is visible and configurable.
- Approval policy controls low/mid/high risk behavior.
- High-risk commands always require explicit approval.
- Forbidden patterns override auto-approval.

### Task 1: Settings Modal Skeleton

**Files:**
- Create: `src/widgets/settings/ui/SettingsModal.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/App.css`
- Create: `tests/e2e/settings-policy.spec.ts`

- [ ] **Step 1: Write failing modal tests**

Assert the settings entry opens a modal with all five sections.

- [ ] **Step 2: Implement modal shell**

Implement a left rail and right content pane matching `/Users/kwon/Downloads/test (1)/src/modals.jsx`.

- [ ] **Step 3: Run verification**

Run: `npm run test:e2e -- tests/e2e/settings-policy.spec.ts -g "settings"`

Expected: PASS.

### Task 2: Approval Policy Model

**Files:**
- Create: `src/features/agents/model/approval-policy.ts`
- Modify: `src/features/agents/model/types.ts`
- Modify: `src/features/agents/model/useAgentSuggestions.ts`
- Create: `tests/e2e/approval-policy.spec.ts`

- [ ] **Step 1: Write policy tests through UI behavior**

Cover low-risk auto-run, high-risk approval modal, and forbidden pattern override.

- [ ] **Step 2: Implement pure policy helper**

Implement:

```ts
export type RiskLevel = 'low' | 'mid' | 'high'
export type ApprovalBehavior = 'always-ask' | 'auto' | 'auto-trusted'

export function decideApproval(policy, command, cwd, risk): 'auto' | 'ask' | 'blocked'
```

- [ ] **Step 3: Apply policy in agent suggestions**

Before showing approval, classify suggestion commands and route to auto-run, ask, or blocked state.

- [ ] **Step 4: Add audit and undo toast**

Record auto-run actions in UI state and display an undoable toast. If undo cannot safely reverse yet, label undo as dismiss/review and do not pretend rollback happened.

- [ ] **Step 5: Run verification**

Run: `npm run test:e2e -- tests/e2e/approval-policy.spec.ts tests/e2e/agent-request-flow.spec.ts`

Expected: PASS.

---

## Sprint 20: Integration, Responsive Rules, And Documentation Sync

**Goal:** Make the new design stable across desktop/laptop widths and finish documentation alignment.

**Exit Criteria:**
- Common laptop width does not hide primary workbench or agent controls.
- Resize/collapse order follows design-system rules.
- All source-of-truth docs match the implemented behavior.
- Full E2E suite passes.

### Task 1: Responsive And Resize Acceptance

**Files:**
- Modify: `src/App.css`
- Modify: `tests/e2e/new-design-shell.spec.ts`
- Modify: `tests/e2e/project-workspace.spec.ts`

- [ ] **Step 1: Add viewport tests**

Run shell tests at desktop and laptop widths.

- [ ] **Step 2: Fix layout constraints**

Prioritize center workbench, then agent workspace, then left panel collapse. Keep text from overflowing buttons and compact rows.

- [ ] **Step 3: Run verification**

Run: `npm run test:e2e -- tests/e2e/new-design-shell.spec.ts tests/e2e/project-workspace.spec.ts`

Expected: PASS.

### Task 2: Documentation Sync

**Files:**
- Modify: `docs/product-plan.md`
- Modify: `docs/design-system.md`
- Modify: `docs/frontend-design-benchmarks.md`
- Modify: `docs/technical-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/message-flow.md`
- Modify: `docs/MVP_VALIDATION_NOTES.md`

- [ ] **Step 1: Update technical docs only after implementation is true**

Do not claim implemented behavior before it exists. Mark planned behavior as planned and implemented behavior as implemented.

- [ ] **Step 2: Run docs verification**

Run: `git diff --check`

Expected: PASS.

### Task 3: Final Full Verification

**Files:**
- No planned edits unless failures require fixes.

- [ ] **Step 1: Build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: E2E**

Run: `npm run test:e2e`

Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`

Expected: PASS, or explicitly document any unrelated existing blockers before closing the sprint.

- [ ] **Step 4: Commit and push**

Run:

```bash
git add src tests docs
git commit -m "feat: complete new product design implementation"
git push origin dev
```

---

## Known Conflicts To Resolve In Favor Of The New Design

- Existing `mission-header` should be replaced by titlebar/statusbar shell.
- Existing repeated `agent-card` and `side-section` stacks should become compact role-specific surfaces.
- Existing center stage currently mixes primary workbench and secondary support panels; secondary panels should move out of the first-flow surface.
- Existing terminal-centric assumptions should give way to unified editor/terminal workbench tabs.
- Existing approval flow always asks; the new design introduces policy-driven low-risk auto-run with audit and undo.
- Existing settings are inside the left rail; the new design requires a real settings modal with execution policy.

## Verification Commands

Use these before closing each sprint:

```bash
npm run build
npm run test:e2e
npm run lint
git diff --check
```

If `npm run lint` fails on unrelated existing lint blockers, record exact files and rule names before committing the sprint.

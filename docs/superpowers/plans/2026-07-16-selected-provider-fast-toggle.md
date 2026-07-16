# Selected Provider And Direct Fast Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the selected Codex provider visually as explicit as Claude and turn the capability-backed Fast control into a direct on/off toggle with no intermediate menu.

**Architecture:** Keep provider, project, Agent-session, model, and Fast ownership unchanged. Add an explicit selected treatment only to provider marks that represent the active Agent-session provider in the header and composer, then simplify only the composer Fast trigger so its native button click writes the inverse boolean through the existing `onSelectFastMode` callback. Capability support remains authoritative: unsupported Fast stays hidden and saved provider preferences remain untouched.

**Tech Stack:** React, JavaScript, CSS, Playwright

---

### Task 1: Prove both UI regressions

**Files:**
- Modify: `tests/e2e/claude-provider-workspaces.spec.ts`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `tests/e2e/project-agent-context.spec.ts`

- [x] **Step 1: Add a failing selected-provider visual regression**

Add a Codex-owned Agent-session scenario that compares the active header and composer provider marks with the current accent surface. Assert that both marks use a solid border and accent foreground, then switch to Claude and assert the same selected treatment remains true without changing the provider listbox's single selected option.

- [x] **Step 2: Add a failing direct Fast-toggle regression**

For a model that reports `supportsFastMode: true`, assert the Fast trigger starts with `aria-pressed="false"`, has no listbox-popup semantics, changes immediately to `Fast mode: Enabled` and `aria-pressed="true"` after one click, creates no `Fast mode` listbox, and returns to disabled after the second click. Assert the center-terminal call log remains empty.

- [x] **Step 3: Move every existing Fast interaction to the new contract**

Before changing renderer code, replace Fast-listbox selection in all three E2E files with state-aware direct activation. Preserve existing provider/project/session persistence, frozen request payload, unsupported-model, narrow-toolbar, and zero-center-terminal assertions. Add coverage that an open reasoning popup closes when Fast toggles, and that native Enter and Space activation each toggles exactly once without creating a listbox.

- [x] **Step 4: Run the focused tests and verify RED**

```bash
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts tests/e2e/design-prototype.spec.ts tests/e2e/project-agent-context.spec.ts --workers=1 --grep "selected provider marks|Fast controls|Fast preferences|compact composer|contains every compact|opens exact full-name|runtime provider capabilities|toggles supported Fast mode directly|request options|option snapshot|session preferences|execution preferences"
```

Expected: the Codex visual assertion fails because `.provider-mark.codex` leaks dim dashed identity styling into selected surfaces, and direct-toggle assertions fail because the first Fast activation opens a listbox without changing the boolean.

### Task 2: Implement the minimal renderer correction

**Files:**
- Modify: `src/styles.css`
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/claude-provider-workspaces.spec.ts`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `tests/e2e/project-agent-context.spec.ts`

- [x] **Step 1: Add an explicit selected provider-trigger treatment**

Add a selected/current hook to the active provider marks in the Agent header and closed composer trigger. Use that hook to give active Codex or Claude the same accent foreground, solid accent-mixed border, and subtle accent surface. Do not rewrite global provider identity styles or infer connection readiness from the mark.

- [x] **Step 2: Replace the Fast listbox with a native toggle button**

Remove Fast from the composer's open-menu state and Escape-focus routing. Keep the compact bolt button, expose the boolean through `aria-pressed`, retain the exact state in `title` and `aria-label`, close any provider/model/reasoning popup, and call `onSelectFastMode(!fastMode)` directly on click. Do not change the existing persisted boolean state or request envelope. Preserve native pointer, Enter, and Space button activation.

- [x] **Step 3: Audit the migrated interaction and geometry coverage**

Confirm the RED-phase changes removed Fast from popup-containment loops while retaining Fast-trigger toolbar containment. Confirm exact-menu coverage now proves Fast has no popup, toggles in both directions, preserves provider/project/session preferences, and still reaches the frozen request payload. Do not weaken unrelated assertions to make the renderer pass.

- [x] **Step 4: Run focused coverage and verify GREEN**

```bash
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts tests/e2e/design-prototype.spec.ts tests/e2e/project-agent-context.spec.ts --workers=1 --grep "selected provider marks|Fast controls|Fast preferences|compact composer|contains every compact|opens exact full-name|runtime provider capabilities|toggles supported Fast mode directly|request options|option snapshot|session preferences|execution preferences"
```

Expected: PASS with no center-terminal runtime calls.

### Task 3: Synchronize the interaction contract and integrate

**Files:**
- Modify: `docs/design-system.md`
- Modify: `docs/frontend-design-benchmarks.md`
- Modify: `docs/product-plan.md`
- Modify: `docs/message-flow.md`
- Modify: `docs/README.md`
- Modify: `docs/DOCS_READING_ORDER.md`
- Modify: `docs/sprint-plan.md`
- Modify: `docs/MVP_VALIDATION_NOTES.md`
- Modify: `docs/superpowers/plans/2026-07-16-selected-provider-fast-toggle.md`

- [x] **Step 1: Update source-of-truth UI guidance**

Record that the closed selected-provider mark carries explicit active treatment for both real providers. Reasoning remains a list because it has multiple values; Fast is a direct boolean toggle whose exact state is present in its accessible name and pressed state, with no popup.

- [x] **Step 2: Run visual and complete pre-candidate verification**

```bash
npm run lint
npm run build
npx playwright test --workers=1
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Visually inspect both Codex and Claude selected states plus two successive Fast clicks at the default desktop size. Do not run a live provider prompt.

- [x] **Step 3: Record only fresh verification evidence**

Add the actual focused and complete counts to the new dated sprint and validation entries. Do not rewrite historical completed-plan claims.

- [x] **Step 4: Commit and pin the clean candidate**

Stage only the files named by this plan, commit them, require a clean tree, and pin `HEAD` under a private tested ref. Any later correction must produce a new commit and update the ref.

- [ ] **Step 5: Obtain independent code and documentation review, then verify the exact candidate**

Review selected-state contrast, keyboard/button semantics, session/provider persistence, request freezing, unsupported capability behavior, narrow toolbar geometry, and center-terminal isolation.

After approval, rerun lint, build, full serial Playwright, Rust formatting/check/tests, `git show --check`, clean-tree, and exact `HEAD == tested ref` assertions. If review or verification causes any change, commit, repin, and restart both review and the complete gate.

- [ ] **Step 6: Push the exact reviewed and verified SHA to `dev`**

Fetch `origin/dev`, recheck the clean tree, exact `HEAD == tested ref`, and ancestry, push that exact SHA without force and without renaming the current branch, then verify the remote branch SHA exactly.

# CodeMirror Code Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain textarea with a VS Code-like editable code surface that provides reliable language-aware syntax colors without breaking project ownership, dirty buffers, or content-hash-protected saves.

**Architecture:** Embed CodeMirror 6 directly in a focused React component rather than overlaying a highlighter on the textarea. Resolve languages from the file basename with `LanguageDescription.matchFilename(...).load()` and local `@codemirror/language-data` chunks, falling back to plain text when matching or loading fails. Reconfigure language/read-only compartments when tabs change, and use an annotation to prevent controlled external document updates from echoing through `onChange`. Keep serializable file content in the project workbench; keep CodeMirror view/selection objects out of runtime persistence.

**Tech Stack:** React 19, TypeScript, granular CodeMirror 6 packages, Vite 8, Playwright.

**Requirement source:** `.context/multi-project-editor-spec.md`

---

## File map and ownership

- Create `src/features/editor/model/editorLanguage.ts`: filename/extension matching and plaintext fallback.
- Create `src/features/editor/ui/CodeEditor.tsx`: direct CodeMirror lifecycle wrapper.
- Create `src/features/editor/ui/code-editor.css`: sizing, selection, active line, gutter, and theme bridge.
- Modify `src/prototype.jsx`: import the focused editor and remove the local textarea component.
- Modify `src/shared/api/runtimeProjects.ts`: ensure snapshots always expose owning `projectPath` and a stable filename/language hint.
- Modify `package.json` and `package-lock.json`: add only the granular CodeMirror packages actually imported (`state`, `view`, `commands`, `search`, `language`, `language-data`, and Lezer highlight); do not pull the `codemirror` meta-package with unused basic-setup features.
- Create `tests/e2e/editor-language.spec.ts`: pure language matching.
- Create `tests/e2e/code-editor.spec.ts`: syntax, editing, save, read-only, and scrolling behavior.
- Update design/product/architecture/validation docs only after fresh verification.

### Task 1: Lock filename-to-language behavior

**Files:**
- Create: `src/features/editor/model/editorLanguage.ts`
- Create: `tests/e2e/editor-language.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/language`, `@codemirror/language-data`, and `@lezer/highlight` with npm so the lockfile is reproducible.**
- [ ] **Step 2: Write failing table-driven tests for `main.tsx`, `index.js`, `package.json`, `lib.rs`, `script.py`, `styles.css`, `index.html`, `README.md`, `config.yml`, `run.sh`, `Dockerfile`, and an unknown binary/text name.**
- [ ] **Step 3: Run `npx playwright test tests/e2e/editor-language.spec.ts` and confirm failure is caused by the missing resolver.**
- [ ] **Step 4: Implement a descriptor resolver around CodeMirror's official filename matching:**

```ts
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

export const matchEditorLanguage = (path: string) =>
  LanguageDescription.matchFilename(
    languages,
    path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path,
  ) ?? null

export const loadEditorLanguage = async (path: string) => {
  const description = matchEditorLanguage(path)
  if (!description) return []

  try {
    return await description.load()
  } catch {
    return []
  }
}
```

Return stable display IDs for UI/tests, use plain text when no descriptor matches or language loading fails, and include path-qualified `Dockerfile` coverage so basename-only matching cannot regress.

- [ ] **Step 5: Re-run the focused spec and commit with `feat(editor): resolve file languages`.**

### Task 2: Build and mount the CodeMirror React surface with TDD

**Files:**
- Create: `src/features/editor/ui/CodeEditor.tsx`
- Create: `src/features/editor/ui/code-editor.css`
- Modify: `src/prototype.jsx`
- Create: `tests/e2e/code-editor.spec.ts`

- [ ] **Step 1: Create failing rendered-highlight tests for TSX, JSON, Rust, CSS, and Markdown. Each fixture must expect one textbox, line numbers, active-line state, a stable `data-language`, and multiple computed token colors without asserting CodeMirror's generated class names.**
- [ ] **Step 2: Add failing tests for typing, dirty state, horizontal overflow without forced line wrapping, and external tab-content replacement.**
- [ ] **Step 3: Run `npx playwright test tests/e2e/code-editor.spec.ts` and confirm the current textarea lacks the required contract.**
- [ ] **Step 4: Implement one `EditorView` per mounted editor pane with selected extensions only. The current React tree reuses that pane across editor-tab switches, so controlled document replacement and stale async language loads must be handled explicitly:**

- line numbers and active-line gutter
- history, standard keymap, search keymap, and `indentWithTab`
- `highlightActiveLine`, bracket matching, selection drawing, and rectangular crosshair only if already provided by the selected minimal extensions
- no line wrapping and no autocomplete/LSP/minimap in this slice
- a custom `HighlightStyle` with readable dark/light token roles for comments, keywords, strings, numbers, types, variables, functions, properties, punctuation, and invalid syntax
- [ ] **Step 5: Use `Compartment` for language and read-only state. Set both `EditorState.readOnly` and `EditorView.editable` when `!tab.isText || tab.truncated`.**
- [ ] **Step 6: Use a private external-update `Annotation`; emit `onChange(tab.id, value)` only for user edits, not when React synchronizes a changed `tab.content`.**
- [ ] **Step 7: Load language support asynchronously with cancellation/generation protection so a slow TSX load cannot overwrite a newly selected Rust tab.**
- [ ] **Step 8: Import the focused component in `src/prototype.jsx` and replace only the local textarea editor surface. Preserve the existing save/status wiring; project-owner save hardening remains Task 3. This integration is part of Task 2 because the repository has no standalone React component-test host.**
- [ ] **Step 9: Run a fresh `npm run build` before the preview-backed Playwright spec, record the main asset-size delta, and commit with `feat(editor): add CodeMirror code surface`.**

### Task 3: Integrate with project-owned edit and save contracts

**Files:**
- Modify: `src/prototype.jsx`
- Modify: `src/shared/api/runtimeProjects.ts`
- Modify: `tests/e2e/code-editor.spec.ts`
- Modify: `tests/e2e/runtime-project-service.spec.ts`

- [ ] **Step 1: Add a failing test that edits project A, clicks Save, and expects `write_project_file` with A's immutable `projectPath`, file path, new content, and prior `contentHash`.**
- [ ] **Step 2: Add a failing test that switches projects before save resolves and still updates only A's tab/hash/dirty state.**
- [ ] **Step 3: Add binary and truncated snapshot tests expecting `aria-readonly="true"`, no document mutation, and disabled Save.**
- [ ] **Step 4: Route the mounted CodeEditor through the project-owned save callback and preserve the existing status row and Save action.**
- [ ] **Step 5: Preserve `projectPath` in `RuntimeProjectFileSnapshot` and `ProjectFileSnapshot`; never infer save ownership from the currently active project.**
- [ ] **Step 6: Re-run editor and runtime-project specs and commit with `feat(editor): preserve runtime-backed editing and saves`.**

### Task 4: Remove dead highlighting code and align visual quality

**Files:**
- Modify: `src/prototype.jsx`
- Modify: `src/styles.css`
- Modify: `src/features/editor/ui/code-editor.css`
- Modify: `tests/e2e/code-editor.spec.ts`

- [ ] **Step 1: Add stable visual-contract assertions for gutter contrast, active line, selection visibility, focus ring, monospace metrics, and horizontal scroll.**
- [ ] **Step 2: Remove the unused TS-only `tokenizeLine`, `__TS_KW`, `.editor-code`, `.editor-line`, and `.tk-*` rules only after CodeMirror tests are green.**
- [ ] **Step 3: Match the app's CSS variables while keeping syntax roles distinguishable in both dark and light themes. Keep minimum text contrast readable and do not reuse the green execution accent as the only code distinction.**
- [ ] **Step 4: Re-run the focused spec and `git diff --check`, then commit with `style(editor): improve code readability`.**

### Task 5: Document and verify

**Files:**
- Modify: `docs/product-plan.md`
- Modify: `docs/technical-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/design-system.md`
- Modify: `docs/frontend-design-benchmarks.md`
- Modify: `docs/sprint-plan.md`
- Modify after evidence: `docs/MVP_VALIDATION_NOTES.md`

- [ ] **Step 1: Reconcile legacy `read-only editor` wording with the current editable, content-hash-guarded CodeMirror contract. Write new durable material in English only.**
- [ ] **Step 2: Document supported language matching, plaintext fallback, binary/truncated read-only behavior, no-wrap horizontal navigation, and project-owned save semantics.**
- [ ] **Step 3: Run fresh verification:**

```bash
npm run lint
npm run build
npx playwright test tests/e2e/editor-language.spec.ts tests/e2e/code-editor.spec.ts tests/e2e/runtime-project-service.spec.ts
npm run test:e2e
git diff --check
```

- [ ] **Step 4: Open representative TSX, JSON, Rust, CSS, Markdown, a long-line file, and a binary/truncated snapshot in the built app. Record native smoke limitations explicitly.**
- [ ] **Step 5: Update validation notes only with fresh results and commit with `docs: record CodeMirror editor contract`.**

## Explicit non-goals and follow-ons

- Monaco, LSP, IntelliSense, minimap, semantic tokens, rename, and diagnostics are not part of this syntax/readability slice.
- CodeMirror view objects and selections are not serialized into the Rust workspace snapshot.
- A dedicated file diff editor belongs to the later file-level changed-file inspection plan.
- If LSP/semantic-token work becomes a committed near-term requirement, reassess whether Monaco's VS Code compatibility outweighs its worker/bundle complexity.

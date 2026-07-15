# Claude Account Model Catalog and Picker Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clipped, static Claude alias menu with the current CLI account/policy model catalog, preserve exact selectable values through request validation, keep every model row readable inside the Agent panel, and keep provider capability controls compact at narrow panel widths.

**Architecture:** The Rust Claude adapter starts the installed, user-owned Claude CLI in isolated SDK stream mode, sends exactly one `initialize` control request, closes stdin, and parses only the bounded `models` array from the successful response. No user prompt or assistant turn is sent. A successful catalog is the only source for selectable Claude values; failure disables explicit selection and preserves saved state. The renderer keeps the catalog flat and in returned order, right-aligns the popup inside the Agent shell, and scrolls the selected row into view. Current account labels remain on one line at the default width, while longer valid labels wrap inside their option so the exact name is never clipped. Closed provider/model/reasoning/fast controls render compact marks while their opened listboxes expose exact names and current state. Provider-scoped capability generations reconcile successfully returned startup connections and provider-action/capability-read transitions so stale success or failure cannot replace a newer catalog. The raw stream control envelope is version-coupled to Claude Code, so fixture compatibility tests and a fail-closed empty catalog are required; no static or historical list is presented as account entitlement.

**Tech Stack:** Rust/Tauri, Claude Code CLI 2.1.197+, React, TypeScript, Playwright

---

### Task 1: Discover and validate the live Claude model catalog

**Files:**
- Modify: `src-tauri/src/runtime/claude.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/runtime/claude.rs`
- Test: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing parser and no-inference protocol tests**

Feed a successful SDK initialization response containing these selectable `value` fields and labels:

```rust
[
    ("default", "Default (recommended) · Opus 4.8 with 1M context"),
    ("opus[1m]", "Opus · Opus 4.8 with 1M context"),
    ("claude-fable-5[1m]", "Fable · Fable 5"),
    ("sonnet", "Sonnet · Sonnet 5"),
    ("haiku", "Haiku · Haiku 4.5"),
]
```

The fake CLI records argv and stdin. Assert argv contains `--output-format stream-json --verbose --input-format stream-json`, the source-specific isolation flags, and no `--print`, `--model`, prompt, resume, tool, MCP, or center-terminal path. Assert stdin contains exactly one `control_request` whose subtype is `initialize`, then EOF.

- [x] **Step 2: Run focused tests and verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::model_catalog_initialization_is_bounded_and_prompt_free -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::discovered_model_catalog_preserves_selectable_values_and_human_labels -- --exact --nocapture
```

Expected: FAIL because capabilities still come from `CLAUDE_MODEL_ALIASES` and no initialization parser exists.

- [x] **Step 3: Implement bounded SDK-initialization discovery**

In `src-tauri/src/runtime/claude.rs`:

- add a five-second timeout and bounded output limit
- build catalog argv with the same bare/safe-mode credential isolation as request/auth paths
- serialize one fixed-shape initialization control request with `serde_json`
- parse only the matching successful `control_response.response.models`
- retain each trimmed `value` as `model_id`
- form a one-line label from trimmed `displayName` and the leading human segment of `description`
- cap count and field lengths; reject control characters, blanks, leading-dash values, and duplicate trimmed values atomically
- discard all account, email, organization, and subscription data

Use a private documented-`ModelInfo` subset:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeModelInfo {
    value: String,
    resolved_model: Option<String>,
    display_name: String,
    description: String,
}
```

`read_claude_capabilities()` reports model selection only when the CLI exists and discovery returns a valid non-empty catalog. Otherwise it returns no selectable/current model with selection disabled, preserving rather than invalidating stored state.

- [x] **Step 4: Add malformed/failure coverage and verify GREEN**

Cover wrong request IDs, error responses, malformed JSON, blank, leading-dash, or duplicate values, blank labels, excessive models/fields/output, timeout, spawn failure, and empty catalogs. Every failure produces one atomic unavailable result without reusing a prior account catalog.

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::model_catalog_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::capabilities_ -- --nocapture
```

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/runtime/claude.rs
git commit -m "feat(claude): discover account model catalog"
```

### Task 2: Revalidate exact selectable values before Claude spawn

**Files:**
- Modify: `src-tauri/src/runtime/claude.rs`
- Test: `src-tauri/src/runtime/claude.rs`

- [x] **Step 1: Write failing request-validation tests**

Require selected `claude-fable-5[1m]` returned in `ModelInfo.value` to produce exactly one separate `--model`, `claude-fable-5[1m]` pair. Require `resolvedModel` such as `claude-fable-5` to fail when it is not itself a returned `value`. A value removed by the request-time catalog, or any leading-dash value even if a malformed catalog contains it, must fail before the inference child spawns.

- [x] **Step 2: Run tests and verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::live_catalog_model_reaches_claude_as_one_argv_value -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::request_revalidates_selected_model_against_live_catalog_before_spawn -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::resolved_model_is_not_selectable_unless_returned_as_value -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::leading_dash_catalog_value_is_rejected_before_spawn -- --exact --nocapture
```

Expected: FAIL because the current validator accepts only five hard-coded aliases.

- [x] **Step 3: Make request validation catalog-owned**

Pass an explicit discovered catalog into validation and argument construction. The top-level request attempt refreshes the catalog after auth validation whenever an explicit model is present, rejects discovery failure or a missing exact value, then passes only the validated value to inference. `model: null` keeps the runtime-default path without an extra catalog probe. Keep value and flag as separate `OsString` arguments and never use shell concatenation.

- [x] **Step 4: Verify all Claude runtime tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests -- --nocapture
```

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/runtime/claude.rs
git commit -m "fix(claude): validate live model selections"
```

### Task 3: Repair model-picker readability and collision behavior

**Files:**
- Modify: `tests/e2e/claude-provider-workspaces.spec.ts`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `tests/e2e/project-agent-context.spec.ts`
- Modify: `src/prototype.jsx`
- Modify: `src/styles.css`

- [x] **Step 1: Replace the fixture and write failing UI tests**

Use the five exact discovered values and labels from Task 1; change stored/request expectations from `opus` to `opus[1m]`. Add tests that at `1280x720` the listbox stays within `.agent`, that Haiku is visible after selecting and reopening, and that each returned label is one unclipped visual line with no raw-ID second line. Use exact accessible names rather than `/^Opus/`.

- [x] **Step 2: Run focused tests and verify RED**

```bash
npm run build
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1 --grep "model popup|selected bottom Claude model|live Claude catalog"
```

Expected: containment, selected-row visibility, and one-line text assertions fail against the current fixed left-aligned two-line menu.

- [x] **Step 3: Implement the minimal repair**

In `src/prototype.jsx`, add a list ref, scroll the selected option into view on open, render only its human label, preserve exact value in title/data and click payload, and retain listbox semantics, one `aria-selected`, Escape focus restoration, and provider-change close.

In `src/styles.css`, right-align only the model popup, explicitly retain the provider popup's left alignment, use viewport-bounded width/max-height with internal scrolling, keep current account labels on one line at the default width, wrap longer valid labels inside their option, and show a selected check affordance without a raw-ID row.

The follow-up compact-control repair replaces long closed provider/model/reasoning/fast labels with fixed-size accessible marks, moves exact names/current state into mutually exclusive listboxes, and preserves Escape focus restoration. At 260 px and 240 px Agent widths, the toolbar and all six visible controls must remain on one line and inside their client bounds, while every opened menu remains inside the Agent/composer/viewport. Reasoning and fast selections must persist and reach their exact request fields. Each successfully returned startup connection and every connect, disconnect, reconnect, provider-action error, or capability-read error must invalidate older provider capability generations; a connected active provider receives a fresh read, and late success or rejection is ignored.

- [x] **Step 4: Verify GREEN and provider persistence**

```bash
npm run build
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1
npx playwright test tests/e2e/runtime-agent-suggestions-service.spec.ts --workers=1
```

Provider round-trip, reload, stale/unavailable preservation, exact request ownership, accessibility, and zero center-terminal calls must remain green.

- [x] **Step 5: Commit**

```bash
git add tests/e2e/claude-provider-workspaces.spec.ts src/prototype.jsx src/styles.css
git commit -m "fix(agent): repair Claude model picker"
```

### Task 4: Synchronize source-of-truth documentation

**Files:**
- Modify: `docs/product-plan.md`
- Modify: `docs/technical-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/message-flow.md`
- Modify: `docs/design-system.md`
- Modify: `docs/frontend-design-benchmarks.md`
- Modify: `docs/sprint-plan.md`
- Modify: `docs/MVP_VALIDATION_NOTES.md`
- Modify: `docs/README.md`

- [x] **Step 1: Replace the obsolete static-alias contract in English**

Document the bounded CLI SDK-initialization response as current catalog authority; only returned `value` fields are selectable, historical versions are not inferred, explicit requests are revalidated, discovery sends no prompt, and identity data is discarded. Record that the native control envelope is version-coupled even though parsed `ModelInfo` semantics match the public SDK, so errors fail closed and preserve selection.

- [x] **Step 2: Record UI and verification evidence without claiming inference**

Record popup containment, labels, selected-row visibility, persistence, exact argv, bounded failure coverage, and final counts. State explicitly that no live Claude inference or billing verification ran.

- [x] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: record Claude account model discovery"
```

**Recorded evidence before integration:**

- catalog/parser, lifecycle, async-worker, request-time exact-value, and test-fixture hardening passed independent spec and code-quality review with no critical, important, or minor findings
- the Claude runtime module passes 62/62 with the authenticated live smoke ignored by default; the full Rust suite passes 169 tests with that one smoke ignored
- the Claude workspace UI passes 16/16, the runtime suggestion service passes 24/24, and the fresh serial Playwright gate passes 221/221; lifecycle coverage includes startup discovery, connect/disconnect/reconnect refresh, and stale success/rejection suppression, while geometry coverage includes default-width maximum-label wrapping and all-menu containment at 260 px and 240 px
- lint, production build, Rust formatting, Rust check, and diff checks pass; the build emits only the existing greater-than-500-KB chunk warning
- the ignored production discovery smoke passes explicitly and returns `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, and `haiku` with the sanitized current labels; it sends no user prompt or inference request
- Windows cross-target checking is blocked before GTUM crate compilation by Tauri `tauri-winres` because this macOS host lacks `llvm-rc`; source/fixture portability review found no defect, but native Windows validation remains required
- no live `claude -p` inference, billing validation, or response-quality test ran

### Task 5: Verify, review, and push the tested commit to `dev`

**Files:**
- Verify: all changed files in `/Users/kwon/conductor/workspaces/gtum/madrid`

- [x] **Step 1: Run the complete local gate**

```bash
npm run lint
npm run build
npx playwright test --workers=1
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

- [x] **Step 2: Run a bounded no-inference compatibility smoke**

Against the currently installed and authenticated Claude CLI, run only the production catalog-discovery function/command with its five-second limit. Record only sanitized model `value`/label pairs and process status. Assert at least one valid model is returned, stdin contains no user message, and stdout contains no assistant or result turn. Do not run `claude -p`, send a prompt, or retain account/identity fields. This smoke is required evidence for the version-coupled native initialize envelope but is not a live inference or billing test.

- [x] **Step 3: Obtain independent spec and code-quality review**

Review parser limits, credential isolation, zero-prompt discovery, request-time exact-value validation, async ownership, stale persistence, popup geometry, and center-terminal non-mutation. Resolve every critical and important finding.

- [ ] **Step 4: Re-fetch and prove a non-force update**

```bash
git fetch origin dev
git merge-base --is-ancestor origin/dev HEAD
git status --short
```

- [ ] **Step 5: Push without renaming the current branch**

```bash
git push origin HEAD:dev
```

Do not force-push and do not touch `/Users/kwon/projects/gtum`.

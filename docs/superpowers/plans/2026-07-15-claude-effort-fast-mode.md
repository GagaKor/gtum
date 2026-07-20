# Claude Effort and Fast Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Claude Code effort and Fast controls from the installed CLI's current, model-specific account capabilities, preserve independent Codex/Claude preferences, and reject stale or unsupported combinations before any inference child starts.

**Architecture:** Extend each model capability with an optional `executionOptions` object containing `reasoningLevels` and `supportsFastMode`. Claude catalog models always carry this object, including an empty/false object for an unsupported model; Codex models omit it and keep using the provider-level compatibility fields. Claude's prompt-free initialize result remains the sole authority for the values in that object. The renderer derives controls from the selected model, adds a UI-only `Default` choice that sends `reasoningLevel: null`, and persists reasoning/Fast preferences by provider. The Claude adapter refreshes the catalog whenever model, effort, or enabled Fast needs validation; it emits effort as separate `--effort <level>` argv values and Fast as one sanitized `--settings` JSON overlay merged with any `apiKeyHelper`. Invalid, removed, or unsupported options fail before the inference process starts. Agent execution remains isolated from the user-visible center terminal.

**Tech Stack:** Rust/Tauri, Claude Code CLI 2.1.210+, React, TypeScript, Playwright

---

### Task 1: Model the account-returned per-model execution capabilities

**Files:**
- Modify: `src-tauri/src/runtime/codex.rs`
- Modify: `src-tauri/src/runtime/claude.rs`
- Test: `src-tauri/src/runtime/claude.rs`

- [x] **Step 1: Write failing Claude catalog capability tests**

Add prompt-free initialize fixtures with varying `supportsEffort`, `supportedEffortLevels`, and `supportsFastMode` metadata. Assert only that each fixture's returned booleans and levels are preserved exactly in returned order; do not encode named aliases as permanently eligible. Include one supported-effort/Fast model, one effort-only model, and one unsupported model. Assert malformed duplicate, blank, leading-dash, control-character, unknown, excessive, or inconsistent effort metadata rejects the entire catalog.

- [x] **Step 2: Run focused tests and verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::model_catalog_preserves_model_specific_execution_options -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::model_catalog_rejects_malformed_execution_options_atomically -- --exact --nocapture
```

Expected: FAIL because the parser currently discards advanced model fields and `AgentModelCapability` cannot represent them.

- [x] **Step 3: Add the bounded shared capability contract**

Add this exact public contract:

```text
AgentModelCapability.executionOptions?: {
  reasoningLevels: AgentReasoningLevelCapability[]
  supportsFastMode: boolean
}
```

Serialize Rust `None` as an absent field. Claude entries always serialize `Some`, including `reasoningLevels: []` and `supportsFastMode: false`; Codex entries serialize `None` and continue to use provider-level compatibility fields. The nested object has no default-reasoning field: Claude never infers a default effort, and `null` means the CLI/model default. Accept at most five unique levels and only exact documented IDs (`low`, `medium`, `high`, `xhigh`, `max`); map them deterministically to labels `Low`, `Medium`, `High`, `XHigh`, and `Max`, always with `description: null`. Bound each level to 16 bytes and each generated label to 64 bytes. The raw consistency matrix is exact: `supportsEffort: true` requires a present, non-empty valid list; `supportsEffort: false` or absent permits only an absent or empty list; every contradiction rejects the catalog atomically. Missing Fast means false. Provider-level Claude fields mirror the current/default model only for compatibility and keep `defaultReasoningLevel: null`.

- [x] **Step 4: Verify GREEN and existing Codex serialization compatibility**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::model_catalog_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::codex::tests -- --nocapture
```

### Task 2: Validate and map Claude effort/Fast at request time

**Files:**
- Modify: `src-tauri/src/runtime/claude.rs`
- Test: `src-tauri/src/runtime/claude.rs`

- [x] **Step 1: Write failing argument, settings, environment, and pre-spawn rejection tests**

Require a fixture-supported `max` choice to produce exactly one separate `--effort`, `max` pair. For CLI-session, environment-key, and helper credential paths, require exactly one sanitized `--settings` object with explicit `fastMode: true` or `false`. For the helper path, require the canonical helper path and Fast value in the same JSON, correct JSON escaping, and no arbitrary user/project setting. Assert fixture-unsupported Fast/effort, removed levels, catalog drift, malformed option text, discovery failure, and the preserved `CLAUDE_CODE_DISABLE_FAST_MODE=1` policy all return before the inference child starts. Assert no `--fast`, `/fast`, or `/effort` is ever emitted and `CLAUDE_CODE_EFFORT_LEVEL` is absent from the inference child.

- [x] **Step 2: Run focused tests and verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::request_maps_supported_effort_and_fast_to_safe_cli_options -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::request_merges_fast_with_api_key_helper_in_one_settings_overlay -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::request_rejects_unsupported_advanced_options_before_spawn -- --exact --nocapture
```

Expected: FAIL because Claude request arguments currently handle only `--model`, inherit the effort environment, and probe the catalog only for an explicit model.

- [x] **Step 3: Implement request-scoped option validation**

Refresh the catalog when a model is explicit, effort is explicit, or Fast is enabled. Resolve `model: null` advanced options against the returned `default` entry and fail closed if no exact effective entry exists. Validate effort by exact membership and append separate argv values. Remove `CLAUDE_CODE_EFFORT_LEVEL` from the child environment so the validated UI request remains deterministic. Preserve `CLAUDE_CODE_DISABLE_FAST_MODE` as an owner/admin cost-control policy and explicitly reject `fastMode: true` before inference whenever its value is `1`; never rely on a silent CLI downgrade. Merge `fastMode` into the sanitized request settings object without loading arbitrary user/project settings or duplicating `--settings`. Preserve the existing bounded process, redaction, safe/bare mode, no-tools, no-MCP, no-session-persistence, and separate agent-owned execution surface.

- [x] **Step 4: Verify all Claude runtime tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests -- --nocapture
```

### Task 3: Normalize and render selected-model execution options

**Files:**
- Modify: `src/shared/api/runtimeAgentSuggestions.ts`
- Modify: `tests/e2e/runtime-agent-suggestions-service.spec.ts`
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/claude-provider-workspaces.spec.ts`
- Test: `tests/e2e/design-prototype.spec.ts`

- [x] **Step 1: Write failing service and UI tests**

Add service tests that accept the exact nested model execution-options shape and reject non-arrays, more than five levels, blank/overlong/duplicate/unknown levels, blank/overlong labels or descriptions, invalid booleans, and provider/model ownership drift. Add metadata-driven UI fixtures proving a supported model shows `Default` plus exactly the returned effort rows and its Fast control, an effort-only model omits Fast, and an unsupported model hides both. Do not bind eligibility assertions to permanent Claude aliases. Assert model switching immediately recomputes the visible/effective controls.

- [x] **Step 2: Run focused tests and verify RED**

```bash
npx playwright test tests/e2e/runtime-agent-suggestions-service.spec.ts --workers=1 --grep "model execution options"
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1 --grep "Claude effort and Fast"
```

Expected: FAIL because the TypeScript contract has no model execution options and the renderer reads only provider-level fields.

- [x] **Step 3: Normalize the runtime contract and derive the selected-model view**

Validate the optional nested execution-options object exactly. When it exists, it overrides provider-level reasoning/Fast fields even when empty/false; only an absent object falls back to the provider-level Codex contract. Keep model lists and compact icon triggers unchanged. For model-owned Claude options, show a UI-only `Default` reasoning row without inventing a CLI effort value; selecting it produces `null`. Preserve Codex's existing provider-level configured-default behavior.

- [x] **Step 4: Verify focused normalization, UI, accessibility, and geometry coverage**

```bash
npx playwright test tests/e2e/runtime-agent-suggestions-service.spec.ts --workers=1
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1 --grep "Claude effort and Fast"
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1 --grep "compact"
```

Require accessible listbox names, one selected row, Escape focus restoration, and 240/260 px containment.

### Task 4: Persist provider-owned preferences and freeze request ownership

**Files:**
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/claude-provider-workspaces.spec.ts`
- Modify: `tests/e2e/project-agent-context.spec.ts`

- [x] **Step 1: Write failing persistence and request-snapshot tests**

Assert Codex and Claude reasoning/Fast preferences remain independent across provider switching, projects, Agent sessions, and reload. Assert selecting the UI `Default` choice deletes that provider's reasoning entry. Assert switching to an unsupported model sends `reasoningLevel: null`/`fastMode: false` without erasing saved provider preferences, and switching back restores them. Start a request, then switch provider/project/session before the first await resolves; assert the runtime receives the original provider, model, attachments, reasoning, and Fast values.

- [x] **Step 2: Run focused tests and verify RED**

```bash
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1 --grep "provider-owned effort and Fast"
npx playwright test tests/e2e/project-agent-context.spec.ts --workers=1 --grep "request option snapshot"
```

Expected: FAIL because session reasoning/Fast values are scalar, reload discards them, and the async request callback rereads active state.

- [x] **Step 3: Implement provider-scoped state and one immutable send snapshot**

Replace scalar session values with sanitized `selectedReasoningLevels` and `fastModes` maps keyed only by `codex`/`claude`, include them in the existing session-directory persistence contract, and safely treat absent legacy values as defaults. Selecting `Default` must delete the current provider's `selectedReasoningLevels` entry. Before updating session state or crossing any await, construct one immutable `{ provider, model, attachments, reasoningLevel, fastMode }` snapshot and pass it through the complete runtime request path. Unsupported selected-model options become `null`/`false` in the snapshot without erasing saved preferences.

- [x] **Step 4: Verify persistence, ownership, stale-response, and terminal-isolation coverage**

```bash
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1
npx playwright test tests/e2e/project-agent-context.spec.ts --workers=1
```

Require independent reload state, exact request ownership, stale capability suppression, empty `__terminalCalls`, and unchanged center-terminal DOM.

### Task 5: Synchronize the durable contracts

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
- Modify: `docs/DOCS_READING_ORDER.md`

- [x] **Step 1: Update source-of-truth documentation in English**

Document account-returned model capability authority, model-specific control visibility, UI-default/null semantics, provider-owned persistence, request-time fresh validation, exact `--effort` argv mapping, single sanitized Fast settings overlay, provider/org/model gating, and center-terminal isolation. Do not infer entitlement or advertise unsupported historical models.

Route this active implementation contract from both `docs/README.md` and `docs/DOCS_READING_ORDER.md`.

- [x] **Step 2: Record verification evidence and remaining limits**

Record fixture and prompt-free catalog coverage separately from live inference. State that Fast can require organization enablement and usage credits and that no paid inference or billing validation was run.

### Task 6: Review, verify, and integrate into `dev`

**Files:**
- Verify: all changed files in `/Users/kwon/conductor/workspaces/gtum/madrid`

- [x] **Step 1: Obtain independent spec-compliance and code-quality reviews**

Review capability ownership, parser limits, exact argv/settings serialization, credential redaction, catalog-drift rejection, provider/session/project persistence, request snapshots, accessibility, narrow geometry, and center-terminal non-mutation. Resolve every critical and important finding, then re-review.

- [x] **Step 2: Commit the reviewed tree and identify the exact candidate SHA**

Stage only intended files, create the implementation commit, require `git status --short` to be empty, and durably pin it with `git update-ref refs/gtum/tested/claude-effort-fast "$(git rev-parse HEAD)"`. Resolve `TESTED_SHA` only from that private local ref in later steps. If any verification command later modifies the tree, commit the correction, repoint the private ref, and restart the complete gate.

- [x] **Step 3: Run the complete fresh local gate on the clean candidate**

```bash
TESTED_SHA=$(git rev-parse refs/gtum/tested/claude-effort-fast)
npm run lint
npm run build
npx playwright test --workers=1
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
git show --check --format= "$TESTED_SHA"
test -z "$(git status --short)"
test "$(git rev-parse HEAD)" = "$TESTED_SHA"
```

Completion evidence for `0b472042a2930929bef8c541820c43bd959f6c19`: lint and production build passed, serial Playwright passed `233/233`, Rust formatting and check passed, and the full Rust suite passed `179` with `1` ignored. `git show --check`, the clean-tree assertion, and the exact `HEAD`/tested-ref assertion also passed.

- [x] **Step 4: Run only the bounded, no-inference catalog compatibility smoke**

Run the production catalog-discovery smoke exactly:

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::live_catalog_compatibility_smoke_is_prompt_free -- --ignored --exact --nocapture
```

Expected: one authenticated initialize-only catalog succeeds, each returned model has bounded sanitized execution options, and no user/assistant/result turn is emitted. Do not use `claude -p`, send a user prompt, test response quality, or incur paid inference. If the local CLI login is unavailable, record this smoke as blocked rather than weakening it.

The exact clean-candidate command passed `1/1`. It sent only the bounded initialization request; no user prompt, assistant/result turn, paid inference, billing validation, or response-quality check ran.

- [x] **Step 5: Fetch and push only the tested SHA without renaming the branch**

After all tests finish, resolve `TESTED_SHA=$(git rev-parse refs/gtum/tested/claude-effort-fast)`, require the tree to be clean and `HEAD` to equal that SHA, then run `git fetch origin dev` and repeat both assertions. Prove `origin/dev` is an ancestor with `git merge-base --is-ancestor origin/dev "$TESTED_SHA"`. Push the exact commit with `git push origin "$TESTED_SHA":refs/heads/dev` without force, verify the remote SHA, then delete only the private local ref with `git update-ref -d refs/gtum/tested/claude-effort-fast`. If `origin/dev` moved incompatibly or reconciliation would change the candidate SHA, stop, reconcile, and repeat review plus the complete fresh gate on a newly pinned commit.

The ancestor and clean-candidate assertions passed. Exact SHA `0b472042a2930929bef8c541820c43bd959f6c19` was pushed non-forced to `origin/dev`, the remote SHA was verified, the working branch was not renamed, and the private tested ref was deleted.

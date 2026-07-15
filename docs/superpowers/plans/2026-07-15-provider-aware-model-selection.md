# Provider-Aware Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent composer show and preserve provider-specific model choices, and pass a validated Claude model alias to the isolated Claude CLI request.

**Architecture:** Keep model capability ownership in the runtime. Codex continues to use its CLI catalog; Claude advertises the bounded aliases `default`, `best`, `sonnet`, `opus`, and `haiku`, while the CLI and organization policy remain authoritative for entitlement enforcement. The frontend validates capability ownership, persists model choices by provider inside each project/session directory record, drops stale selections to the runtime default, and snapshots the validated provider/model pair when sending a request.

**Tech Stack:** Rust/Tauri, React, TypeScript, Playwright, Claude Code CLI 2.1.209+

---

### Task 1: Lock the Claude model capability and argv contract

**Files:**
- Modify: `src-tauri/src/runtime/claude.rs:33-35`
- Modify: `src-tauri/src/runtime/claude.rs:1166-1205`
- Modify: `src-tauri/src/runtime/claude.rs:1368-1408`
- Modify: `src-tauri/src/runtime/claude.rs:1455-1483`
- Test: `src-tauri/src/runtime/claude.rs:1695-1753`
- Test: `src-tauri/src/runtime/claude.rs:2104-2185`

- [x] **Step 1: Write failing capability tests**

Replace the default-only assertion with an installed-CLI capability assertion whose model IDs and provider ownership are exactly:

```rust
assert_eq!(
    capabilities.available_models.iter().map(|model| model.model_id.as_str()).collect::<Vec<_>>(),
    vec!["default", "best", "sonnet", "opus", "haiku"],
);
assert!(capabilities.available_models.iter().all(|model| model.provider_id == AgentProvider::Claude));
assert!(capabilities.supports_model_selection);
```

Also assert that an unavailable CLI keeps the same descriptive aliases but reports selection support as unavailable.

- [x] **Step 2: Write failing argv and rejection tests**

Require `model: Some("opus")` to add exactly one `--model`, `opus` pair without changing the existing safe-mode/no-tools arguments. Require `None` to preserve the current exact argv. Require blank, Codex, version-specific, leading-dash, and unknown model values to fail before the fake child is spawned.

- [x] **Step 3: Run focused Rust tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::capabilities_offer_bounded_claude_aliases -- --exact
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::selected_model_is_a_single_validated_cli_argument -- --exact
```

Expected: both fail because Claude currently exposes only `default` and ignores `request.model`.

- [x] **Step 4: Implement the bounded model contract**

Add one static capability table:

```rust
const CLAUDE_MODEL_ALIASES: [(&str, &str); 5] = [
    ("default", "Claude default"),
    ("best", "Best available"),
    ("sonnet", "Sonnet"),
    ("opus", "Opus"),
    ("haiku", "Haiku"),
];
```

Build `AgentModelCapability` rows with `provider_id: AgentProvider::Claude`. Normalize only exact trimmed aliases from this table. Add `--model` and the selected alias as two `OsString` entries only after validation. Do not add exact-version, 1M, effort, fast-mode, attachment, tool, resume, or fallback controls.

- [x] **Step 5: Run focused Rust tests and verify GREEN**

Run the two focused commands plus all Claude runtime tests. Expected: selected aliases pass, invalid values never spawn the child, and existing API/helper/CLI-session argv assertions remain green.

Completed evidence: the Claude runtime module passes 44/44. Fake-child coverage verifies the exact separate `--model`, `opus` pair, no flag for implicit default, and rejection before spawn for invalid values.

### Task 2: Validate provider capability ownership at the frontend boundary

**Files:**
- Modify: `src/shared/api/runtimeAgentSuggestions.ts:52-66`
- Modify: `src/shared/api/runtimeAgentSuggestions.ts:328-334`
- Test: `tests/e2e/runtime-agent-suggestions-service.spec.ts:93-228`

- [x] **Step 1: Write failing service tests**

Add Claude capability fixtures and require the service to reject:

```ts
await expect(service.readProviderCapabilities('claude')).rejects.toThrow(
  'Provider capability owner mismatch',
)
```

Cover a response whose top-level provider is Codex, a Claude response containing a Codex-owned model, blank model IDs, and duplicate model IDs.

- [x] **Step 2: Run the focused Playwright service test and verify RED**

Run:

```bash
npx playwright test tests/e2e/runtime-agent-suggestions-service.spec.ts --workers=1
```

Expected: invalid capability payloads are currently returned unchanged.

- [x] **Step 3: Implement runtime capability validation**

Normalize the capability response before returning it. Require the response provider and every `currentModel`/`availableModels[].providerId` to equal the requested provider, require nonblank IDs and labels, and reject duplicate IDs. Preserve valid reasoning, fast-mode, and attachment fields unchanged.

- [x] **Step 4: Re-run the focused service tests and verify GREEN**

Expected: valid Codex and Claude capability responses pass; cross-provider or malformed model ownership fails closed.

Completed evidence: `runtime-agent-suggestions-service.spec.ts` passes 24/24 with provider-owner, malformed metadata, and duplicate-ID rejection coverage.

### Task 3: Preserve provider-specific selections and drop stale models

**Files:**
- Modify: `src/prototype.jsx:2613-2708`
- Modify: `src/prototype.jsx:3411-3602`
- Modify: `src/prototype.jsx:4113-4127`
- Modify: `src/prototype.jsx:4565-4586`
- Modify: `src/prototype.jsx:4839-4935`
- Test: `tests/e2e/claude-provider-workspaces.spec.ts:79-183`
- Test: `tests/e2e/claude-provider-workspaces.spec.ts:432-548`

- [x] **Step 1: Write a failing provider round-trip test**

Make the harness return distinct Codex and Claude capabilities. Select a Codex model, switch to Claude, select `opus`, switch back and forth, and assert each provider restores only its own selection. Assert the request payloads pair `provider: "claude"` with `model: "opus"` and Codex with its own model.

- [x] **Step 2: Write failing persistence and stale-selection tests**

Require `selectedModels.codex` and `selectedModels.claude` in `gtum.agent-session-directory.v1`, reload the page, and verify the correct model returns for each provider. Then seed a removed Claude model ID, return a catalog without it, and require the UI to show the current/default model, remove the stale stored value, and send `model: null`.

- [x] **Step 3: Run the focused UI test and verify RED**

Run:

```bash
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1
```

Expected: Claude has no selectable models, selected model state is not serialized, and stale values are sent unchanged.

- [x] **Step 4: Implement provider-keyed persistence and effective-model derivation**

Read and write only trimmed non-empty `codex` and `claude` entries in each session's `selectedModels`. Derive the send-time model only when it remains present in the active provider capability list. When a loaded capability no longer contains a stored selection, remove that provider key without touching the other provider. Keep `null` as the unselected runtime-default request value.

- [x] **Step 5: Make the picker state truthful and accessible**

Use the effective selected/current model when setting the active option. Add a provider-specific accessible trigger name, `aria-haspopup="listbox"`, one truthful `aria-selected`, and close the model menu when the provider changes. Do not create or touch a center terminal surface.

- [x] **Step 6: Re-run the focused UI tests and verify GREEN**

Expected: provider round trips, reload restore, stale cleanup, request payload ownership, and zero center-terminal calls all pass.

Completed evidence: the provider-aware subset in `claude-provider-workspaces.spec.ts` passes 5/5, covering reload persistence, stale-versus-unavailable behavior, provider/model request snapshots, accessible picker state, and zero center-terminal calls. The touched frontend slice passes lint and production build.

### Task 4: Synchronize the runtime contract and evidence

**Files:**
- Modify: `docs/product-plan.md:21-34`
- Modify: `docs/technical-design.md:94-109`
- Modify: `docs/technical-design.md:878-976`
- Modify: `docs/architecture.md:67-112`
- Modify: `docs/message-flow.md:77-129`
- Modify: `docs/sprint-plan.md:75-106`
- Modify: `docs/MVP_VALIDATION_NOTES.md:80-91`
- Modify: `docs/README.md`

- [x] **Step 1: Document the new provider/model contract in English**

State that Claude exposes a bounded alias capability list, selected models belong to `project + Agent session + provider`, invalid or stale IDs become the runtime default, and only validated Claude aliases become `--model` child arguments. State that organization policy and account entitlement remain authoritative and that direct Fable, exact-version, 1M, effort, and fast controls remain deferred until structured discovery exists.

- [x] **Step 2: Record verification evidence without claiming live inference**

Record focused/full Rust and Playwright counts, lint/build results, fake-child exact argv evidence, and that no paid Claude inference was used for this slice.

Recorded evidence: Rust Claude module 44/44, suggestion service Playwright 24/24, provider UI Playwright 5/5, complete serial Playwright 210/210, full Rust 149/149, lint/build/fmt/check, and fake-child argv coverage. No live-inference claim is made.

### Task 5: Verify and integrate all Madrid work into `dev`

**Files:**
- Verify: all changed and untracked repository files in `/Users/kwon/conductor/workspaces/gtum/madrid`

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

- [x] **Step 2: Obtain independent code review**

Review provider/model ownership, stale async responses, selected-model persistence, exact Claude child argv, auth isolation, and center-terminal non-mutation. Resolve all critical and important findings before integration.

- [x] **Step 3: Re-fetch and prove a fast-forward dev update**

Fetch `origin`, verify `origin/dev` is still an ancestor of the current branch plus working result, and do not touch the separate dirty `/Users/kwon/projects/gtum` worktree.

Verified on 2026-07-15: `origin/dev` at `aecd288f989488478dc6e0c593e5718b6ce83c0e` is an ancestor of the tested Madrid commit, with `0` remote-only and `17` local-only commits. The separate dirty worktree was not touched.

- [x] **Step 4: Commit all intended Madrid work and push it to dev**

Stage the complete Madrid repository delta after excluding generated caches and unrelated machine-local files. Commit with a summary that covers the integrated runtime/UI slices, then push the verified current commit to `origin/dev` without renaming the current branch or force-pushing.

Completed on 2026-07-15: the tested Madrid implementation and verification evidence through `8de8518` were pushed without force from the unchanged `audit-claude-codex-link` branch to `origin/dev`. The separate dirty worktree was not touched; this final closure update changes documentation only.

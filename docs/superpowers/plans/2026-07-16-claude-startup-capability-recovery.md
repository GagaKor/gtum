# Claude Startup Capability Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Claude model, reasoning, and Fast controls automatically on desktop startup when a previously connected CLI session is currently valid, while preserving explicit disconnect and stale-response safety.

**Architecture:** Startup auth discovery remains the authority before the renderer probes provider capabilities. The auth manager will retry a stored real Claude `error` snapshot, but never an explicitly `disconnected` snapshot; a successful current validation promotes it back to `connected`. The renderer will wait for the active provider's connected startup snapshot before starting capability discovery, preventing the current pre-auth probe from being invalidated without replacement.

**Tech Stack:** Tauri, Rust, React, JavaScript, Playwright

---

### Task 1: Prove the startup lifecycle gap

**Files:**
- Verify: `src-tauri/src/runtime/auth/mod.rs`
- Verify: `src/prototype.jsx`
- Verify: `tests/e2e/claude-provider-workspaces.spec.ts`

- [x] **Step 1: Compare persisted state with current CLI state**

Confirm the app store contains a redacted Claude `error` snapshot while the installed CLI reports only the allowlisted facts `loggedIn: true`, `authMethod: claude.ai`, and `apiProvider: firstParty`.

- [x] **Step 2: Trace startup auth and capability generations**

Confirm `list_connections()` refreshes only `connected` snapshots, the renderer starts one capability read before auth discovery resolves, and a later non-connected startup snapshot invalidates that read without scheduling another.

- [x] **Step 3: Record the working comparison path and its current successor**

Historical baseline: before Task 3 changed startup ordering, the then-current `refreshes after connected startup discovery` regression passed and showed that a second, post-auth capability read could repopulate the composer. Task 3 replaced that test, so the old grep is evidence history rather than a current command.

Current reproducible command:

```bash
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1 --grep "waits for recovered startup auth before loading Claude execution information"
```

Expected: PASS, proving the current auth-first contract performs no pre-auth capability read and one connected post-auth read that restores Claude model, reasoning, and Fast information.

### Task 2: Recover a stored Claude error through fresh startup validation

**Files:**
- Modify: `src-tauri/src/runtime/auth/mod.rs:148-160`
- Modify: `src-tauri/src/runtime/auth/mod.rs:469-575`
- Modify: `src-tauri/src/lib.rs:271-320`
- Test: `src-tauri/src/runtime/auth/mod.rs`
- Test: `src-tauri/src/lib.rs`

- [x] **Step 1: Write the failing Rust regression test**

Create and persist a connected CLI-session snapshot, apply one current validation failure so it becomes `error`, reload a new manager from that store, and assert startup refresh can obtain a current error lease and promote successful CLI-session validation back to `connected`. In a second test, capture an error-refresh lease and prove it cannot overwrite a later explicit disconnect or reconnect. Add regressions proving a non-real legacy Claude error normalizes to disconnected/untrusted state and that identity- or secret-bearing Claude validation text is replaced before both runtime publication and persistence while Codex error behavior stays unchanged.

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::auth::tests::startup_refresh_recovers_persisted_claude_error -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::auth::tests::stale_startup_error_refresh_cannot_overwrite_disconnect_or_reconnect -- --exact --nocapture
```

Expected: FAIL because the current refresh lease is available only for `Connected` snapshots.

- [x] **Step 3: Implement the minimal recovery rule**

Allow startup refresh to lease either a real connected provider or a real Claude error snapshot. Permit a successful current Claude error lease to set `status: connected`, restore the validated credential source/scopes, set `connectedAt`, clear the safe error, and mark runtime validation current. Keep explicit disconnect ineligible, normalize non-real legacy Claude errors to disconnected/untrusted state, and replace every Claude validation failure with the single actionable generic redacted message before publication or persistence. Preserve revision checks and existing Codex error behavior.

- [x] **Step 4: Verify GREEN and auth regressions**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::auth::tests::startup_refresh_recovers_persisted_claude_error -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::auth::tests::stale_startup_error_refresh_cannot_overwrite_disconnect_or_reconnect -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::auth::tests -- --nocapture
```

Expected: PASS for all 21 auth tests, including startup recovery, stale-lease rejection, non-real legacy-error normalization, immediate Claude validation-error redaction, and unchanged Codex behavior.

### Task 3: Wait for startup auth authority before reading capabilities

**Files:**
- Modify: `src/prototype.jsx:4370-4410`
- Modify: `src/prototype.jsx:4860-4935`
- Test: `tests/e2e/claude-provider-workspaces.spec.ts:668-860`

- [x] **Step 1: Write the failing Playwright regression test**

Restore a Claude-owned Agent session, defer the initial connection list, and provide one catalog with model-specific execution options. Assert no capability read occurs before auth discovery resolves; then resolve a connected snapshot and assert exactly one read exposes the Claude model, `Default` reasoning, and disabled Fast controls without provider switching or center-terminal calls.

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1 --grep "waits for recovered startup auth before loading Claude execution information"
```

Expected: FAIL because the current mount effect starts one capability read before the deferred connection list resolves.

- [x] **Step 3: Gate capability discovery on the active connection**

Derive the active provider connection from `providers`. Run the capability effect only when that connection is `connected`, and include its state in the effect dependencies. Continue to use the existing provider/capability generations so connect, disconnect, provider switch, and stale results keep their current ownership guarantees.

Update the existing lifecycle assertions to the new authoritative ordering: a deferred startup list or restored disconnected provider performs zero capability reads; the first connected startup or Connect result performs read one rather than read two. Keep all stale-success/rejection assertions and generation ownership checks intact.

- [x] **Step 4: Verify GREEN and lifecycle regressions**

Run:

```bash
npx playwright test tests/e2e/claude-provider-workspaces.spec.ts --workers=1 --grep "startup|connect|disconnect|execution information"
```

Expected: PASS with zero center-terminal calls.

### Task 4: Synchronize the startup contract and verification record

**Files:**
- Modify: `docs/technical-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/message-flow.md`
- Modify: `docs/sprint-plan.md`
- Modify: `docs/MVP_VALIDATION_NOTES.md`
- Modify: `docs/README.md`
- Modify: `docs/DOCS_READING_ORDER.md`

- [x] **Step 1: Document the recovery boundary**

Record that startup retries a stored Claude error only through fresh current validation, never reconnects an explicit disconnect, waits for auth authority before catalog discovery, preserves credential redaction, and keeps the center terminal untouched.

- [x] **Step 2: Record focused evidence without overstating live inference**

Keep prompt-free catalog discovery separate from user-prompt inference and billing validation.

### Task 5: Review, verify, and integrate into `dev`

**Files:**
- Verify: all changed files

- [x] **Step 1: Obtain independent spec and quality review**

Before requesting review, stage and commit the complete integration inventory:

```bash
git add src-tauri/src/runtime/auth/mod.rs src-tauri/src/lib.rs src/prototype.jsx \
  tests/e2e/claude-provider-workspaces.spec.ts \
  docs/technical-design.md docs/architecture.md docs/message-flow.md \
  docs/sprint-plan.md docs/MVP_VALIDATION_NOTES.md docs/README.md \
  docs/DOCS_READING_ORDER.md \
  docs/superpowers/plans/2026-07-16-claude-startup-capability-recovery.md
git commit -m "fix(claude): recover startup execution information"
test -z "$(git status --short)"
```

Review error-only recovery, explicit-disconnect preservation, stale revision protection, startup read ordering, credential redaction, and center-terminal isolation.

- [x] **Step 2: Pin the already-committed clean reviewed candidate**

```bash
test -z "$(git status --short)"
git update-ref refs/gtum/tested/claude-startup-recovery "$(git rev-parse HEAD)"
test "$(git rev-parse HEAD)" = "$(git rev-parse refs/gtum/tested/claude-startup-recovery)"
```

- [x] **Step 3: Run the complete fresh gate**

```bash
TESTED_SHA=$(git rev-parse refs/gtum/tested/claude-startup-recovery)
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

- [x] **Step 4: Run the bounded prompt-free Claude compatibility smoke**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests::live_catalog_compatibility_smoke_is_prompt_free -- --ignored --exact --nocapture
```

Do not send a user prompt or run paid inference.

- [x] **Step 5: Push the exact verified SHA to `dev`**

```bash
TESTED_SHA=$(git rev-parse refs/gtum/tested/claude-startup-recovery)
test -z "$(git status --short)"
test "$(git rev-parse HEAD)" = "$TESTED_SHA"
git fetch origin dev
test -z "$(git status --short)"
test "$(git rev-parse HEAD)" = "$TESTED_SHA"
git merge-base --is-ancestor origin/dev "$TESTED_SHA"
git push origin "$TESTED_SHA":refs/heads/dev
REMOTE_SHA=$(git ls-remote origin refs/heads/dev | awk '{print $1}')
test "$REMOTE_SHA" = "$TESTED_SHA"
git update-ref -d refs/gtum/tested/claude-startup-recovery
```

Do not force-push or rename the working branch. If `origin/dev` moved incompatibly or any correction changes the candidate SHA, repin and restart the complete gate.

Result: exact tested commit `4ce5b172f2a902c0b9e0ec25ea735eb97131e147` was pushed non-forced to `dev` after the remote base, ancestry, clean tree, and tested ref were revalidated. The remote branch SHA was then verified to match.

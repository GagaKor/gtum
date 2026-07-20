# Multi-Account Agent Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans task-by-task. Every implementation slice starts with a failing test and ends at an independently green checkpoint.

**Goal:** Let users register multiple supported Codex and Claude account profiles, select the exact profile per project-owned Agent session, and run concurrent work without credential, capability, preference, or response ownership crossing accounts.

**Architecture:** Rust owns a versioned, bounded profile registry and exact provider execution contexts. Existing ambient sessions become deterministic non-removable default profiles. Additional supported profiles use isolated CLI configuration roots. Ownership expands from projectPath + agentSessionId + providerId to projectPath + agentSessionId + providerId + accountId. The renderer has no global active account; every Agent session persists one account selection per provider and account-scoped model, reasoning, and Fast preferences. Login remains an external user-terminal action and never touches the center terminal.

**Platform contract:** Codex profiles use explicit CODEX_HOME roots after the installed CLI proves it accepts and honors cli_auth_credentials_store = "file" in that root; no version string alone grants support. Claude CLI-session profiles use CLAUDE_CONFIG_DIR only on Linux and Windows. Official authentication documentation places macOS Claude credentials in Keychain and only relocates the credential file with CLAUDE_CONFIG_DIR on Linux/Windows, so additional macOS Claude.ai CLI-session profiles remain explicitly unsupported. Additional helper/API profiles are excluded from this slice; only the existing ambient Claude profile may retain the current approved helper/environment precedence.

**Product boundary:** This is manual profile selection, not quota rotation, automatic failover, load balancing, usage-limit evasion, billing visibility, raw-key capture, provider logout, or destructive credential deletion. Aliases are user-authored and may contain user-supplied PII; GTUM never derives identity from provider output and never stores tokens, raw helper output, email, organization, subscription, or raw child diagnostics.

**Workspace authorization:** This Conductor workspace is already the isolated worktree. The user previously authorized landing completed work on dev. Do not create a nested worktree, rename the current branch, force-push, or discard unrelated changes. Commit/push remains conditional on complete verification and a clean task-owned diff.

**Tech Stack:** Tauri 2, Rust, React, TypeScript/JavaScript, CSS, Playwright

## Execution Status

- Tasks 1–11 and the local Task 12 documentation, regression, and independent-review gates are complete on the current candidate.
- Remote `dev` integration and its Ubuntu/Windows/macOS GitHub Actions evidence remain pending until this candidate is committed and pushed.
- Manual macOS VoiceOver and 125–200% OS-scale observation plus native Windows installed-app sign-off remain broader release QA; automated narrow-layout, ownership, isolation, and platform test coverage is complete.

## Required Preflight

- Read AGENTS.md, docs/README.md, and docs/DOCS_READING_ORDER.md, then the routed product, technical, architecture, message-flow, design, sprint, validation, and team-topology sections.
- Review the current sprint, any active WORKLOG, MVP validation notes, and task history before editing. No active WORKLOG exists at plan creation.
- Confirm planner + orchestrator + designer + frontend + backend + QA + tester ownership and the handoffs below.
- Confirm git status and origin/dev ancestry. The current Conductor branch is a user-established exception to the feature/* naming default and must not be renamed.
- Confirm the baseline service tests execute 39/39 and auth tests execute 25/25 before new RED tests.
- Every Rust prefix command must first prove a nonzero test list, for example:

    test "$(cargo test --manifest-path src-tauri/Cargo.toml -- --list | grep -c 'multi_account_registry_')" -gt 0

- Automated fake-CLI environment/filesystem tests must run in macOS, Linux, and Windows CI before completion. The current workflow does not yet execute the Rust test suite on all three platforms, so adding or recording that CI coverage remains an open gate. Native smoke records platform prerequisites and supplements rather than replaces deterministic tests.

## Team Ownership And Handoffs

Implementation is sequential because several slices touch shared boundaries.

- Planner/designer: scope, compact picker, Settings hierarchy, platform/error copy, migration UX.
- Orchestrator: plan tracking, file ownership, handoffs, integration, exact-SHA gate.
- Backend owner: src-tauri/src/runtime/auth/mod.rs and provider context helpers.
- IPC owner: src-tauri/src/lib.rs plus shared TypeScript runtime services.
- Frontend owner: src/prototype.jsx and src/styles.css.
- QA/tester: service contracts, Rust race/migration coverage, E2E ownership, aging, native smoke.
- Documentation owner: only source-of-truth files named in Task 12.

Each implementer hands off: files changed, exact RED command/result, exact GREEN command/result, invariants added, and remaining risks. A specification reviewer checks the slice before a code-quality reviewer. Any correction returns to the implementer and reruns the slice gate.

## Fixed Domain Decisions

- Reserved IDs: codex-default and claude-default.
- Generated ID grammar: `<provider>-profile-<lowercase-base36>` such as `codex-profile-1`; the persisted global counter is positive and the full ID is at most 64 ASCII bytes.
- IDs are immutable and never reused. Each profile also has a persisted monotonically allocated incarnation; leases carry accountId + incarnation + credentialRevision so forget/restart/recreation cannot create an ABA match.
- Alias: trimmed UTF-8, 1–64 bytes, no control characters; never provider-derived.
- Capacity: 16 visible or tombstoned profiles per provider.
- A profile is a tagged union: ambient, codex_home, or claude_config_dir. Additional helper/API variants are invalid in this slice.
- Exactly one default profile exists per provider. Reserved ambient profiles are never forgettable even after another profile becomes default; the current default profile is also not forgettable. Setting a new default changes metadata only.
- Credential revision changes on connection/context lifecycle. Alias/default metadata has a separate revision and cannot invalidate or authorize provider work.
- Forget hides a non-default profile and retains a bounded tombstone and its credential root. It never deletes/logout credentials. Tombstones count toward the limit and cannot be silently reused; restore/destructive cleanup is future work.
- Setup guidance is generated on demand as structured program + environment + arguments. The Rust runtime applies fixed zsh/bash or PowerShell quoting without interpolating the alias and returns the rendered command; the renderer only normalizes and displays it. The rendered command is transient, copy-only, never persisted/logged, and warns that Forget does not log out or delete credentials.
- Owned profile directories are 0700 and generated config files 0600 on POSIX. Windows requires an owner-only app-data ACL and rejects symlink/junction/reparse escapes. Creation holds the registry lock, uses same-parent temporary paths, fsync/rename where available, and reopens/revalidates the canonical directory immediately before every child launch. Unsupported permission guarantees fail closed.
- Jobs remain durably owned by project + Agent session. The originating provider/account snapshot is kept in the conversation/permission turn; the job store does not become an auth ledger.
- On every desktop restart, persisted Connected profiles advance credential revision and require fresh validation. Reserved ambient profiles may recover through serialized startup validation; generated profiles remain selected as `Needs verification` and cannot load capabilities, Send, approve, or launch provider children until their exact Check succeeds.

---

### Task 1: Versioned registry schema and account-specific revisions

**Owner:** Backend

**Files:**
- Modify: src-tauri/src/runtime/auth/mod.rs

- [x] Add failing tests for two same-provider profiles, reserved/default invariants, generated-ID grammar, immutable ID/incarnation allocation, ABA prevention, alias validation, tagged profile kinds, capacity, separate metadata/credential revisions, concurrent mutations, restart leases, and provider/account mismatch.
- [x] Run the exact named filter and confirm at least one test executes and fails:

    cargo test --manifest-path src-tauri/Cargo.toml multi_account_registry_ -- --nocapture

- [x] Implement the v2 profile/connection/tombstone schema and account-specific lease types without changing provider invocation yet.
- [x] Run the named filter, cargo check, all auth tests, and git diff --check.

### Task 2: Atomic legacy auth migration

**Owner:** Backend

**Files:**
- Modify: src-tauri/src/runtime/auth/mod.rs

- [x] Add failing migration tests for canonical v1 Codex/Claude records, explicit disconnect, eligible error/connected revalidation, identity/callback scrubbing, pending-login removal/account conversion, malformed extras, idempotence, and atomic persistence rollback.
- [x] Verify RED:

    cargo test --manifest-path src-tauri/Cargo.toml multi_account_migration_ -- --nocapture

- [x] Implement v1-to-v2 migration before any list response. Never copy credentials. Mark runtime validation stale and preserve existing disconnect semantics.
- [x] Verify GREEN with the filter, all auth tests, cargo check, and diff check.

### Task 3: Profile-root provisioning and metadata commands

**Owner:** Backend

**Files:**
- Modify: src-tauri/src/runtime/auth/mod.rs
- Modify: src-tauri/src/lib.rs

- [x] Add failing tests for atomic locked root/config creation, exact POSIX modes, Windows owner-only ACL/reparse rejection, canonical owned-root validation, duplicate/symlink/path-swap escape rejection, tombstone retention, non-removable ambient defaults, rename/default/forget targeting, structured setup guidance, shell quoting for spaces/metacharacters, alias non-interpolation, and no path/command persistence.
- [x] Add conflicting-Codex-version/config capability-probe tests. The probe must fail closed rather than assume a minimum version.
- [x] Verify RED:

    cargo test --manifest-path src-tauri/Cargo.toml multi_account_profile_lifecycle_ -- --nocapture

- [x] Implement create, rename, set-default, forget, and on-demand setup-guidance commands. Enforce the exact platform permission/reparse contract and fail unsupported when it cannot be proven. Codex creates only minimal config; it never creates/reads/copies auth.json. Claude CLI root creation is Linux/Windows only and returns explicit macOS unsupported state.
- [x] Verify GREEN with the filter, cargo check, auth tests, and diff check.

### Task 4: Codex account execution context

**Owner:** Backend provider adapter

**Files:**
- Modify: src-tauri/src/runtime/codex.rs
- Modify: src-tauri/src/runtime/auth/mod.rs

- [x] Add failing account-context tests covering status, diagnostics, config/model discovery, capabilities, request execution, concurrent A/B children, unique temp files, and no process-global environment mutation.
- [x] Add conflicting ambient credential tests. Isolated children must remove CODEX_ACCESS_TOKEN, CODEX_API_KEY, OPENAI_API_KEY, CODEX_SQLITE_HOME, and any higher-precedence account override before setting exact CODEX_HOME.
- [x] Add a test proving validation uses codex login status and never reads/parses auth.json.
- [x] Verify RED:

    cargo test --manifest-path src-tauri/Cargo.toml codex_account_context_ -- --nocapture

- [x] Thread one immutable Codex context through validation/catalog/request and direct child configuration. Ambient default preserves the existing user-owned path but still uses the frozen lease.
- [x] Verify GREEN with the filter, all Codex tests, cargo check, and diff check.

### Task 5: Claude account execution context and platform gate

**Owner:** Backend provider adapter

**Files:**
- Modify: src-tauri/src/runtime/claude.rs
- Modify: src-tauri/src/runtime/auth/mod.rs

- [x] Add failing tests for isolated Linux/Windows config roots, concurrent A/B children, canonical revalidation, symlink/root changes, and no global environment mutation. Reject additional helper/API profile variants in this slice.
- [x] Add conflicting ambient API/OAuth/helper/cloud tests. An isolated CLI profile removes ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, helper/base-url/cloud selectors, and every existing competing source before setting exact CLAUDE_CONFIG_DIR.
- [x] Prove additional macOS CLI-session profiles fail before child launch with actionable guidance and no fallback.
- [x] Verify RED:

    cargo test --manifest-path src-tauri/Cargo.toml claude_account_context_ -- --nocapture

- [x] Construct ClaudeInvocationContext from the selected stored profile, retaining current canonical executable/path, safe/bare mode, bounded I/O, prompt-free catalog, redaction, and no-live-inference rules.
- [x] Freeze the ambient credential selection and config root for the lifetime of one context. Any transient secret stays in memory only, is redacted from Debug/errors, and is never persisted; owned profiles always use CLI-session mode.
- [x] Verify GREEN with the filter, all Claude tests, cargo check, and diff check.

### Task 6: Account-owned IPC and TypeScript service contracts

**Owner:** IPC/shared runtime

**Files:**
- Modify: src-tauri/src/runtime/auth/mod.rs
- Modify: src-tauri/src/lib.rs
- Modify: src-tauri/src/runtime/codex.rs (context-only high-level discovery wrappers only)
- Modify: src-tauri/src/runtime/claude.rs (context-only high-level discovery wrappers only)
- Modify: src/shared/api/runtimeAgentAuth.ts
- Modify: src/shared/api/runtimeAgentSuggestions.ts
- Modify: src/entities/agent/model/types.ts
- Modify: tests/e2e/runtime-agent-auth-service.spec.ts
- Modify: tests/e2e/runtime-agent-suggestions-service.spec.ts

- [x] Add failing Rust IPC tests requiring exact provider + accountId targets for lifecycle operations and the full provider + accountId + incarnation + credentialRevision lease for diagnostics, capabilities, and requests. Every successful runtime result echoes the complete lease.
- [x] Add failing auth tests for account-scoped check/disconnect, exact lease application, stale-result rejection, provider/account mismatch, and no fallback. Expose lease revisions to JavaScript as decimal strings so u64 values never lose precision.
- [x] Add failing service tests for distinct same-provider snapshots; exact create/rename/default/check/disconnect/forget payloads; malformed/duplicate IDs; and provider/account mismatch.
- [x] Add failing diagnostics/capability/suggestion response-owner tests. Suggestion cards include accountId.
- [x] Add one atomic all-provider profile snapshot for renderer hydration. Add `create_authorized_agent_job` as the only approval-to-job command: it accepts the exact provider + accountId + incarnation + credentialRevision lease plus project/session ownership, holds the auth critical section through job creation, and leaves the provider-less create command unregistered.
- [x] Verify RED with nonzero tests:

    cargo test --manifest-path src-tauri/Cargo.toml account_owned_ipc_ -- --nocapture
    npx playwright test tests/e2e/runtime-agent-auth-service.spec.ts tests/e2e/runtime-agent-suggestions-service.spec.ts --workers=1

- [x] Implement exact account routing and fail-closed response normalization. Add account-scoped auth mutation/query methods and distinct v2 adapter commands (`read_agent_account_diagnostics`, `read_agent_account_capabilities`, and `request_agent_account_suggestions`) while retaining the legacy provider-only commands only for migration compatibility. Missing accountId is never translated to a default. Browser fallback stays inert. Each runtime request and successful response carries the complete provider + accountId + incarnation + credentialRevision lease; command errors remain generic/redacted and do not fabricate an owner payload.
- [x] Verify GREEN with both commands, cargo check, npm run lint, npm run build, and diff check.

### Task 7: Coordinated renderer session-v2 migration

**Owner:** Frontend state

**Files:**
- Modify: src/prototype.jsx
- Modify: tests/e2e/project-agent-context.spec.ts

- [x] Add failing tests for the startup order: authoritative v2 auth profiles arrive first; only then may a legacy session bind to the matching reserved default.
- [x] Add failing tests that write a separate v2 key, retain v1 until v2 persistence succeeds, recover idempotently after a simulated failed write, and leave the session unassigned if auth discovery is unavailable.
- [x] Add malformed nested-map, missing/tombstoned account, and no-fallback reload tests.
- [x] Verify RED:

    npx playwright test tests/e2e/project-agent-context.spec.ts --workers=1 --grep "account session migration"

- [x] Implement selectedAccountIds plus provider/account-nested model, reasoning, and Fast maps. Preserve old v1 data until successful v2 write and then remove it. Do not bind to an arbitrary first account.
- [x] After authoritative discovery, a genuinely new session may select that provider's exact isDefault profile once. Existing sessions, missing/tombstoned selections, failed discovery, and legacy migration never redirect to a current arbitrary/default row; legacy provider-only data maps only to the matching reserved ambient ID.
- [x] Verify GREEN with the focused and full file, lint, build, and diff check.

### Task 8: Account-scoped capability state and immutable request turns

**Owner:** Frontend orchestration

**Files:**
- Modify: src/prototype.jsx
- Modify: tests/e2e/project-agent-context.spec.ts
- Modify: tests/e2e/claude-provider-workspaces.spec.ts

- [x] Add failing tests for composite connection/capability/action generation keys, independent account catalogs/preferences, reverse-order reads, disconnect/forget/switch during reads, cancellation, and originating-account error recovery.
- [x] Add failing request tests that freeze provider, account, captured alias, model, reasoning, Fast, attachments, project, session, and tab before mutation/await.
- [x] Prove alias/default metadata changes during a request do not invalidate credential work, while disconnect/context changes do. Turns, errors, suggestions, cancellation/completion/recovery paths, and permission snapshots retain captured accountId + incarnation + credentialRevision after rename/switch.
- [x] Create an isolated Agent job only through one atomic backend command that holds the auth-store lock while it validates the captured provider, account incarnation, credential revision, and connected state and creates the job. Disconnect, Forget, or credential-context refresh must not commit in an authorization-to-spawn gap. The current adapters publish atomic responses rather than stream chunks; document that future chunks must carry the same owner tuple.
- [x] Verify RED:

    npx playwright test tests/e2e/project-agent-context.spec.ts tests/e2e/claude-provider-workspaces.spec.ts --workers=1 --grep "account ownership|account catalog|account request"

- [x] Implement composite state ownership and fail-closed selection. Revalidate attachments against the exact account catalog. Never silently select another account.
- [x] Verify GREEN with focused/full files, lint, build, and diff check.

### Task 9: Compact combined provider/account picker

**Owner:** Frontend UI

**Files:**
- Modify: src/prototype.jsx
- Modify: src/styles.css
- Modify: tests/e2e/claude-provider-workspaces.spec.ts
- Modify: tests/e2e/design-prototype.spec.ts

- [x] Add failing accessibility/interaction tests for grouped provider accounts, exact full aliases/status, one selected row, Enter/Space, arrows, Home/End, Escape/focus restoration, disappearing rows, live status, and selected-row visibility.
- [x] Add failing geometry tests at default, 260 px, and 240 px widths. Closed controls stay one row and popups stay contained without horizontal scrolling.
- [x] Verify RED:

    npx playwright test tests/e2e/claude-provider-workspaces.spec.ts tests/e2e/design-prototype.spec.ts --workers=1 --grep "account picker"

- [x] Replace the provider-only picker with the combined picker. The compact trigger may show only provider/account cues, but title/accessible name includes exact provider, alias, and status. Missing/disconnected selection remains visible and blocks Send.
- [x] Verify GREEN with focused/full files, lint, build, and diff check.

### Task 10: Settings account management UI

**Owner:** Frontend UI

**Files:**
- Modify: src/prototype.jsx
- Modify: src/styles.css
- Modify: tests/e2e/claude-provider-workspaces.spec.ts
- Modify: tests/e2e/design-prototype.spec.ts

- [x] Add failing tests for provider-grouped account rows, add/name/provider flow, transient copyable setup command, check again, rename, set default, disconnect, forget warning, pending deduplication, macOS unsupported Claude copy, and disambiguated accessible actions.
- [x] Add 640x600 and 720x640 layout tests with stacked actions and no overlap/overflow.
- [x] Verify RED:

    npx playwright test tests/e2e/claude-provider-workspaces.spec.ts tests/e2e/design-prototype.spec.ts --workers=1 --grep "account settings"

- [x] Implement Settings rows and flow. Never persist/log the command or provider-derived identity. The warning states Forget does not logout/delete credentials. Settings stays open after add/check.
- [x] Verify GREEN with focused/full files, lint, build, and diff check.

### Task 11: Boundary, race, and aging regression

**Owner:** QA/tester

**Files:**
- Modify: tests/e2e/agent-runtime-boundaries.spec.ts
- Modify: tests/e2e/agent-runtime-aging.spec.ts
- Modify: tests/e2e/project-agent-context.spec.ts
- Modify: .github/workflows/ci.yml

- [x] Add failing stale-request tests for disconnect/context change/forget and non-stale rename/default changes.
- [x] Add failing 30-cycle account switch/request/reload test proving bounded visible/tombstone rows, caches/generations, quiescent polling, and exact ownership.
- [x] Instrument list/add/select/rename/default/check/disconnect/forget/capability/request/approval and assert zero center-terminal calls plus unchanged terminal IDs, active tab, input/output, focus, and layout.
- [x] Add nonzero deterministic fake-CLI environment/filesystem Rust test execution on Ubuntu, macOS, and Windows CI. Platform-native smoke remains supplementary and does not replace those tests.
- [x] Verify RED before any supporting fix:

    npx playwright test tests/e2e/agent-runtime-boundaries.spec.ts tests/e2e/agent-runtime-aging.spec.ts tests/e2e/project-agent-context.spec.ts --workers=1 --grep "multi-account|account aging|account terminal boundary"

- [x] Apply only necessary production fixes in the owning file and verify GREEN with focused/full files, lint, build, and diff check.

### Task 12: Source-of-truth documentation and exact dev integration

**Owner:** Documentation/orchestrator

**Files:**
- Modify: docs/README.md
- Modify: docs/DOCS_READING_ORDER.md
- Modify: docs/product-plan.md
- Modify: docs/technical-design.md
- Modify: docs/architecture.md
- Modify: docs/message-flow.md
- Modify: docs/design-system.md
- Modify: docs/frontend-design-benchmarks.md
- Modify: docs/left-menu-views.md
- Modify: docs/ui-ux-wireframes.md
- Modify: docs/mvp-backlog.md
- Modify: docs/sprint-plan.md
- Modify: docs/MVP_VALIDATION_NOTES.md
- Modify: docs/superpowers/plans/2026-07-20-multi-account-agent-profiles.md

- [x] Record in English the registry, coordinated migration, profile lifecycle/tombstones, exact owner envelope, sanitized child environments, platform gates, manual external login, account-scoped state, compact UI, user-alias privacy, no-fallback rules, and center-terminal prohibition.
- [x] Run the complete gate:

    npm run lint
    npm run build
    npx playwright test --workers=1
    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo check --manifest-path src-tauri/Cargo.toml
    cargo test --manifest-path src-tauri/Cargo.toml
    git diff --check

- [x] Verify default/260/240 Agent widths and narrow Settings through automated geometry coverage, and build the local macOS native executable without live paid inference.
- [ ] Complete manual macOS VoiceOver and 125–200% OS-scale observation plus native Windows installed-app sign-off as follow-up release QA.
- [x] Record actual counts, macOS Claude limitation, Codex capability-probe result, and untested billing/inference scope.
- [x] Obtain independent specification, security/code-quality, UI/accessibility, and documentation reviews. Any correction reruns affected focused and complete gates.
- [ ] Stage only task-owned files, confirm no credential/config artifacts, commit, pin and reverify the exact SHA. Fetch origin/dev, verify ancestry, push non-forced without branch rename, and confirm remote dev equals the reviewed SHA.

## Definition of Done

- Users can register/select multiple supported profiles independently per Agent session and preserve exact ownership after reload.
- Existing installs gain deterministic defaults without token copying; auth migration precedes coordinated session migration.
- Account preferences and visible selection are keyed by exact provider + accountId. Every diagnostic, capability, request, successful response, suggestion/permission turn, and runtime authorization carries the complete provider + accountId + incarnation + credentialRevision lease.
- Provider children remove conflicting higher-precedence credentials and cannot cross config roots or global environments.
- Missing, disconnected, stale, malformed, unsupported, forgotten, or unavailable-auth states fail closed without account fallback.
- Setup/account operations and provider work never mutate the user-visible center terminal.
- No secrets or provider-derived identity/subscription metadata are persisted, logged, rendered, or committed; user aliases are treated as user-supplied data.
- Compact picker, narrow Settings, race/aging, native isolation, full regression, independent review, and exact-SHA dev evidence pass.

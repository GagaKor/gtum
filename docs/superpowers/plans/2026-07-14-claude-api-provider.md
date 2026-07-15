# Claude API Provider Integration Plan

> **Historical plan — superseded on 2026-07-15.** This file preserves the original API-only implementation record. The active authentication contract and corrective work are defined in [Claude CLI Session Authentication Implementation Plan](./2026-07-15-claude-cli-session-auth.md): explicit API key, then strict helper, then an already authenticated user-owned local CLI session; no in-app OAuth/token capture; public CLI-session distribution blocked pending Anthropic approval/contract review.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans and keep backend, frontend service, and UI file ownership disjoint until integration.

**Goal:** Make Claude a real, project/session-owned Agent provider through the installed Claude Code CLI while refusing subscription-only authentication and preserving GTUM's center-terminal isolation contract.

**Architecture:** Add a dedicated Rust Claude adapter that discovers the local CLI, validates only first-party API-key credentials in `--bare` mode, invokes a no-tools structured-output request with the prompt on stdin, and maps the result into the existing provider-neutral suggestion contract. The auth manager stores only a non-secret credential-source label and protects connect/request completion with revision leases. The frontend removes forced-deferred normalization, persists the selected provider per Agent session, and captures `projectPath + agentSessionId + providerId` before every async boundary.

**Tech Stack:** Tauri 2, Rust/Serde, Claude Code CLI 2.1.209-compatible arguments, React 19, TypeScript, Playwright, Cargo tests.

**Compliance constraint:** GTUM must not reuse a Claude.ai Free/Pro/Max/Team/Enterprise login or subscription limits. A Claude connection is accepted only after bare-mode validation of a first-party API-key source backed by a non-empty `ANTHROPIC_API_KEY` or a top-level user `apiKeyHelper` containing one canonical absolute regular executable path. The helper value is not a command line and accepts no arguments, whitespace, or shell syntax. No key, helper output, email, organization, OAuth token, or subscription metadata may be persisted, rendered, or logged.

---

## Implementation acceptance update — 2026-07-14

- Backend commit `51af3dab` implements the Claude adapter, auth integration, provider dispatch, and fail-closed connect/request revision leases. The unchecked task list below is retained as the original execution plan rather than rewritten as a completion log.
- The implemented helper contract is intentionally narrower than the original “non-empty string” wording: `apiKeyHelper` must be a single absolute path that canonicalizes to a regular executable, with a Unix execute bit where applicable. Arguments, whitespace, and shell syntax fail closed; callers needing arguments use a user-owned, cwd-independent executable wrapper. Windows local-drive extended prefixes are normalized, while UNC and volume-GUID forms fail closed.
- Process hardening exceeds the initial environment-strip list: the CLI and helper run by canonical absolute path, child `PATH` entries are absolute-only, host-managed/custom-header/OAuth/alternate-host/cloud-mode variables are removed, one deadline covers process and all I/O workers, and bounded stderr is discarded rather than surfaced.
- The ordinary no-credential branch intentionally returns `MissingApiCredentials` before `auth status`. Bare mode does not separately inspect ambient subscription/OAuth stores, so guidance combines missing API credentials with the statement that subscription/OAuth is not accepted; this replaces the plan's expectation that every missing flow distinguish a separately inspected subscription-only login.
- Acceptance evidence: focused Claude tests pass 26/26, focused auth tests pass 11/11, the full Rust suite passes 124/124, and both Cargo check and formatting checks pass. A paid request remains unexecuted because no approved Anthropic API credential is available.

## File map and ownership

- Create `src-tauri/src/runtime/claude.rs`: discovery, sanitized helper settings, status parsing, diagnostics, capabilities, structured request invocation, timeout/output bounds, and redaction.
- Modify `src-tauri/src/runtime/mod.rs`: expose the Claude adapter.
- Modify `src-tauri/src/runtime/auth/mod.rs`: make Claude available/real, validate it, store only credential metadata, and add stale connect/request lease protection.
- Modify `src-tauri/src/lib.rs`: provider dispatch and stale result rejection.
- Modify `src/shared/api/runtimeAgentAuth.ts`: remove Claude deferred coercion and local short circuits.
- Modify `src/shared/api/runtimeAgentSuggestions.ts`: provider-neutral errors/labels, `agentSessionId` payload ownership, and provider mismatch rejection.
- Modify `src/prototype.jsx`: persist `providerId` per Agent session and route connect/request/response labels to the captured owner.
- Modify focused Rust, service, and E2E specs before implementation.
- Update canonical English product, technical, architecture, flow, design, sprint, backlog, and validation documentation after fresh evidence.

The backend worker owns Rust files only. The frontend service worker owns `src/shared/api/*` and their service specs only. The integrator alone owns `src/prototype.jsx`, UI E2E, and source-of-truth docs.

### Task 1: Lock the Claude credential and CLI contract with Rust tests

**Files:**
- Create: `src-tauri/src/runtime/claude.rs`
- Modify: `src-tauri/src/runtime/mod.rs`

- [ ] Add failing tests for CLI discovery through `PATH`, `~/.local/bin`, Homebrew paths, and the Windows user-local executable candidate.
- [ ] Add status parser tests for accepted `api_key` / `ANTHROPIC_API_KEY`, accepted `api_key_helper` / `apiKeyHelper`, and rejected `none`, `claude.ai`, OAuth/keychain, non-first-party Bedrock/Vertex/Foundry, malformed, oversized, and unknown payloads.
- [ ] Read only user-level Claude settings. Extract a non-empty top-level `apiKeyHelper` string into a new one-key JSON document; never pass project/local settings, hooks, plugins, MCP, or unrelated user settings.
- [ ] Add tests proving raw environment keys, helper commands, helper output, email, organization, and subscription fields never appear in diagnostics, persistence metadata, or errors.
- [ ] Implement bounded status execution: five-second timeout, bounded stdout/stderr, hidden Windows console, and secret-like stderr redaction.
- [ ] Emit diagnostics that distinguish missing CLI, subscription-only login, missing API credentials, and ready API-key/helper configuration without exposing identity data.

### Task 2: Invoke Claude with an inert structured-output surface

**Files:**
- Modify: `src-tauri/src/runtime/claude.rs`
- Reuse provider-neutral request/response types from `src-tauri/src/runtime/codex.rs` for this iteration.

- [ ] Add exact argv/stdin/cwd tests before implementation. Required arguments are:

```text
claude --bare --safe-mode --strict-mcp-config --disable-slash-commands
       --no-chrome --no-session-persistence --permission-mode dontAsk
       --tools "" --print --output-format json --json-schema <compact-schema>
```

Append only the sanitized `--settings <apiKeyHelper-only-json>` argument when that credential source is selected. Do not pass `--file`, `--add-dir`, `--mcp-config`, browser flags, resume/session flags, or write/terminal tools. The prompt is stdin and the child cwd is the captured canonical project path.
- [ ] Strip `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, and third-party provider mode variables from the child. Preserve only the approved first-party API-key path.
- [ ] Add strict parser tests for the Claude JSON result envelope and its `structured_output`. Reject missing/empty structured output, provider/schema mismatches, non-success/error envelopes, malformed/oversized output, non-zero exit, timeout, and auth errors.
- [ ] Return the existing `AgentSuggestionResponse` with `provider: claude`; generate no mock response and never mutate a terminal.
- [ ] Expose conservative capabilities: default model only, no model selector, no reasoning/fast mode, and all attachments disabled.

### Task 3: Make auth revisions authoritative for connect and requests

**Files:**
- Modify: `src-tauri/src/runtime/auth/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] Replace Claude `Deferred/Prototype` normalization with `Available/Real` and credential scopes such as `provider:request` plus `credential:api_key` metadata.
- [ ] Validate Claude during list/connect through the real adapter. A legacy persisted fake/deferred Claude connection must not become trusted without a fresh bare validation.
- [ ] Add a connect-attempt revision lease before validation so a delayed connect cannot overwrite disconnect or a newer reconnect.
- [ ] Require a connected-provider lease before a request. Apply validation only if current, and reject otherwise with a retryable stale-result error instead of returning stale suggestions.
- [ ] Add tests for connect/disconnect/reconnect races, stale successful request completion, stale auth failure, provider isolation, legacy-store migration, and no secret persistence.
- [ ] Route diagnostics, capabilities, and requests to the Claude adapter in `lib.rs`.

### Task 4: Remove frontend deferral and enforce provider-neutral envelopes

**Files:**
- Modify: `src/shared/api/runtimeAgentAuth.ts`
- Modify: `src/shared/api/runtimeAgentSuggestions.ts`
- Modify: `tests/e2e/runtime-agent-auth-service.spec.ts`
- Modify: `tests/e2e/runtime-agent-suggestions-service.spec.ts`

- [ ] Add failing service tests showing Claude list/connect/disconnect calls reach runtime unchanged and `availability: available`, `connectionKind: real` survive normalization.
- [ ] Add `agentSessionId` to `RequestAgentSuggestionsInput` and the IPC request. Reject blank ownership before invocation.
- [ ] Validate every returned suggestion provider equals the requested provider. Reject a mixed/mismatched response before rendering or permission handling.
- [ ] Replace Codex-only fallback IDs, empty-response errors, titles, and confidence notes with labels derived from the actual provider.
- [ ] Keep browser preview inert: no runtime means no provider request and no fabricated connected state.

### Task 5: Persist and switch providers per Agent session

**Files:**
- Modify: `src/prototype.jsx`
- Modify: `tests/e2e/project-agent-context.spec.ts`
- Add or modify a focused Claude provider E2E spec.

- [ ] Migrate every Agent session to `providerId`, defaulting legacy sessions to `codex`; do not keep a global provider selection as the source of truth.
- [ ] Add an accessible provider switch in the Agent header/composer. Selecting Claude in session A must not change session B or another project's session.
- [ ] Capture `{project, sessionId, providerId}` before connect, capability reads, attachment selection, request, stop, permission, and late response handling.
- [ ] Gate requests by the captured provider's connection and runtime capability. Set provider-specific role labels, placeholders, setup guidance, permission messages, IDs, and metadata.
- [ ] Add E2E for project A / Claude and project B / Codex with simultaneous delayed responses completing in reverse order. Each result must remain in its origin session and use the correct provider label.
- [ ] Add subscription-only rejection coverage and API-key connection coverage. Assert center terminal create/write/execute/close calls remain zero throughout connect, request, approval, switch, and completion.
- [ ] Keep Stop documented as frontend soft cancellation; provider process cancellation is a separate follow-up because the current runtime command is not cancellable.

### Task 6: Document and verify the real-provider boundary

**Files:**
- Modify: `docs/product-plan.md`
- Modify: `docs/technical-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/message-flow.md`
- Modify: `docs/design-system.md`
- Modify: `docs/ui-ux-wireframes.md` if its Agent selector contract changes
- Modify: `docs/mvp-backlog.md`
- Modify: `docs/sprint-plan.md`
- Modify after fresh evidence: `docs/MVP_VALIDATION_NOTES.md`

- [ ] Document API-key-only Claude auth, bare-mode sanitization, session-owned provider selection, structured-output parsing, stale lease rejection, no-terminal mutation, and the absence of a paid live smoke in this environment.
- [ ] Record the currently observed local state only as validation evidence: CLI present, bare API credential absent, ordinary subscription login rejected for GTUM use. Never record identity fields.
- [ ] Run fresh verification:

```bash
npm run lint
npm run build
npx playwright test tests/e2e/runtime-agent-auth-service.spec.ts tests/e2e/runtime-agent-suggestions-service.spec.ts tests/e2e/project-agent-context.spec.ts <focused-claude-spec>
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml runtime::auth::tests -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

- [ ] Run the full Playwright and Cargo suites after focused tests are green. A real paid Claude request remains explicitly pending until the user provides an approved API credential.

## Explicit non-goals and follow-ons

- Do not reuse Claude.ai subscription login, OAuth/keychain state, or subscription usage limits.
- Do not store an Anthropic key or helper output in GTUM state.
- Do not allow Claude tools, edits, shell execution, MCP, hooks, plugins, browser access, memory, or project settings in this provider adapter.
- Do not support local Claude attachments in this iteration; Claude CLI `--file` refers to remote file resources.
- Do not add model/effort/fast controls until the default-provider path is proven.
- Do not claim a live model smoke without an approved billable API credential.
- Add hard child-process cancellation before describing Stop as a billing stop.

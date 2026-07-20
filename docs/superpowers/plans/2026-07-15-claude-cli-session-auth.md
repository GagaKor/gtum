# Claude CLI Session Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let GTUM validate and use an already authenticated, user-owned Claude Code CLI session without reading or persisting OAuth/Keychain credentials, while retaining the no-tools and no-center-terminal safety boundary.

**Architecture:** Add a non-secret `claude_cli_session` credential source beside the existing API-key fallback, prefer the CLI session when no explicit API credential is configured, and run that source with `--safe-mode` rather than `--bare`. The Claude CLI remains the only component that reads its credential store; GTUM parses only an allowlisted auth classification and structured request result. Isolated children strip inherited provider/debug/telemetry/process-wrapper controls and explicitly disable nonessential traffic plus official-marketplace auto-install. Safe mode and empty user/project setting sources exclude local customizations, but organization-managed policy can still apply policy hooks, status-line commands, or file-suggestion commands; this plan does not claim an absolute process-level no-hooks boundary. This path is local/internal-use infrastructure pending explicit Anthropic approval for third-party product distribution; GTUM does not implement Claude.ai OAuth or capture tokens.

**Tech Stack:** Tauri 2, Rust/Serde, Claude Code CLI 2.1.209-compatible arguments, React 19, TypeScript, Playwright, Cargo tests.

---

### Task 1: Lock the CLI-session auth contract in failing Rust tests

**Files:**
- Modify: `src-tauri/src/runtime/claude.rs`

- [ ] **Step 1: Add a failing first-party CLI-session parser test**

Add a test that parses only the allowlisted fields from this status without retaining identity or subscription metadata:

```rust
let validation = parse_claude_auth_status(
    br#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"private@example.com","subscriptionType":"team"}"#,
    Some(&ClaudeCredentialSelection::cli_session()),
).unwrap();
assert_eq!(validation.credential_source, ClaudeCredentialSource::CliSession);
```

- [ ] **Step 2: Add failing exact-argv tests**

Require exact equality for the CLI-session status argv and structured request argv. The request allowlist is exactly `--safe-mode`, `--setting-sources`, `""`, `--strict-mcp-config`, `--disable-slash-commands`, `--no-chrome`, `--no-session-persistence`, `--permission-mode`, `dontAsk`, `--tools`, `""`, `--print`, `--output-format`, `json`, `--json-schema`, and the schema value. Explicitly assert absence of `--bare`, `--settings`, `--mcp-config`, plugin flags, custom agents, resume/continue flags, Chrome enablement, and session-persistence surfaces. Keep exact existing argv coverage for API-key/helper bare mode.

- [ ] **Step 3: Add a failing child-environment test**

Assert that CLI-session children do not inherit `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, OAuth-token environment variables, alternate hosts, custom headers, cloud-provider modes, or debug/telemetry/process-wrapper controls. Preserve ordinary OS user context such as `HOME` so the official CLI can access its own user credential store, and force the isolated child to disable nonessential traffic plus official-marketplace auto-install.

- [ ] **Step 4: Add failing precedence and missing-login tests**

Prove the source order is explicit API key, then valid `apiKeyHelper`, then CLI session fallback. Feed a bounded `exit 1` status payload with `loggedIn=false`, `authMethod=none`, and `apiProvider=firstParty`; require typed `MissingCliSession` guidance and assert the fake request executable is never invoked after that validation failure.

- [ ] **Step 5: Add a failing custom config-directory policy test**

Resolve one approved Claude user config root before credential selection. For CLI-session mode, preserve `CLAUDE_CONFIG_DIR` only when it resolves to an existing canonical directory inside the canonical current user home. Reject relative, missing, non-directory, outside-home, and symlink-escape paths; on macOS the default Keychain path requires no config override. When the approved custom root contains `settings.json`, use that same root for `apiKeyHelper` discovery so credential precedence remains explicit API key, custom/default helper, then CLI session. Add tests for helper discovery from an accepted custom root and for rejected custom roots never influencing either helper selection or child environment.

- [ ] **Step 6: Add a failing fake-child integration test**

Use the existing fake executable harness to return `loggedIn=true`, `authMethod=claude.ai`, and a schema-valid result without any API-key selection. Assert canonical project cwd, stdin prompt ownership, successful parsing, and bounded/redacted failure behavior.

- [ ] **Step 7: Run the focused tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::claude::tests -- --nocapture
```

Expected: the new CLI-session parser, argv, environment, and fake-child tests fail because the current implementation rejects `claude.ai`, requires API credentials, and always passes `--bare`.

### Task 2: Implement the minimal safe CLI-session runtime path

**Files:**
- Modify: `src-tauri/src/runtime/claude.rs`

- [ ] **Step 1: Add the non-secret runtime source**

Add `ClaudeCredentialSource::CliSession` with persistence label `claude_cli_session`. When neither a non-empty `ANTHROPIC_API_KEY` nor a valid user-level `apiKeyHelper` is explicitly configured, select `CliSession` instead of returning no credential.

- [ ] **Step 2: Split status and request argv by source**

For `CliSession`, use:

```text
claude --safe-mode --setting-sources "" auth status --json
```

and the existing structured request surface without `--bare`. Keep the existing bare API-key/helper fallback unchanged. Never pass settings or helper configuration into the CLI-session path.

- [ ] **Step 3: Accept only a first-party CLI login classification**

Accept normalized `claude.ai`, `oauth`, or `keychain` only when `loggedIn=true`, `apiProvider` is `firstParty`/`anthropic`, and the selected source is `CliSession`. Continue rejecting Bedrock, Vertex, Foundry, unknown methods, and source mismatches. Deserialize no email, organization, token, or subscription fields.

- [ ] **Step 4: Parse bounded status stdout before generic nonzero handling**

When `auth status` exits 1 with a valid bounded JSON status, return the typed missing-login classification and guidance `Run claude auth login in your terminal, then reconnect Claude.` Continue discarding raw stderr and use a generic redacted error only when stdout cannot be safely classified.

- [ ] **Step 5: Preserve only a safe user config-directory override**

Canonicalize the current user home once and resolve one approved Claude config root: an accepted `CLAUDE_CONFIG_DIR`, otherwise `<home>/.claude`. Use it consistently for user-level `settings.json` helper discovery. In CLI-session mode, copy the custom directory into the child only when its canonical existing directory is contained by the canonical home; otherwise remove it and use the default official CLI credential location. Never read credential files or Keychain values from GTUM.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Task 1 Cargo command. Expected: all Claude runtime tests pass with the new CLI-session cases.

- [ ] **Step 7: Commit the backend runtime slice**

```bash
git add src-tauri/src/runtime/claude.rs
git commit -m "fix(claude): use authenticated local CLI sessions"
```

### Task 3: Persist only safe CLI-session metadata

**Files:**
- Modify: `src-tauri/src/runtime/auth/mod.rs`

- [ ] **Step 1: Add failing auth-manager tests**

Require a successful Claude CLI-session connect to persist only `credentialSource: "claude_cli_session"`, use scopes `provider:request` and `credential:cli_session`, keep account/email/callback/token fields null, and require fresh runtime revalidation after reload. Preserve `credential:api_key` for environment-key and helper connections, and assert reconnect/revalidation updates scopes when the credential source changes. Add migration coverage showing stale API/legacy identity data cannot become a trusted CLI session without fresh validation.

- [ ] **Step 2: Run and verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::auth::tests -- --nocapture
```

Expected: scope and metadata assertions fail against the API-key-only enum.

- [ ] **Step 3: Implement the auth metadata change**

Add `ClaudeCredentialMetadata::CliSession`, recognize `claude_cli_session`, and derive Claude required scopes from the validated credential source: `credential:cli_session` for a CLI session and `credential:api_key` for environment-key/helper sources. Disconnected state may expose only `provider:request` until validation determines a source. Replace API-key-only reconnect messages with source-neutral local CLI guidance. Keep connect/request revision leases and secret/identity scrubbing unchanged.

- [ ] **Step 4: Run and verify GREEN**

Run the Task 3 focused command. Expected: all auth tests pass.

- [ ] **Step 5: Commit the auth-manager slice**

```bash
git add src-tauri/src/runtime/auth/mod.rs
git commit -m "fix(auth): persist Claude CLI session metadata"
```

### Task 4: Make the provider UX describe CLI login truthfully

**Files:**
- Modify: `src/prototype.jsx`
- Modify: `src/shared/api/runtimeAgentAuth.ts`
- Modify: `tests/e2e/design-prototype.spec.ts`
- Modify: `tests/e2e/claude-provider-workspaces.spec.ts`
- Modify: `tests/e2e/runtime-agent-auth-service.spec.ts`

- [ ] **Step 1: Change tests first**

Replace the subscription-rejected scenario with an accepted real Claude CLI-session connection and add a missing-login scenario that instructs the user to run `claude auth login` externally. Preserve `credentialSource` through the typed runtime auth snapshot and provider view state. Render `CLI session` / `the local Claude CLI session` only for `claude_cli_session`; render `API credential` / the API credential path for `anthropic_api_key` and `api_key_helper`. Change fake CLI-session scopes to `credential:cli_session`, keep fake API scopes as `credential:api_key`, and retain the assertion that Connect/request/permission/job flows create zero center-terminal runtime calls.

Add separate service normalization and rendered UI cases for `claude_cli_session`, `anthropic_api_key`, and `api_key_helper` snapshots so the frontend never relabels one source as the other.

- [ ] **Step 2: Run the focused E2E tests and verify RED**

```bash
npx playwright test tests/e2e/runtime-agent-auth-service.spec.ts tests/e2e/claude-provider-workspaces.spec.ts tests/e2e/design-prototype.spec.ts
```

Expected: API-credential copy and scopes fail the new assertions.

- [ ] **Step 3: Implement the minimal copy and scope changes**

Show `CLI session` for a connected Claude provider, report successful connection through `the local Claude CLI session`, and use `Run claude auth login in your terminal, then reconnect Claude.` when no official CLI login is available. Do not open a login terminal or browser from GTUM.

- [ ] **Step 4: Run and verify GREEN**

Run the Task 4 focused E2E command. Expected: all focused tests pass.

- [ ] **Step 5: Commit the frontend slice**

```bash
git add src/prototype.jsx src/shared/api/runtimeAgentAuth.ts tests/e2e/design-prototype.spec.ts tests/e2e/claude-provider-workspaces.spec.ts tests/e2e/runtime-agent-auth-service.spec.ts
git commit -m "fix(ui): describe Claude CLI session login"
```

### Task 5: Synchronize provider policy and validation documentation

**Files:**
- Modify: `docs/product-plan.md`
- Modify: `docs/technical-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/message-flow.md`
- Modify: `docs/mvp-backlog.md`
- Modify: `docs/sprint-plan.md`
- Modify: `docs/MVP_VALIDATION_NOTES.md`
- Modify: `docs/superpowers/plans/2026-07-14-claude-api-provider.md`
- Modify: `docs/README.md`
- Modify: `docs/DOCS_READING_ORDER.md`
- Modify: `docs/release-build-ci.md`

- [ ] **Step 1: Update active source-of-truth sections in English**

Document the user-owned local CLI-session default, safe-mode/no-tools request contract, non-secret metadata, external `claude auth login` setup, session/API precedence, and absence of in-app OAuth/token handling. State that managed policy hooks/commands may still apply even though user/project customizations and model tools are disabled. Mark the 2026-07-14 API-only plan as superseded by this correction rather than rewriting its historical task record.

- [ ] **Step 2: Record the release compliance gate**

State that technical support for a local installed CLI session is not a claim of permission to ship third-party Claude.ai login routing. Before public distribution, confirm Anthropic approval/contract terms or keep the release provider on API/cloud credentials. Link the official [authentication](https://code.claude.com/docs/en/authentication), [headless usage](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-usage), and [legal/compliance](https://code.claude.com/docs/en/legal-and-compliance) references.

Add the new plan to `docs/README.md`, route active provider-auth corrections to it from `docs/DOCS_READING_ORDER.md`, and record Anthropic approval/contract confirmation as a blocking public-release gate in `docs/release-build-ci.md`.

- [ ] **Step 3: Record validation evidence truthfully**

Record only non-secret facts: CLI version, ordinary/safe-mode status success, bare-mode status failure, automated results, and whether a live model request was run. Never record email, organization, subscription identity, raw status JSON, Keychain data, or child stderr.

- [ ] **Step 4: Commit the documentation slice**

```bash
git add docs
git commit -m "docs: adopt local Claude CLI session contract"
```

### Task 6: Verify the complete correction without unapproved usage spend

**Files:**
- Test only

- [ ] **Step 1: Run static frontend checks**

```bash
npm run lint
npm run build
```

- [ ] **Step 2: Run all browser tests serially as one Playwright invocation**

```bash
npx playwright test --workers=1
```

- [ ] **Step 3: Run Rust formatting, compile, and full tests**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Run a non-billing local status smoke**

Run the exact safe-mode status argv through the installed CLI using a small inline Node process that captures stdout/stderr, parses stdout in memory, and prints only this allowlist:

```text
exitCode, timedOut, loggedIn, authMethod, apiProvider, stdoutBytes, stderrBytes
```

Run this exact command from zsh, bash, or PowerShell; the JavaScript contains no single quotes, selects `claude.exe` on Windows, removes every competing credential/provider variable, and preserves only a canonical under-home custom config directory:

```bash
node -e 'const {spawnSync}=require("node:child_process");const fs=require("node:fs");const os=require("node:os");const path=require("node:path");const env={...process.env};for(const key of ["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","CLAUDE_CODE_OAUTH_TOKEN","CLAUDE_CODE_OAUTH_REFRESH_TOKEN","CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST","ANTHROPIC_CUSTOM_HEADERS","ANTHROPIC_BASE_URL","CLAUDE_CODE_USE_BEDROCK","CLAUDE_CODE_USE_VERTEX","CLAUDE_CODE_USE_FOUNDRY","CLAUDE_CODE_USE_ANTHROPIC_AWS","CLAUDE_CODE_USE_MANTLE","ANTHROPIC_BEDROCK_BASE_URL","ANTHROPIC_BEDROCK_MANTLE_BASE_URL","AWS_BEARER_TOKEN_BEDROCK","ANTHROPIC_AWS_API_KEY","ANTHROPIC_AWS_BASE_URL","ANTHROPIC_AWS_WORKSPACE_ID","ANTHROPIC_VERTEX_PROJECT_ID","ANTHROPIC_VERTEX_BASE_URL","CLOUD_ML_REGION","ANTHROPIC_FOUNDRY_RESOURCE","ANTHROPIC_FOUNDRY_API_KEY","ANTHROPIC_FOUNDRY_AUTH_TOKEN","ANTHROPIC_FOUNDRY_BASE_URL"])delete env[key];if(env.CLAUDE_CONFIG_DIR){try{const home=fs.realpathSync(os.homedir());const config=fs.realpathSync(env.CLAUDE_CONFIG_DIR);const relative=path.relative(home,config);const inside=relative===""||(!relative.startsWith("..")&&!path.isAbsolute(relative));if(!inside||!fs.statSync(config).isDirectory())delete env.CLAUDE_CONFIG_DIR;else env.CLAUDE_CONFIG_DIR=config}catch{delete env.CLAUDE_CONFIG_DIR}}const binary=process.platform==="win32"?"claude.exe":"claude";const result=spawnSync(binary,["--safe-mode","--setting-sources","","auth","status","--json"],{encoding:"utf8",timeout:10000,env});let value={};try{value=JSON.parse(result.stdout||"{}")}catch{}const output={exitCode:result.status,timedOut:Boolean(result.error&&result.error.code==="ETIMEDOUT"),loggedIn:value.loggedIn===true,authMethod:typeof value.authMethod==="string"?value.authMethod:null,apiProvider:typeof value.apiProvider==="string"?value.apiProvider:null,stdoutBytes:Buffer.byteLength(result.stdout||""),stderrBytes:Buffer.byteLength(result.stderr||"")};console.log(JSON.stringify(output));process.exit(result.status===0&&output.loggedIn?0:1)'
```

Expected on the current macOS machine: exit 0 and one JSON line containing `exitCode:0`, `timedOut:false`, `loggedIn:true`, `authMethod:"claude.ai"`, and `apiProvider:"firstParty"`. Windows uses the same command unchanged in PowerShell and resolves `claude.exe`; expected fields are identical except the supported first-party auth-method spelling may be another allowlisted CLI-session value. Raw stdout/stderr are never printed, and the script exits nonzero if the CLI status is not a logged-in success.

- [ ] **Step 5: Keep live Claude inference as an explicit approval gate**

Do not run `claude -p` merely to verify the fix because it consumes subscription Agent SDK credit. With user approval, run one minimal structured request and verify it remains project/session-owned and never mutates the center terminal; otherwise report that live inference remains pending.

- [ ] **Step 6: Check patch hygiene**

```bash
git diff --check
git status --short --branch
```

# MVP Validation Notes / MVP 검증 메모

## 목적 / Purpose

### 한국어

이 문서는 `gtum` MVP 완료 판단에 필요한 검증 메모를 모은다. 기능 검증, E2E 범위, aging test 초안, 그리고 플랫폼별 현재 상태를 함께 기록한다.

### English

This document captures the validation notes needed to judge `gtum` MVP completion. It records feature validation, E2E coverage, the first aging-test draft, and the current platform status.

## Long-Doc Routing

This document exceeds 200 lines. Read only the section needed for the current gate:

- use `Automated Validation Coverage` and the newest dated validation section for current code evidence
- use `Validation Priority` and `Current MVP Assessment` for remaining release gates
- use `Current Automated Aging Test` and `Platform Status` for repeated-use or installed-app validation

## 자동화 검증 범위 / Automated Validation Coverage

### 한국어

- 프로젝트 열기, 파일 트리, Git 상태
- 멀티 탭 터미널과 활성 로그 캡처
- provider 연결 preview/deferred 상태와 diagnostics
- 현재 provider-auth 자동화는 최종 `OAuth/session login` 검증이 아니라 계약/프리뷰 범위 검증이다.
- agent request -> suggestion -> approval 흐름
- 반복 실행과 reload를 포함한 초기 aging test

### English

- project open, file tree, and Git status
- multi-tab terminal and active-log capture
- real provider connection states, non-secret credential-source labels, and diagnostics
- provider-auth automation covers runtime contracts and injected UI seams; native installed-app login and live-inference validation remain separate gates
- agent request -> suggestion -> approval flow
- new design shell render, scaled proportions, and titlebar/statusbar contracts through `tests/e2e/design-prototype.spec.ts`
- independent left `Projects` and `Files` accordion collapse behavior, settings-modal open, backend-bridge state, and the empty browser fallback with no bundled project files (same spec)
- custom frameless titlebar coverage in the same spec: OS-specific window chrome, responsive collapse, injected native window-control routing, titlebar drag-region behavior, and native edge-resize routing
- runtime project-service fallback behavior through `tests/e2e/runtime-project-service.spec.ts`
- terminal runtime service contract behavior through `tests/e2e/runtime-terminal-service.spec.ts`
- injected terminal runtime bridge coverage in `tests/e2e/design-prototype.spec.ts` for new-tab creation and close/terminate routing
- agent suggestion runtime service contract behavior through `tests/e2e/runtime-agent-suggestions-service.spec.ts`
- injected Codex suggestion runtime bridge coverage in `tests/e2e/design-prototype.spec.ts`
- runtime provider capability coverage verifies composer model picking and image attachment selection use `read_agent_provider_capabilities`, then forward the selected model id and attachment paths in `request_agent_suggestions`.
- Agent Bar coverage verifies the left `Projects` workspace tree mirrors agent sessions, can create and switch workspaces, the composer stop button cancels a running request in the UI, and `@`, `#`, and `/` open inline reference suggestions.
- live Codex activity coverage in `tests/e2e/design-prototype.spec.ts` verifies pending runtime requests update a persistent conversational agent turn with sequential concrete operation progress, then clear the internal progress rows and show answer-time metadata when that same turn becomes the final suggestion/result.
- reply-only Codex coverage verifies normal assistant answers do not create review cards or composer approval panels; only command-bearing responses enter the review flow.
- numbered-choice Codex coverage verifies reply choices render as selectable event cards and selected options continue through the agent request path.
- command approval coverage verifies command-bearing responses render compact execution-suggestion rows and expose a detailed permission request directly above the composer with only `Allow once` and `Deny` decisions.
- approved commands create one isolated Agent job and stay in the Agent panel. Coverage proves duplicate activation, polling, cancellation, failure, restore, and auth errors do not invoke terminal runtime commands or mutate the center workbench.
- `tests/e2e/runtime-agent-jobs-service.spec.ts` and `tests/e2e/runtime-agent-auth-service.spec.ts` validate runtime payload normalization, project/session ownership, canonical provider availability, and exact Tauri command envelopes.
- `tests/e2e/agent-runtime-boundaries.spec.ts` covers both event orders of session-close/job-create races, active-job retention, monotonic hydration/cancel state, log-read error separation, the missing-auth seam, and all four canonical Codex CLI connection failures.
- `tests/e2e/agent-runtime-aging.spec.ts` runs 30 bounded complete/fail/cancel cycles across project switching, Agent-session reopen, and reload while asserting one job per approval, stable session ownership, bounded rows, terminal polling quiescence, no terminal calls, and unchanged center-workbench state.
- Rust unit coverage verifies the Codex prompt and output schema describe command suggestions as gtum permission-card previews, so provider-side `approval_policy=never` does not block harmless right-panel permission requests.
- Codex suggestion failure coverage now verifies CLI invocation failures, error-only structured responses, empty-command responses, and browser-preview runtime-unavailable requests do not create approval cards or canned replies.
- Rust unit coverage verifies hanging Codex CLI child processes are killed and returned as timeout errors instead of blocking indefinitely.
- Rust unit coverage now guards app-data startup normalization for missing directories, existing directories, and legacy file-path migration.
- agent auth runtime service contract behavior through `tests/e2e/runtime-agent-auth-service.spec.ts`
- injected Codex connect setup-guidance coverage in `tests/e2e/design-prototype.spec.ts`
- frontend no-mock baseline coverage in `tests/e2e/design-prototype.spec.ts`: browser preview starts at `Open a project`, exposes an empty bridge `projectPath`, contains no `aurora-monorepo`/`OnboardingFunnel.tsx` default data, and shows runtime-required messages instead of canned responses.

The Sprint 17 frontend reset deleted the earlier aging suite. The current shell now has replacement boundary and repeated-use coverage in `agent-runtime-boundaries.spec.ts` and `agent-runtime-aging.spec.ts`.

## Validation Priority

The installable desktop app is the primary validation target. Web/Vite preview is secondary and should be used for fast layout, design-shell, and browser-fallback regression coverage only.

Before using web-preview results as evidence, the current sprint or release pass should first answer whether the installable app can:

- build as a native desktop artifact for the target platform
- install or launch from the generated artifact
- open at the expected desktop window size without shell letterboxing
- persist auth, workspace, Agent jobs, and telegram state into distinct `app_data_dir` files
- open a real project folder through the native picker
- create, read, execute, and close PTY-backed terminal tabs
- type user-owned commands into the center terminal and verify `whoami`, `dir`, `cd`, `ls`, and `clear` reach the real runtime terminal session
- open, edit, and save real project files through `write_project_file` with content-hash conflict protection
- run approved agent commands through agent-owned background jobs without creating or mutating center terminal tabs
- validate an existing Codex CLI ChatGPT session through `Connect Codex`, keep setup guidance in the Agent panel when login is missing, reconnect Codex after the user completes CLI login manually, and request a real Codex suggestion
- resolve Codex CLI from the installed app environment even when the process `PATH` does not include the shell-installed `codex` command
- validate Claude through an explicit `ANTHROPIC_API_KEY`, an explicitly selected top-level user `apiKeyHelper` containing one canonical absolute regular executable path, or an already authenticated installed user-owned CLI session; keep all credential values, tokens, and identity metadata out of UI, logs, and persistence
- when CLI login is missing, instruct the user to run `claude auth login` externally. GTUM must not open a Claude login browser, capture OAuth tokens, read Keychain/credential files, or mutate the center terminal
- request Claude through the source-specific safe-mode or bare no-tools structured-output contract, reject stale connection/request completion, and prove the result remains in its captured project and Agent session without mutating the center terminal

## 2026-07-15 Provider-Aware Model Selection Slice

- Runtime capability ownership is provider-specific. Claude advertises exactly `default`, `best`, `sonnet`, `opus`, and `haiku`; top-level/per-model provider mismatches, blank model metadata, and duplicate IDs are rejected before the catalog reaches UI state.
- `best` delegates account-entitlement resolution to Claude Code. Direct Fable, exact-version, 1M-context, effort, and fast-mode controls remain deferred until structured entitlement discovery exists, and organization-managed policy remains authoritative.
- Agent directory persistence stores trimmed `selectedModels.codex` and `selectedModels.claude` per project/session. A supported catalog that definitively removes a model clears only that provider key and sends `model: null`; unavailable or not-yet-loaded capability state preserves persistence until it can be validated.
- Send snapshots the provider with only its validated explicit selection. Claude adds one separate `--model`, `opus` pair in fake-child coverage, leaves implicit default requests flag-free, and rejects blank, cross-provider, version-specific, leading-dash, and unknown values before spawning the child.
- Focused evidence: the Claude Rust runtime module passes 44/44; `runtime-agent-suggestions-service.spec.ts` passes 24/24; and the provider model workspace/UI subset passes 5/5, including provider round trips, localStorage reload, stale cleanup, unavailable preservation, accessible picker state, request ownership, and zero center-terminal calls.
- Complete post-change evidence: lint passes; the production build passes with only the existing greater-than-500-KB chunk warning; serial Playwright passes 210/210; Rust formatting and check pass; and the full Rust suite passes 149/149. Independent implementation and documentation reviews reported no critical, important, or minor findings.
- No live `claude -p` inference was run for this slice. Model response quality, account-specific alias resolution, and billing behavior remain outside this evidence.
- The [Provider-Aware Model Selection Implementation Plan](./superpowers/plans/2026-07-15-provider-aware-model-selection.md) records the completed verification and non-force `dev` integration.

## 2026-07-15 Claude CLI Session Authentication Correction

- The 2026-07-14 API-only classification was the cause of the observed false authentication failure: GTUM always selected bare mode, while the locally installed Claude Code CLI was authenticated through its own first-party session. Bare mode intentionally skips OAuth/Keychain reads.
- Claude credential precedence is now explicit `ANTHROPIC_API_KEY`, then a valid strict `apiKeyHelper`, then `claude_cli_session`. The CLI-session path runs exact safe-mode auth status with empty user/project setting sources and performs no in-app OAuth or token capture.
- Successful runtime persistence contains only the source label and scopes. CLI sessions use `credential:cli_session`; API-key/helper sources use `credential:api_key`. Email, organization, subscription identity, raw status output, Keychain data, tokens, helper output, and child stderr remain excluded.
- CLI-session requests disable model tools, MCP, slash commands, Chrome integration, and session persistence, and never use the center terminal. Safe mode excludes user/project customizations, but organization-managed policy hooks, status-line commands, or file-suggestion commands can still apply; this is not an absolute process-level no-hooks claim.
- Final integrated automated evidence: lint passes; the production build passes with only the existing greater-than-500-KB chunk warning; isolated serial Playwright passes 200/200; Rust formatting and check pass; focused Claude tests pass 42/42; and the full Rust suite passes 147/147.
- Non-billing local smoke evidence with Claude Code CLI 2.1.210: exact safe-mode status exits 0 with `loggedIn: true`, `authMethod: claude.ai`, `apiProvider: firstParty`, and zero stderr bytes; exact bare status exits 1 with `loggedIn: false`, `authMethod: none`, `apiProvider: firstParty`, and zero stderr bytes. Only allowlisted classification facts were retained.
- No live `claude -p` inference was run because it consumes Agent SDK/subscription credit. Live response, command-review, billing, and end-to-end project/session ownership remain pending explicit user approval.
- Technical operation of a local CLI session does not establish permission for public third-party Claude.ai login routing. Public distribution remains blocked pending Anthropic approval/contract review; without that approval, release builds must use API-key or supported cloud-provider credentials.
- The [Claude CLI Session Authentication Implementation Plan](./superpowers/plans/2026-07-15-claude-cli-session-auth.md) is the active correction. The 2026-07-14 API provider slice below remains historical evidence only.

## 2026-07-14 Claude API Provider Integrated Slice (Historical)

- Claude now survives frontend auth normalization as `availability: available` and `connectionKind: real`. List, Connect, Disconnect, and runtime snapshot state use the real Tauri IPC seam instead of a local deferred shortcut; browser preview remains inert and does not fabricate connected state.
- `request_agent_suggestions` now requires `agentSessionId`. Blank session ownership is rejected before invocation, and a response whose provider differs from the requested provider is rejected before conversation or permission rendering.
- Each Agent session persists its own `providerId`. Switching projects or Agent sessions restores that provider independently, and reverse-order delayed responses remain in the captured `projectPath + agentSessionId + providerId` owner.
- The Claude backend accepts only a first-party Anthropic API credential from `ANTHROPIC_API_KEY` or a top-level user `apiKeyHelper` in bare mode. The helper value must be one canonical absolute regular executable path, with a Unix execute bit where applicable; arguments, whitespace, shell syntax, subscription/OAuth/keychain state, Bedrock, Vertex, and Foundry authentication are rejected. Windows local-drive extended prefixes are normalized, while UNC and volume-GUID forms fail closed.
- The implemented Rust adapter launches the Claude CLI and optional helper only by canonical absolute path, supplies an absolute-only child `PATH`, removes host-managed/custom-header/OAuth/alternate-host/cloud-mode environment variables, and applies one deadline to child completion plus stdin/stdout/stderr. Stdout is bounded, stderr is bounded-drained and discarded, tools/MCP/hooks/plugins/browser/project settings/session persistence remain disabled, and only schema-valid `structured_output` is accepted.
- Fail-closed connect/request revision leases are implemented. A stale completion cannot publish state, a reply, or a permission card, while an authentication-like failure can downgrade only the connection revision that initiated it.
- Fresh focused evidence supplied for this slice: the frontend auth/suggestion service suite passes 22/22, the Agent-session/provider workspace suite passes 19/19, the modified design regression selection passes 2/2, and both `npm run lint` and `npm run build` pass.
- The focused Claude workspace coverage exercises injected API-key Connect, blocks repeat pending Connect, preserves a completed connection against stale discovery, completes Claude/Codex requests in reverse project/session order, renders a command-bearing Claude result, approves it once into exactly one isolated Agent job, switches projects, and asserts that the center-terminal runtime call log remains empty throughout.
- Fresh backend evidence for commit `51af3dab`: `runtime::claude::tests` passes 26/26, `runtime::auth::tests` passes 11/11, the full Rust suite passes 124/124, `cargo check` passes, and `cargo fmt -- --check` passes.
- Final integrated browser evidence passes 195/195 Playwright tests after fixing the no-project fallback terminal guard; `npm run lint` and `npm run build` also pass on the final source tree.
- With no allowed key source, the ordinary bare-mode path intentionally returns `MissingApiCredentials` before invoking auth status. It does not separately inspect ambient subscription/OAuth stores; the user-facing classification therefore combines “API credentials missing” with “subscription/OAuth not accepted.”
- No paid Claude request was run. The environment has no approved Anthropic API credential, so live response quality, billing behavior, and real authentication success remain unverified.
- The `2026-07-14 Agent Runtime Lifecycle Stabilization` section below is retained as historical evidence for the pre-Claude slice; its deferred-provider statement is not the current provider contract.

## 2026-07-14 Agent Runtime Lifecycle Stabilization

- The Agent job manager persists a maximum of 100 project-scoped records in `agent-jobs.json`, preserves bounded ordered logs, uses canonical project ownership for list/read/cancel, and converts restored nonterminal records to durable `interrupted` state without relaunching a process.
- Agent-session ownership is part of the create/list/snapshot contract. The frontend persists only session directory metadata, rehydrates jobs into their originating session, keeps active jobs ahead of terminal history, and blocks session close while creation or active execution is observable.
- Codex is the only available real provider. It requires a stored connected state and one fresh CLI ChatGPT-session validation on a blocking worker. A private revision lease prevents a late validation result from overwriting disconnect/reconnect; CLI status/catalog probes are bounded by a five-second subprocess timeout.
- Claude is explicitly deferred. Legacy connected Claude records normalize to disconnected/deferred with account and callback state removed, and the UI exposes no connect or request action.
- Rust coverage includes durable terminal publication, process-tree cancellation, retention, corrupted/unknown store recovery, project/session scoping, restart interruption, auth persistence, stale validation leases, single validation, and separation of validation failure from execution failure.
- Fresh gate evidence for this diff: `npm run lint` passes; `npm run build` passes; all 90 Playwright tests pass; all 73 Rust tests pass; native `cargo check` passes; `x86_64-pc-windows-msvc` Cargo check passes; and `npm run tauri:build` produces the macOS release executable. The four changed Rust files pass `rustfmt --check`.
- Repository-wide `cargo fmt --check` still reports pre-existing formatting differences in `runtime/platform/mod.rs`, `runtime/pty/mod.rs`, and `runtime/workspace.rs`; those unrelated files were not rewritten during this stabilization slice.
- Automated repeated-use and native macOS build evidence is current, but native Windows installed-app sign-off and a sustained manual soak remain open.

## 2026-06-07 Workbench Runtime Slice

- Center terminal tabs now expose a user-owned input form that submits commands into the runtime-backed terminal session. On Windows this uses a hidden persistent shell process, preferring PowerShell, so user commands such as `dir`, `cd`, `ls`, and `clear` work without opening an external console window. `clear` and `cls` also clear the runtime terminal log buffer so the app surface behaves like a terminal, not only a command transcript.
- Center editor tabs now use real editable buffers and save through `write_project_file`; saves include the last `contentHash` and are rejected if the file changed on disk.
- Agent patch application is represented by `apply_project_patch`, a project-root-checked file-content edit contract with per-file content-hash guards and all-edit preflight before any write.
- Approved agent commands now use `create_agent_job` through `src/shared/api/runtimeAgentJobs.ts`, not `create_terminal_session_with_command` or `execute_terminal_session_command`; center terminal tabs remain untouched by approval.

## 2026-06-01 Windows Installable Smoke

Local Windows installable validation was run from the generated release executable on June 1, 2026.

- `npm run tauri:build` succeeds when run outside the process-spawn sandbox and produces `src-tauri/target/release/gtum.exe`.
- Launching `gtum.exe` from the release target now keeps the `gtum` process alive instead of exiting with code `101`.
- The smoke found a real legacy-state collision: `%APPDATA%\com.gagakor.gtum` existed as a file from an older build, while the current runtime expects that path to be a directory.
- Startup now backs up that legacy file beside the app-data root as `com.gagakor.gtum.legacy-file-<timestamp>.json`, creates `%APPDATA%\com.gagakor.gtum`, and initializes distinct `agent-auth.json`, `workspace-state.json`, `agent-jobs.json`, and `telegram-state.json` files.
- The local Codex CLI prerequisite is now installed from `@openai/codex`, reports `codex-cli 0.135.0`, and `codex login status` reports a ChatGPT login. A direct `codex exec` smoke was not run because it would transmit local repository context to the external Codex service from this validation environment.
- Approval execution exposed Windows shell startup failures where both `powershell.exe` and `cmd.exe` could raise application-error dialogs from the interactive PTY path. Windows-approved agent commands now use hidden shell-free command-output sessions for direct `.exe`/`.com` programs and reject shell syntax or batch shims into the app log for manual terminal execution.
- A connected Codex request exposed a Windows `codex.cmd` batch-argument failure. The runtime now keeps the prompt out of `.cmd` arguments, writes it to stdin, and prefers the direct Node `codex.js` entrypoint when available.
- This pass confirms Windows build, launch, and state-root initialization. Native folder picker, user-owned PTY command execution, Codex connect validation, and a first real Codex suggestion still need manual installed-app sign-off.

## 2026-06-01 macOS Installable Smoke

Local macOS installable validation was run from the generated DMG on June 1, 2026.

- `npx tauri build --bundles dmg --verbose` succeeds when run outside the filesystem sandbox; the earlier `hdiutil create failed - device not configured` failure was sandbox-related.
- Generated artifact: `src-tauri/target/release/bundle/dmg/gtum_0.1.0_aarch64.dmg`.
- The DMG mounts at `/Volumes/gtum` and contains `gtum.app`, a `/Applications` symlink, `.VolumeIcon.icns`, and `.DS_Store`.
- `gtum.app` has bundle identifier `com.gagakor.gtum`, version `0.1.0`, and an arm64 Mach-O executable.
- Launching directly from the mounted DMG opens one `1320x824` window, matching the uploaded design shell and Tauri launch size.
- Follow-up viewport validation now covers larger desktop windows: the shell fills the stage after resize instead of keeping the `1320x824` fixed canvas centered with top/bottom or side letterboxing.
- The previous installed-app idle CPU regression is fixed: the app no longer polls native maximize state from resize events, and settled DMG-launch CPU stayed near idle (`gtum` about 1%, WebContent about 1-2% in the sampled environment).
- The app support directory contains distinct state files: `agent-auth.json`, `workspace-state.json`, `agent-jobs.json`, and `telegram-state.json`.

Residual notes:

- macOS logs still include expected WebKit sandbox noise for pasteboard/audio bootstrap lookup in this unsigned local build.
- A one-time Tauri/AppKit `is_zoomed` warning can still appear from Tauri internals on mounted-DMG launch, but the bundled frontend no longer calls `isMaximized` or subscribes to resize-driven maximize polling.
- Screenshot capture through `screencapture` failed in this Codex environment, likely due macOS screen-recording permission, so the window was verified through CoreGraphics metadata rather than pixels.
- This does not replace Windows real-device sign-off, which remains the first daily-use platform gate.

## Current Automated Aging Test

`tests/e2e/agent-runtime-aging.spec.ts` re-establishes repeated-use coverage on the current shell. It executes 30 approval cycles with complete, fail, and cancel outcomes; switches and reopens project context; reloads the page; verifies stable Agent-session ownership and bounded visible history; and proves terminal-state jobs stop polling. Every cycle asserts that the center workbench snapshot and terminal-runtime call log remain unchanged.

This is bounded browser-driven evidence with injected runtime seams. Rust tests separately verify the real `agent-jobs.json` persistence/restart contract, including interrupted restore without process relaunch. Neither layer replaces a sustained native manual soak or Windows installed-app restart sign-off.

## Platform Status

- `Ubuntu`
  - current primary development platform
- `Windows`
  - first daily-use baseline platform
  - shell-candidate abstraction and command-submission newline handling are in place
  - native app compile path is covered by the `windows-install-smoke` CI job
  - Release workflow requires at least one `.exe` or `.msi` artifact from the Windows runner
  - installed-app real-device validation is the first manual test priority
- `macOS`
  - covered by the non-Windows shell abstraction path
  - native app compile path is covered by the `macos-install-smoke` CI job
  - Release workflow requires both `.app` and `.dmg` artifacts from the macOS runner
  - signing and notarization are not implemented yet
  - installed-app real-device validation is required after the Windows-first pass

## Current MVP Assessment

The core MVP implementation is present, but stabilization is not complete. The current branch has durable isolated Agent jobs, real session-owned Codex/Claude provider and model selection, the Rust-verified Claude API-key/helper/CLI-session adapter, fail-closed connect/request revision leases, provider-neutral request ownership guards, center-terminal isolation, race-focused E2E coverage, and a bounded automated aging scenario. The provider-aware model slice has completed its local post-change regression gate. The following gates remain before an MVP-complete claim:

- native Windows installed-app validation for folder picker, PTY commands, Codex reconnect/expiry behavior, isolated Agent-job execution, restart restore, and a first real suggestion
- one explicitly user-approved live Claude request plus the full connect, command review, `Allow once`, isolated Agent-job, project-switch, and zero-center-terminal-mutation regression path
- Anthropic approval/contract confirmation for public CLI-session distribution, or a release contract that disables that path and uses API-key/supported-cloud credentials
- signed and notarized macOS distribution
- sustained manual aging validation beyond the bounded automated scenario
- Telegram external-channel integration

A code-verified state-persistence bug was found and fixed during the deployment-readiness review: auth, workspace, Agent-job, and telegram state now persist to distinct files (`agent-auth.json`, `workspace-state.json`, `agent-jobs.json`, `telegram-state.json`). A follow-on Windows launch blocker caused by a legacy file at the app-data root is also fixed and guarded by Rust unit tests. Rust and browser tests now cover their respective restore contracts; full installed-app restart verification remains pending on Windows.

For the consolidated deployment/operation readiness assessment, open blockers, and the ship/no-ship verdict, see `docs/release-build-ci.md` (`Current Release Status Snapshot` through `First-Release Go / No-Go Matrix`).

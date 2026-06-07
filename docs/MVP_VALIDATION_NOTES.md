# MVP Validation Notes / MVP 검증 메모

## 목적 / Purpose

### 한국어

이 문서는 `gtum` MVP 완료 판단에 필요한 검증 메모를 모은다. 기능 검증, E2E 범위, aging test 초안, 그리고 플랫폼별 현재 상태를 함께 기록한다.

### English

This document captures the validation notes needed to judge `gtum` MVP completion. It records feature validation, E2E coverage, the first aging-test draft, and the current platform status.

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
- preview/deferred provider connection states and diagnostics
- current provider-auth automation is contract/preview coverage, not final `OAuth/session login` validation
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
- command approval coverage verifies command-bearing responses render compact execution-suggestion rows in the conversation and expose the detailed permission request directly above the composer with command preview and direct `Allow once`, `Always allow`, and `Deny` decisions.
- command approval coverage verifies approved command decisions stay in the Agent panel without terminal runtime execution, that pending approvals disappear after a decision, and that the composer shows project scope instead of a current-tab context chip. Setup-guidance coverage still verifies login/setup guidance stays in the right panel without terminal runtime execution.
- Rust unit coverage verifies the Codex prompt and output schema describe command suggestions as gtum permission-card previews, so provider-side `approval_policy=never` does not block harmless right-panel permission requests.
- Codex suggestion failure coverage now verifies CLI invocation failures, error-only structured responses, empty-command responses, and browser-preview runtime-unavailable requests do not create approval cards or canned replies.
- Rust unit coverage verifies hanging Codex CLI child processes are killed and returned as timeout errors instead of blocking indefinitely.
- Rust unit coverage now guards app-data startup normalization for missing directories, existing directories, and legacy file-path migration.
- agent auth runtime service contract behavior through `tests/e2e/runtime-agent-auth-service.spec.ts`
- injected Codex connect setup-guidance coverage in `tests/e2e/design-prototype.spec.ts`
- frontend no-mock baseline coverage in `tests/e2e/design-prototype.spec.ts`: browser preview starts at `Open a project`, exposes an empty bridge `projectPath`, contains no `aurora-monorepo`/`OnboardingFunnel.tsx` default data, and shows runtime-required messages instead of canned responses.

Note: the Sprint 17 frontend reset deleted the earlier suites (including `new-design-shell.spec.ts`, the project-workspace regression, the repetition/reload aging spec, and the agent-request-flow spec). The specs listed above are the active E2E coverage; the aging scenario must be re-gathered on the new shell.

## Validation Priority

The installable desktop app is the primary validation target. Web/Vite preview is secondary and should be used for fast layout, design-shell, and browser-fallback regression coverage only.

Before using web-preview results as evidence, the current sprint or release pass should first answer whether the installable app can:

- build as a native desktop artifact for the target platform
- install or launch from the generated artifact
- open at the expected desktop window size without shell letterboxing
- persist auth, workspace, and telegram state into distinct `app_data_dir` files
- open a real project folder through the native picker
- create, read, execute, and close PTY-backed terminal tabs
- validate an existing Codex CLI ChatGPT session through `Connect Codex`, keep setup guidance in the Agent panel when login is missing, reconnect Codex after the user completes CLI login manually, and request a real Codex suggestion
- resolve Codex CLI from the installed app environment even when the process `PATH` does not include the shell-installed `codex` command

## 2026-06-01 Windows Installable Smoke

Local Windows installable validation was run from the generated release executable on June 1, 2026.

- `npm run tauri:build` succeeds when run outside the process-spawn sandbox and produces `src-tauri/target/release/gtum.exe`.
- Launching `gtum.exe` from the release target now keeps the `gtum` process alive instead of exiting with code `101`.
- The smoke found a real legacy-state collision: `%APPDATA%\com.gagakor.gtum` existed as a file from an older build, while the current runtime expects that path to be a directory.
- Startup now backs up that legacy file beside the app-data root as `com.gagakor.gtum.legacy-file-<timestamp>.json`, creates `%APPDATA%\com.gagakor.gtum`, and initializes distinct `agent-auth.json`, `workspace-state.json`, and `telegram-state.json` files.
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
- The app support directory contains distinct state files: `agent-auth.json`, `workspace-state.json`, and `telegram-state.json`.

Residual notes:

- macOS logs still include expected WebKit sandbox noise for pasteboard/audio bootstrap lookup in this unsigned local build.
- A one-time Tauri/AppKit `is_zoomed` warning can still appear from Tauri internals on mounted-DMG launch, but the bundled frontend no longer calls `isMaximized` or subscribes to resize-driven maximize polling.
- Screenshot capture through `screencapture` failed in this Codex environment, likely due macOS screen-recording permission, so the window was verified through CoreGraphics metadata rather than pixels.
- This does not replace Windows real-device sign-off, which remains the first daily-use platform gate.

## Aging Test 초안 / Initial Aging Test

### 한국어

현재 aging test는 Playwright 기준으로 아래를 반복 확인한다.

- 프로젝트 열기
- provider 연결
- active log 캡처
- provider/session 상태 확인
- suggestion 요청과 승인 실행
- 페이지 reload 후 프로젝트와 task history 복원 확인

이 테스트는 장시간 실사용 전체를 대체하지는 않지만, MVP 기준의 상태 유지와 반복 사용 안정성의 첫 증거로 사용한다.

### English

The earlier MVP aging test was a Playwright scenario that repeated: open a project, connect a provider, capture active logs, request suggestions and approve execution, then reload and verify project/task-history restore.

That spec was removed in the Sprint 17 frontend reset and has **not yet been re-created on the new shell**, so there is currently no automated aging evidence for the current UI. Re-establishing this scenario (and confirming reload-restore works against the per-store state files in `app_data_dir`) is required before claiming repeated-use stability. It still does not replace long-duration manual aging validation.

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

At the current stage, `gtum` satisfies the core MVP flows defined in the planning documents. The following remain post-MVP or later stabilization work:

- broader `Codex` login UX validation for cancellation, reconnect-after-expiry, and missing-scope states
- installed-app Windows/macOS validation, with Windows first
- signed and notarized macOS distribution
- expanded long-running manual aging validation
- Telegram external-channel integration

A code-verified state-persistence bug was found and fixed during the deployment-readiness review: the auth, workspace, and telegram stores previously resolved to the same `app_data_dir` directory path on installed builds and clobbered each other. They now persist to distinct files (`agent-auth.json`, `workspace-state.json`, `telegram-state.json`). A follow-on Windows launch blocker caused by a legacy file at the app-data root is also fixed and guarded by Rust unit tests. On-device verification of full reload-restore is still pending.

For the consolidated deployment/operation readiness assessment, open blockers, and the ship/no-ship verdict, see `docs/release-build-ci.md` (`Current Release Status Snapshot` through `First-Release Go / No-Go Matrix`).

# Release Readiness + Auto-Update Groundwork (subagent plan)

> Tier-4 "ship & operate" slice. Cross-platform first: **macOS (Apple Silicon + Intel) and Windows** are first-class; Linux is kept building but secondary.

**Goal:** Close the release/operate gaps so a `master` merge produces a trustworthy, version-gated, cross-platform release and the installed app has the foundation to update itself.

**Baseline (origin/dev `b6a1228`):**
- `release.yml`: matrix `ubuntu-22.04 / windows-latest / macos-latest`, `tauri-action`, tag `v__VERSION__`, env only `GITHUB_TOKEN`. Verifies Windows `.exe/.msi` and macOS `.app/.dmg`. **No Linux artifact check. No version-bump/tag-collision gate. No updater signing env.**
- Platform bundle targets pinned: `src-tauri/tauri.windows.conf.json` (nsis+msi), `src-tauri/tauri.macos.conf.json` (app+dmg). Base `tauri.conf.json`: `bundle.active=true, targets="all"`, `decorations:false`, version `0.1.0`. **No `plugins.updater`, no `createUpdaterArtifacts`.**
- `capabilities/default.json`: window controls granted; **no `updater:default`.**
- `Cargo.toml`: `tauri-plugin-log`, `tauri-plugin-dialog`. **No `tauri-plugin-updater`.**

## Task status (verified against origin/dev)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Version-bump/tag-collision CI gate + Linux artifact check | **TODO** | Real work — see Agent A |
| 2 | Backend persistence unit test (storage-path regression) | **DONE** | `lib.rs` `resolve_app_storage_dir`/`ensure_app_storage_dir` + 3 tests (missing dir, existing dir, **legacy-file migration**); managers join distinct files (`lib.rs:499–516`). Optional gap only — see Agent B |
| 3 | Auto-update pipeline groundwork (`tauri-plugin-updater`) | **TODO** | Real work, cross-platform critical — see Agent C |

Task 2 is already implemented and unit-tested on dev; this plan keeps it as a small **verify + optional gap-fill** so all three appear, but the substantive new work is Tasks 1 and 3.

## Conflict analysis → execution waves

Shared-state map: Task 1 and Task 3 both edit `release.yml`. Task 3 also edits `Cargo.toml`/`lib.rs`; Task 2's optional gap edits `Cargo.toml` (`[dev-dependencies]`) + `runtime/*.rs` (no `lib.rs`, no workflows).

- **Wave 1 (parallel, no file overlap):** Agent A (workflows) ‖ Agent B (`runtime/*.rs` + dev-deps).
- **Wave 2 (after Wave 1 merged to dev):** Agent C (updater) — layers its `release.yml` signing env on top of A, and its `Cargo.toml [dependencies]` on top of B.

Each agent runs in an isolated git worktree off the latest `dev` and produces **one PR into `dev`** with green checks. No agent edits another agent's files.

---

## Agent A — CI version gate + Linux artifact check (Task 1)

**Owns:** `.github/workflows/release.yml`, `.github/workflows/ci.yml`. **Touches nothing else.**

**Do:**
1. **Tag-collision gate** (release.yml): add a single pre-build job that reads `version` from `src-tauri/tauri.conf.json` and fails the run if tag `v<version>` already exists on the remote. Make the matrix `needs:` this job so it runs **once**, not per platform leg.
2. **Version-bump check** (ci.yml, PRs targeting `master`): fail if `src-tauri/tauri.conf.json` version did not increase vs `master`, and assert `package.json.version === src-tauri/tauri.conf.json.version` (sync guard).
3. **Linux artifact check** (release.yml): add an AppImage/deb/rpm presence step on the `ubuntu-22.04` leg, mirroring the existing Windows `.exe/.msi` and macOS `.app/.dmg` checks. Treat AppImage as best-effort (it has failed in this env) — fail only if none of AppImage/deb/rpm are produced.

**Cross-platform:** the gate/version checks are platform-agnostic and must not break any matrix leg; artifact checks stay per-OS (Windows nsis+msi, macOS app+dmg, Linux AppImage/deb/rpm).

**Verify:** `actionlint`/yaml parse clean; reason through each path (collision → fail; fresh version → pass); confirm checks are additive and don't change the publish step. Note in the PR that the gate is only fully exercised on a real `master` push.

**Return:** summary of workflow edits + how the gate/version-sync/Linux-check were implemented.

## Agent B — verify storage-path coverage + optional round-trip tests (Task 2)

**Owns:** `src-tauri/src/runtime/{workspace,auth,telegram}.rs` (test modules only), `src-tauri/Cargo.toml` (`[dev-dependencies]` only). **Must NOT edit `lib.rs` or workflows.**

**Do:**
1. Confirm the existing `lib.rs` tests cover the regression (missing dir / existing dir / legacy-file migration) and that managers join distinct filenames. If fully covered, state so.
2. **Optional gap-fill:** add per-manager persist → reload round-trip `#[cfg(test)]` tests — `initialize_storage(tmpfile)` → mutate → `persist` → re-`initialize_storage` → assert state restored; and assert three managers given the same dir resolve to three distinct files. Use a temp dir (OS-agnostic). Only add if a genuine gap exists; do not duplicate lib.rs coverage.

**Cross-platform:** use explicit temp paths so tests are deterministic on macOS/Windows/Linux; document that real `app_data_dir` differs per OS but the invariant (three distinct files, dir-not-file) holds everywhere.

**Verify:** `cargo test --manifest-path src-tauri/Cargo.toml` green.

**Return:** whether Task 2 was already complete, and any tests added.

## Agent C — auto-update pipeline groundwork (Task 3) — Wave 2

**Owns:** `src-tauri/Cargo.toml` (`[dependencies]`), `src-tauri/src/lib.rs` (plugin registration), `src-tauri/tauri.conf.json` (+ platform confs if needed), `src-tauri/capabilities/default.json`, `package.json`, `.github/workflows/release.yml` (signing env + latest.json). Branch off dev **after Wave 1 merges**.

**Do (groundwork only):**
1. Add `tauri-plugin-updater` (Rust) + `@tauri-apps/plugin-updater` (JS); register `.plugin(tauri_plugin_updater::Builder::new().build())` in `lib.rs`.
2. `bundle.createUpdaterArtifacts = true`; add `plugins.updater` with `endpoints` (GitHub Releases `latest.json`) and `pubkey`.
3. Add `updater:default` to `capabilities/default.json`.
4. Generate an updater signing keypair; wire `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secrets into the `tauri-action` env in `release.yml`; ensure `latest.json` publishes as a release asset. (This Tauri update signature is required on **all** platforms and is separate from OS code-signing.)
5. Minimal "check for update" call behind a runtime seam (e.g. `src/shared/api/runtimeUpdater.ts`) that no-ops in browser preview — **no full update-prompt UX yet**.

**Cross-platform (critical):**
- `latest.json` must serve **macOS Apple Silicon (`darwin-aarch64`) AND Intel (`darwin-x86_64`)** plus **Windows (`windows-x86_64`)** (and `linux-x86_64`). `macos-latest` is arm64 only — either build a **universal macOS binary** (`--target universal-apple-darwin`) or add a `macos-13` (Intel) matrix leg so Intel Macs are served. Pick one and document it.
- Windows updater artifact comes from the nsis/msi target (`tauri.windows.conf.json`); confirm `createUpdaterArtifacts` emits the `.sig` for it.

**Explicitly out of scope (later tasks):** full in-app update-prompt/restart UX; macOS notarization; Windows Authenticode code-signing.

**Verify:** `cargo check`; `npm run build`; locally `npm run tauri:bundle` (macOS) produces updater artifacts + `.sig`; `npm run test:e2e` green (updater seam no-ops in preview).

**Return:** summary of plugin/config/CI changes and the chosen macOS arch strategy.

---

## Integration & verification (orchestrator)

1. Wave 1: dispatch Agent A and Agent B in parallel (isolated worktrees off `dev`). Review summaries; open two PRs into `dev`; merge when green.
2. Wave 2: dispatch Agent C off the updated `dev`; review; open PR; merge when green.
3. Each PR: `npm run build`, `npm run test:e2e`, `cargo check`/`cargo test`, and CI green. Append a `## Why Log` if any decision was logged.
4. Update `docs/release-build-ci.md` readiness sections (version gate, Linux check, updater) to flip those items from "missing" toward "done" as each lands.

## Risks
- `release.yml` is edited by A then C — sequencing (Wave 2 after A) avoids the conflict; if run in parallel instead, integrate `release.yml` by hand.
- The tag-collision gate is only fully exercised on a real `master` push; validate logic by review + a `workflow_dispatch` dry run.
- macOS Intel coverage requires a universal build or an extra runner leg — decide in Agent C, don't silently ship arm64-only updates.

# State storage-path bug: root cause and fix approach

**Date:** 2026-06-01
**Status:** Accepted
**Scope:** `src-tauri/src/lib.rs` (Tauri setup closure)

## Context

While assessing deployment/operation readiness, a code-verified state-persistence bug was found. In the `lib.rs` setup closure, the storage path for the auth, workspace, and telegram managers is resolved with `app.handle().path().app_data_dir()` and only an `.or_else(...)` fallback that appends `.gtum/<file>.json`. `app_data_dir()` returns a *directory*; the `.or_else` only runs when it errors. Each manager treats the path as a *file* (`initialize_storage` → `fs::read_to_string`, `persist` → `fs::write`), so on a real installed build all three managers receive the identical `app_data_dir` path and clobber one another. The user approved fixing it as part of this change.

## Decision

Append a distinct filename to `app_data_dir()` for each manager *before* the `.or_else` fallback, so the happy path resolves to a real per-store file (`agent-auth.json`, `workspace-state.json`, `telegram-state.json`).

## Alternatives Considered

### A) Append a distinct filename per manager (chosen)
- **Description:** `app_data_dir().map(|dir| dir.join("agent-auth.json"))` before `.or_else(...)`, repeated per store.
- **Pros:** Minimal, localized to `lib.rs`; matches the filenames the fallback already uses; no manager changes.
- **Cons:** Three near-identical lines (acceptable; mirrors the existing structure).

### B) Create a `gtum/` subdirectory under `app_data_dir`
- **Description:** Place the three files inside `app_data_dir/gtum/`.
- **Cons:** `app_data_dir` is already app-scoped (`com.gagakor.gtum`), so a nested app-named subdir is redundant.

### C) One subdirectory per manager
- **Cons:** Extra nesting with no benefit for three single-file stores.

## Reasoning

The managers already `create_dir_all(parent)` (verified at `auth/mod.rs:34`, `workspace.rs:84`, `telegram.rs:146`), so giving each a distinct file under `app_data_dir` is sufficient and creates the directory as a side effect. Option A is the smallest correct change and aligns the happy path with the filenames the error fallback already expects.

## Trade-offs Accepted

- Three repeated `.map(...)` lines instead of a shared helper; kept inline to match the existing per-manager block style.

## Related Code Paths

- `src-tauri/src/lib.rs` — `setup(|app| { ... })` storage-path resolution for `AgentAuthManager`, `WorkspaceStateManager`, `TelegramBridgeManager`
- `src-tauri/src/runtime/auth/mod.rs`, `runtime/workspace.rs`, `runtime/telegram.rs` — `initialize_storage`/`persist` (treat path as file; unchanged)

## Consequences

- Auth, workspace, and telegram state now persist to separate files; workspace restore works on installed builds.
- A backend persistence/path-resolution test is recommended so this regression cannot recur silently (it passed `cargo check` previously).
- The readiness section in `release-build-ci.md` records this as a resolved P0 blocker.

## Decision Journey

### Initial Request
Deployment/operation readiness review; user approved "document + fix the storage-path bug + correct stale docs."

### Plan Evolution
- Bug surfaced by a read-only multi-agent verification pass and independently confirmed by reading `lib.rs`, `workspace.rs`, `auth/mod.rs`, `telegram.rs`.
- Fix scoped to `lib.rs` only after confirming all three managers create their parent directory and treat the path as a file.

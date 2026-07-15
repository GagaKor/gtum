# Agent Runtime Lifecycle Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every behavior change follows a RED -> GREEN -> REFACTOR loop, then receives specification and code-quality review.

**Goal:** Make approved Codex work observable, cancellable, and restorable as isolated agent-owned jobs while proving that the user-visible center terminal never changes, and make Codex/Claude onboarding match the providers that are actually available.

**Architecture:** The Tauri runtime owns a bounded `agent-jobs.json` store containing project-scoped job snapshots and log tails. Runtime restart converts previously running records to `interrupted` without relaunching a process. The React agent panel lists and polls only jobs belonging to the active runtime-backed project; it renders status, output, exit metadata, and cancellation entirely inside the right panel. `recordPermissionDecision -> create_agent_job` is the only approval execution path. Codex is available only through a validated local CLI session; Claude is explicitly deferred and cannot enter login or request flows.

**Tech Stack:** React 19, TypeScript, Vite, Tauri v2, Rust, serde JSON persistence, Playwright E2E, Cargo tests.

---

## Current Baseline

- Branch `audit-claude-codex-link` matches `origin/dev` at `428b612` before this plan.
- `AgentJobManager` supports create/read/cancel in memory, but has no list, durable history, restart normalization, or UI lifecycle consumer.
- The active approval path creates a job and prints only its ID. A dead `ApprovalModal/onApprove` path still contains center-terminal creation, focus, write, and execution logic.
- `Always allow` and execution-policy settings do not persist or affect the active approval path.
- Codex requests are not gated on provider connection state. Claude is deferred by policy but still looks connectable, and legacy persisted Claude state may remain connected after normalization.
- The Sprint 17 reset removed aging coverage while `docs/mvp-backlog.md` still calls the MVP complete.

## Non-Negotiable Invariant

Agent-panel requests, permission decisions, approved work, polling, cancellation, restoration, and failures must never create, focus, write to, close, reorder, or otherwise mutate the user-visible center terminal or workbench. They may use only the agent-owned job runtime, or show an unavailable/manual-run state.

## Acceptance Criteria

- An approved command invokes `create_agent_job` once and invokes no terminal runtime command.
- The right panel observes `running -> completed`, `running -> failed`, `running -> cancelled`, and restored `interrupted` states with bounded logs and exit metadata.
- Running jobs expose Cancel; terminal jobs do not. Log-read failures remain distinct from process failures.
- A fresh runtime manager restores bounded project job history, converts stored `running` jobs to `interrupted`, and does not relaunch them.
- Jobs are filtered by canonical project path and retained within explicit job/log limits.
- The center workbench DOM/state and terminal-runtime call log remain unchanged across approve, poll, finish, fail, cancel, and reload scenarios.
- Disconnected Codex cannot send a provider request and receives reconnect guidance. Claude is visibly deferred, has no Connect action, and invokes neither auth nor request APIs.
- `Always allow`, fake auto-approval controls, and the dead terminal-mutating approval implementation are removed.
- Focused Rust, service, UI, reload, and aging tests pass; full lint/build/Playwright/Cargo verification passes.

## Explicitly Out Of Scope

- Claude login, adapter, or request implementation.
- Resuming or relaunching subprocesses after app restart.
- Auto-approval, scheduler, or persisted allow rules.
- Full PTY/workbench restore, Telegram, updater, release publishing, or a full FSD rewrite.
- Native Windows sign-off that cannot be performed from this macOS workspace; the missing evidence must remain documented.

## Team Ownership

- `Planner`: scope, product policy, prior sprint/validation gaps, and Definition of Done.
- `Orchestrator`: contract sequence, file ownership, integration, and review gates.
- `Backend`: `agent_jobs.rs`, `auth/mod.rs`, command registration, and Rust tests.
- `Frontend/Designer`: runtime services, lifecycle hook, right-panel job activity, truthful approval/provider surfaces, and `prototype.jsx` ownership.
- `QA/Tester`: service tests, center-terminal invariant tests, reload/aging coverage, and validation evidence.

---

## Task 1: Persist And Restore Agent-Owned Job History

**Files:**
- Modify: `src-tauri/src/runtime/agent_jobs.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/runtime/agent_jobs.rs`

- [x] **Step 1: Write failing Rust tests for status truth and persistence**

Add tests that require:

```rust
enum AgentJobStatus {
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

struct AgentJobStore {
    storage_version: u32,
    jobs: Vec<PersistedAgentJob>,
}

struct PersistedAgentJob {
    snapshot: AgentJobSnapshot,
    logs: Vec<AgentJobLogEntry>,
}

struct AgentJobLogEntry {
    sequence: u64,
    stream: AgentJobLogStream,
    text: String,
    recorded_at: u64,
}
```

Cover zero exit -> `Completed`, non-zero exit -> `Failed`, bounded job/log retention, project filtering, completed/failed/cancelled/interrupted round trips, restored structured-log fidelity, and stored `Running`/`Cancelling` -> `Interrupted` on a fresh manager. Assert restore never spawns a process.

Also cover the concurrency boundary: a job cannot publish a terminal state until the process exit has been observed and both stdout/stderr readers have drained and flushed their pending bytes. Repeated cancellation must be idempotent (`running -> cancelling -> cancelled`), and cumulative `logLineCount` must remain correct after ring-buffer eviction.

- [x] **Step 2: Run the tests and confirm RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::agent_jobs::tests -- --nocapture
```

Expected: FAIL because the store, terminal statuses, initialization, and list contract do not exist.

- [x] **Step 3: Implement the bounded durable manager**

Add `initialize_storage(path)`, atomic temp-file replacement following the repository's cross-platform state-file convention, `list_jobs(project_path, limit)`, and persistence after create/output/exit/cancel. Keep `Child` handles runtime-only and optional so restored terminal records remain readable but cannot be resumed.

Loading malformed, truncated, or unknown-version JSON must never prevent app startup. Preserve the unreadable file under a diagnostic backup name, start from an empty supported store, and test each case. Route all writes through one serialized writer with a short coalescing window for output bursts; lifecycle terminal transitions synchronously flush the latest state before becoming externally terminal.

Use explicit bounds:

```rust
const MAX_PERSISTED_JOBS: usize = 100;
const DEFAULT_LIST_LIMIT: usize = 25;
const MAX_LIST_LIMIT: usize = 100;
```

Keep the existing per-job `max_log_entries` clamp. Extend snapshots/log reads with `finished_at`, `cancellation_requested_at`, `logs_complete`, `exit_code`, and `last_event` so the UI does not infer process outcome or final-log completeness from text. Track reader completion independently from process exit; terminal state requires both. Capture command/stdout/stderr/system log entries with stable sequence numbers so inter-stream order and cumulative counts survive eviction and restart.

Use one canonical project-path ownership helper across create, list, read, cancel, persistence restore, and command handlers. Read and cancel commands must require `projectPath`; a job ID alone is not authority. Test aliases, trailing separators, and cross-project denial.

- [x] **Step 4: Register project-scoped listing and initialize storage**

Expose:

```rust
#[tauri::command]
fn list_agent_jobs(
    state: tauri::State<'_, AgentJobManager>,
    project_path: String,
    limit: Option<usize>,
) -> Result<Vec<AgentJobSnapshot>, String>;
```

`read_agent_job_logs` and `cancel_agent_job` likewise require `project_path` and reject a job owned by any other canonical project.

Initialize `agent-jobs.json` beside the existing runtime state files during app setup. Do not share the center-terminal manager or PTY state.

- [x] **Step 5: Verify GREEN and refactor**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml runtime::agent_jobs::tests -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all pass.

---

## Task 2: Add A Typed Job Lifecycle Service And Right-Panel Activity

**Files:**
- Modify: `src/shared/api/runtimeAgentJobs.ts`
- Create: `src/features/agents/model/useAgentJobLifecycle.ts`
- Create: `src/features/agents/ui/AgentJobActivity.tsx`
- Modify: `src/prototype.jsx`
- Modify: `src/styles.css`
- Modify: `tests/e2e/runtime-agent-jobs-service.spec.ts`
- Modify: `tests/e2e/design-prototype.spec.ts`

- [x] **Step 1: Write failing service tests**

Require `listProjectJobs(project, limit)`, extended log metadata, fallback behavior for non-runtime projects, and exact Tauri payloads. Assert no service method invokes a terminal command.

- [x] **Step 2: Write failing UI lifecycle tests**

Extend the approval fixture so it controls `create_agent_job`, `list_agent_jobs`, `read_agent_job_logs`, and `cancel_agent_job`. Add assertions for:

- running row with command, logs, and Cancel;
- completed/failed terminal rows with exit metadata and no Cancel;
- cancellation preserving prior logs;
- project reload hydration and `interrupted` display;
- `.center` HTML/state snapshot unchanged and `__terminalCalls` empty throughout.

- [x] **Step 3: Run focused tests and confirm RED**

```bash
npm run test:e2e -- tests/e2e/runtime-agent-jobs-service.spec.ts
npm run test:e2e -- tests/e2e/design-prototype.spec.ts --grep "agent job|approved Codex|cancel"
```

Expected: FAIL because list/hydration/polling/cancel UI does not exist.

- [x] **Step 4: Implement the lifecycle hook**

The hook owns a project/session-scoped job map and exposes:

```ts
type UseAgentJobLifecycleResult = {
  jobs: AgentJobView[]
  hydrateProject(project: RuntimeProject): Promise<void>
  registerJobs(snapshots: AgentJobSnapshot[], context: JobContext): void
  cancelJob(jobId: number): Promise<void>
}
```

Poll `running` and `cancelling` jobs, stop only at a terminal status with `logsComplete === true`, perform one final atomic log read, deduplicate concurrent reads, and keep `logError` separate. Immediately register newly created snapshots before awaiting hydration/polling. Support a test-only polling interval override without changing production defaults.

Every timer, in-flight read, and hydration generation must be scoped to the active project/session. On project switch, session switch, unmount, or a newer hydration request, cancel timers and ignore stale responses. Add race tests that resolve old-project reads after the new project is active and prove that no stale row is inserted.

- [x] **Step 5: Render compact job activity only inside the Agent panel**

`AgentJobActivity.tsx` renders name/ID, command, status, exit code, bounded log tail, read error, and Cancel. Associate rows with the project and agent session that started them. Do not pass job state or callbacks into `Workspace` or center components.

- [x] **Step 6: Verify GREEN and refactor**

```bash
npm run lint
npm run build
npm run test:e2e -- tests/e2e/runtime-agent-jobs-service.spec.ts
npm run test:e2e -- tests/e2e/design-prototype.spec.ts --grep "agent job|approved Codex|cancel"
```

Expected: all pass.

---

## Task 3: Make Approval And Provider Onboarding Truthful

**Files:**
- Modify: `src-tauri/src/runtime/auth/mod.rs`
- Modify: `src/shared/api/runtimeAgentAuth.ts`
- Modify: `src/prototype.jsx`
- Modify: `src/styles.css`
- Delete: `src/features/agents/model/approval-policy.ts` if no live import remains
- Modify: `tests/e2e/runtime-agent-auth-service.spec.ts`
- Modify: `tests/e2e/design-prototype.spec.ts`

- [x] **Step 1: Write failing auth normalization tests**

Add `availability: "available" | "deferred"` to the contract. Write a Rust round-trip test that loads a legacy connected Claude snapshot and requires normalized output to be `availability: deferred`, non-connected, account-cleared, and carrying explicit deferred guidance.

- [x] **Step 2: Write failing provider/approval UI tests**

Require:

- disconnected/error Codex sends no `request_agent_suggestions` call and shows connect/reconnect guidance;
- Claude Settings row says `Coming later`/`Deferred`, has no Connect or Disconnect action, and makes zero auth/request calls;
- the permission panel contains only `Allow once` and `Deny`;
- no legacy approval modal, auto-approval toast, or terminal-target execution path is rendered/reachable.

- [x] **Step 3: Run focused tests and confirm RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml runtime::auth::tests -- --nocapture
npm run test:e2e -- tests/e2e/runtime-agent-auth-service.spec.ts
npm run test:e2e -- tests/e2e/design-prototype.spec.ts --grep "Codex setup|disconnected Codex|Claude|approved Codex"
```

Expected: FAIL for availability, legacy normalization, and current controls.

- [x] **Step 4: Normalize availability defensively in the backend**

Codex is `available`; Claude is always `deferred` until a later product decision. `begin_login(Claude)` returns the deferred snapshot without creating login state. Loading a legacy Claude connection cannot preserve `connected`, account, callback, or OAuth fields.

- [x] **Step 5: Remove deceptive and unsafe frontend paths**

Delete `ApprovalModal`, `approval` state/render, `onApprove`, its center-terminal helpers, `Always allow`, auto-approval toast/log, and inactive policy controls. Replace Execution settings with read-only truth:

> Every command requires review. Approved work runs as an isolated Agent job. The center terminal is never touched.

Gate Codex requests on `provider.state === "connected"`. Render Claude as deferred with a disabled `Coming later` affordance. Browser preview must not simulate OAuth success.

- [x] **Step 6: Verify GREEN and refactor**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml runtime::auth::tests -- --nocapture
npm run lint
npm run build
npm run test:e2e -- tests/e2e/runtime-agent-auth-service.spec.ts
npm run test:e2e -- tests/e2e/design-prototype.spec.ts --grep "Codex setup|disconnected Codex|Claude|approved Codex"
```

Expected: all pass.

---

## Task 4: Restore Aging Coverage And Synchronize Source-Of-Truth Docs

**Files:**
- Modify: `tests/e2e/design-prototype.spec.ts` or create `tests/e2e/agent-runtime-aging.spec.ts`
- Modify: `docs/product-plan.md`
- Modify: `docs/technical-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/message-flow.md`
- Modify: `docs/design-system.md`
- Modify: `docs/mvp-backlog.md`
- Modify: `docs/sprint-plan.md`
- Modify: `docs/MVP_VALIDATION_NOTES.md`

- [x] **Step 1: Write an aging regression and confirm RED if behavior is incomplete**

Repeat at least 10 bounded cycles of approve -> running -> complete/fail/cancel, switch/reopen project context, and reload/hydrate. Assert one job per approval, bounded row count, no duplicate polling after terminal states, no terminal calls, and no center-workbench mutation.

```bash
npm run test:e2e -- tests/e2e/agent-runtime-aging.spec.ts
```

- [x] **Step 2: Make only behavior fixes exposed by the aging test**

Do not broaden scope. Fix timer cleanup, deduplication, retention, restore ordering, or stale project/session filtering only as evidence requires.

- [x] **Step 3: Update canonical documentation in English**

Document:

- Codex-first and explicit Claude-deferred availability;
- isolated agent-job execution and the center-terminal invariant;
- `agent-jobs.json`, list/read/cancel contracts, retention, and restart interruption semantics;
- removal of non-persisted `Always allow`/auto-approval claims;
- current MVP status as stabilization incomplete until aging and native Windows evidence exist;
- exact automated evidence from this task and the still-pending Windows installed-app sign-off.

When materially editing a legacy bilingual section, consolidate that edited section to English instead of adding another duplicate translation.

- [x] **Step 4: Verify the focused slice**

```bash
npm run test:e2e -- tests/e2e/agent-runtime-aging.spec.ts
npm run test:e2e -- tests/e2e/runtime-agent-jobs-service.spec.ts tests/e2e/runtime-agent-auth-service.spec.ts
```

Expected: all pass.

---

## Task 5: Final Verification And Review

- [x] **Step 1: Run the full automated gate from a clean process state**

```bash
npm run lint
npm run build
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

2026-07-14 result: lint, production build, all 90 Playwright tests, all 73 Rust tests, native Cargo check, Windows-target Cargo check, and the macOS native release build pass. The four changed Rust files pass `rustfmt --check`. Repository-wide `cargo fmt --check` reports pre-existing differences only in unchanged `runtime/platform/mod.rs`, `runtime/pty/mod.rs`, and `runtime/workspace.rs`; those files remain out of scope and untouched.

- [x] **Step 2: Inspect the complete diff against the target branch**

```bash
git diff --check
git diff --stat origin/dev...
git diff origin/dev... -- src src-tauri tests docs
```

- [x] **Step 3: Request independent code review**

Review specifically for process/persistence races, lock ordering, path scoping, timer cleanup, stale restore state, misleading provider state, and any path that can mutate the center terminal.

- [x] **Step 4: Record honest limitations**

Do not claim Claude integration, cross-platform completion, or MVP completion. Report macOS automated/native evidence separately from pending Windows installed-app and soak evidence.

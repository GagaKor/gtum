# Production Readiness Remediation Order

**Date:** 2026-07-27
**Status:** Accepted
**Scope:** Repository-wide — legal metadata, CI workflows, release pipeline, IPC/security layer

## Context

A production-readiness assessment of GTUM (4 months, 165 commits, v0.1.0) found the Rust runtime
layer to be service-grade, but identified hard blockers in three categories: legal (no LICENSE, no
privacy policy), security (four High findings including ungated IPC that permits arbitrary command
execution from the renderer), and distribution (no code signing, no auto-updater, a release pipeline
that publishes partial releases). Additionally, `dev` CI was red and `master` was 161 commits stale.

Everything cannot be fixed at once. The sequencing question is which blocker to clear first when the
most *severe* finding (security) is not the *cheapest* or the most *unblocking* one.

## Decision

Remediate in the order **B → A → E → C**: legal metadata first, then the failing CI, then the
release pipeline defects, then the four High security findings.

## Alternatives Considered

### Severity-first (C → E → A → B)
- **Description:** Fix the four High security findings first, since ungated IPC is an RCE-class defect.
- **Pros:** Addresses the highest-impact risk immediately; no window where a known RCE ships.
- **Cons:** The security fixes are the largest and most invasive change (IPC authorization model,
  path confinement, risk scoring, CSP). Landing them on a red CI means no trustworthy signal that
  the fixes work. Meanwhile the trivial legal exposure stays open for the whole multi-day effort.

### CI-first (A → B → E → C)
- **Description:** Fix the Windows CI failure first to restore a green baseline, then proceed.
- **Pros:** Restores the verification signal before any other change lands.
- **Cons:** The CI failure is a `STATUS_ENTRYPOINT_NOT_FOUND` dynamic-link fault of unknown depth —
  it could take hours or days. Blocking a five-minute legal fix behind an open-ended investigation
  inverts cost/benefit.

### Cost-then-signal-then-safety (B → A → E → C) — chosen
- **Description:** Clear the near-zero-cost legal blocker, restore CI, make the release pipeline safe
  to run, then land the security work against a green, gated pipeline.
- **Pros:** Removes legal exposure immediately; each step restores a guarantee the next step depends on.
- **Cons:** The known RCE-class findings remain open longest.

## Reasoning

The ordering follows dependency, not severity. Security fixes need a trustworthy verification signal,
which requires green CI (A); and they need a release pipeline that will not publish a half-finished
build, which requires E. Doing C first would mean landing the most invasive change with no way to
confirm it. B is sequenced first purely because it costs minutes and eliminates a category of risk
outright — there is no reason to carry legal exposure through a multi-day security effort.

The accepted risk is bounded: GTUM is not publicly distributed today (tag `v0.1.0` is the only
release, and the guard job currently blocks new ones), so the ungated-IPC finding has no live
user-facing exposure while C is pending.

## Trade-offs Accepted

- The four High security findings stay open longest, despite being the most severe. Acceptable
  because the app is not currently distributed, so exposure is theoretical until a release ships.
- E (release pipeline) is fixed before C (security), meaning the pipeline is made *safe to run*
  before the payload it ships is made *safe to install*. This is deliberate: it prevents an
  accidental publish during the security work.

## Related Code Paths

- `LICENSE`, `src-tauri/Cargo.toml`, `package.json` — step B, legal metadata
- `.github/workflows/ci.yml` — step A, Windows install smoke job
- `.github/workflows/release.yml` — step E, draft-then-publish and verify-before-publish ordering
- `src-tauri/src/lib.rs`, `src-tauri/src/runtime/filesystem/mod.rs`,
  `src/shared/api/runtimeAgentSuggestions.ts`, `src-tauri/tauri.conf.json` — step C, security findings

## Consequences

- No public release may be cut until C completes; the release pipeline should stay effectively gated
  even after E makes it mechanically sound.
- Auto-updater work is deliberately excluded from this sequence. It depends on code signing, which
  requires purchased certificates, and is therefore a separate track.
- The remaining product-completeness gaps (missing left-menu views, dead Telegram module, absent
  worktree isolation) are out of scope here and remain unscheduled.

## Decision Journey

### Initial Request
The user asked whether GTUM had reached a level where it could be offered as a service.

### Plan Evolution
- Assessment produced five candidate work items (A–E) rather than a single answer, because the
  blockers spanned unrelated subsystems.
- An ordering was recommended on cost/dependency grounds rather than severity; the user approved it
  without modification.

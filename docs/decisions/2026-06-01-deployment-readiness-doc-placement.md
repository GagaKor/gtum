# Placement of deployment & operations readiness content

**Date:** 2026-06-01
**Status:** Accepted
**Scope:** `docs/release-build-ci.md` (+ stale-narrative corrections in `docs/MVP_VALIDATION_NOTES.md`, `docs/README.md`)

## Context

The user asked to document current project progress, remaining work, and everything needed for the software to be successfully deployed and operated, as English-only agent-facing documentation. The repo already has a canonical release/build/CI doc (`docs/release-build-ci.md`) and a validation-status doc (`docs/MVP_VALIDATION_NOTES.md`), and a convention-heavy routing system (`AGENTS.md`, `docs/README.md`, `docs/DOCS_READING_ORDER.md`).

## Decision

Integrate the deployment & operations readiness content into the existing `docs/release-build-ci.md` rather than creating a new dedicated document.

## Alternatives Considered

### A) New dedicated `docs/deployment-readiness.md` + routing registration
- **Description:** A standalone readiness doc registered in README index/routes, AGENTS.md routing + sync map, and DOCS_READING_ORDER.
- **Pros:** Clean single-purpose doc; matches the `update-deployment-readiness-doc` branch name; keeps `release-build-ci.md` from growing.
- **Cons:** Requires editing 3 routing docs; readiness overlaps heavily with the release/CI/updater spec already in `release-build-ci.md`, risking duplication/drift.

### B) Integrate into existing `docs/release-build-ci.md` (chosen)
- **Description:** Append readiness status, a core-deployment checklist, verified blockers, and a Go/No-Go matrix into the existing release doc; update its Long-Doc Routing header.
- **Pros:** Co-locates all deploy knowledge in one routed source of truth; reuses the existing (unimplemented) auto-update + signing spec; no new-doc routing-table churn.
- **Cons:** The doc grows past its current 255 lines, so the Long-Doc Routing section must be kept current.

### C) Integrate into `docs/MVP_VALIDATION_NOTES.md`
- **Description:** Extend the validation-notes doc with deployment readiness.
- **Cons:** That doc is about validation/aging coverage, not release mechanics; deployment readiness would be off-topic there.

## Reasoning

The user explicitly selected B. `release-build-ci.md` is already the canonical home for build, bundling, GitHub Release flow, versioning rules, and the auto-update specification, so readiness status belongs alongside it and avoids duplicating release mechanics across docs. The repo convention favors cross-reference over duplication.

## Trade-offs Accepted

- `release-build-ci.md` becomes longer; mitigated by updating its Long-Doc Routing header so sections stay discoverable under the minimal-read-pack convention.
- We forgo the branch-name-aligned standalone doc in favor of less routing churn and less overlap.

## Related Code Paths

- `docs/release-build-ci.md` — receives the new readiness sections + routing update
- `docs/MVP_VALIDATION_NOTES.md` — stale-test references corrected
- `docs/README.md` — restore-related wording corrected post-fix

## Consequences

- Future deployment-readiness updates land in `release-build-ci.md`, not a separate file.
- No new entries needed in the routing docs beyond the in-file Long-Doc Routing update.

## Decision Journey

### Initial Request
User (Korean): review progress, list done/remaining, list what is needed for successful deployment & operation, and update docs (English-only, for agents).

### Plan Evolution
- Initial plan proposed a new `docs/deployment-readiness.md` with full routing registration.
- After clarifying questions, the user chose to integrate into `release-build-ci.md`, scope coverage to core deployment, and also fix the discovered storage bug + correct stale docs. The new-doc + routing-registration steps were dropped.

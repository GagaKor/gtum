# MIT License Selection

**Date:** 2026-07-27
**Status:** Accepted
**Scope:** Distribution and legal metadata — `LICENSE`, `src-tauri/Cargo.toml`, `package.json`

## Context

GTUM shipped tag `v0.1.0` with no LICENSE file, `license = ""` in `src-tauri/Cargo.toml:6`, and no
`license` field in `package.json`. Under default copyright, users receiving a distributed binary have
no legal right to use or redistribute it, and the deb/rpm bundles carry no license metadata. This is
a hard distribution blocker independent of any technical readiness work.

Because the project is a Tauri desktop app that orchestrates third-party AI CLIs, the license also
determines how freely the binary and its source can be redistributed by others.

## Decision

Apply the **MIT License**, with copyright attributed to **GagaKor** as a personal project.

## Alternatives Considered

### Apache-2.0
- **Description:** Permissive, with an explicit patent grant and contributor patent-retaliation clause.
- **Pros:** Better protection for enterprise adopters; explicit patent terms; standard for
  company-backed open source.
- **Cons:** Longer and more procedurally demanding (requires NOTICE handling and change statements).
  The patent grant is the main differentiator, and this project holds no patents.

### Proprietary (All Rights Reserved)
- **Description:** No redistribution rights granted; source visible but not licensed for reuse.
- **Pros:** Preserves all commercialization options.
- **Cons:** Inconsistent with an already-public GitHub repository. Would also require a separate EULA
  before any binary distribution, adding work rather than removing a blocker.

### GPL-3.0
- **Description:** Copyleft — derivative works must also be released under GPL-3.0.
- **Pros:** Prevents closed-source forks.
- **Cons:** Copyleft obligations propagate to anyone embedding the app, which is disproportionate for
  a desktop tool and would deter adoption.

## Reasoning

MIT was selected as the shortest path from "no license at all" to "legally distributable," which is
what the blocker actually required. The patent grant that distinguishes Apache-2.0 has no practical
value for a project with no patent portfolio, and copyleft was not a goal. Attribution to GagaKor
personally rather than to an employer matches the repository's existing `authors = ["GagaKor"]` and
the project's status as personal work, avoiding an implied corporate work-for-hire claim.

## Trade-offs Accepted

- MIT permits closed-source forks and commercial redistribution by third parties without reciprocity.
  Accepted as the cost of the simplest viable license.
- No explicit patent grant. Acceptable given no patents exist; relicensing to Apache-2.0 later is
  possible while the copyright holder remains a single individual.
- Attributing copyright to an individual rather than a company constrains later transfer to a
  corporate entity, which would require an explicit assignment.

## Related Code Paths

- `LICENSE` — new file, MIT text with GagaKor as copyright holder
- `src-tauri/Cargo.toml` — `license` field, currently the empty string at line 6
- `package.json` — `license` field, currently absent

## Consequences

- Third-party dependency attribution is still outstanding. MIT covers GTUM's own code; the Rust and
  npm dependency trees carry their own MIT/Apache-2.0 attribution obligations that a future NOTICE
  file must satisfy.
- Choosing MIT does not resolve the separate Anthropic-approval question for distributing the Claude
  CLI-session authentication path, which remains an open compliance blocker.
- Relicensing later requires only the single copyright holder's consent, so this decision stays cheap
  to reverse until outside contributors accumulate.

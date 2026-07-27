# Suggestion Risk Rated From Command Text

**Date:** 2026-07-27
**Status:** Accepted
**Scope:** Agent suggestion approval flow — `src/shared/api/runtimeAgentSuggestions.ts`

## Context

The approval card shows a risk badge next to every command an agent suggests, and it is
the only decision-support signal a user gets before allowing that command to run. The badge
was computed by `riskFromConfidence`, which mapped the model's self-reported `confidence`
field to a risk level: `low` confidence became `mid` risk, and everything else became `low`.

This had two consequences. `'high'` was unreachable, so the "Destructive commands and
production deploys" UI strings were dead code. More seriously, `confidence` is authored by
the same provider response that supplies the command, so a prompt-injected `rm -rf ~`
returned with high confidence was rendered as a green "low risk" badge. A test added during
this work confirmed the behaviour: `riskOf('rm -rf /', 'high')` returned `'low'`.

## Decision

Rate a suggestion by analysing the command text against the risk taxonomy the UI already
advertises, take the maximum rating across chained and multi-line segments, and treat low
model confidence only as a floor that can raise the rating but never lower it.

## Alternatives Considered

### Keep confidence as the primary signal, add a destructive-command override
- **Description:** Preserve the existing mapping and special-case a short denylist (`rm -rf`, `dd`) to `high`.
- **Pros:** Smallest diff; existing behaviour and tests mostly unchanged.
- **Cons:** Keeps an attacker-controlled value as the primary input. Any command outside the
  denylist is still rated by the model's own opinion of its answer, so the core defect survives.

### Rate purely from the command text, drop confidence entirely
- **Description:** Remove the `confidence` input from risk computation.
- **Pros:** Simplest rule; one input, fully deterministic and inspectable.
- **Cons:** Discards a genuinely useful signal. When the model itself reports low confidence,
  the suggestion warrants more scrutiny even if the command looks benign, and that nuance
  was the one defensible part of the original design.

### Command text as primary, confidence as a raise-only floor — chosen
- **Description:** `max(riskFromCommand(command), confidence === 'low' ? 'mid' : 'low')`.
- **Pros:** The command decides the rating; confidence can only add caution. Preserves the
  existing "low confidence deserves a second look" behaviour without letting it mask danger.
- **Cons:** Two inputs instead of one, so the rule needs a comment explaining the asymmetry.

## Reasoning

The decisive property is monotonicity: no value the provider controls may *lower* a rating.
Making the command text primary and confidence raise-only guarantees this, which the pure
denylist approach does not. Rating by the maximum across segments addresses a second path to
the same failure — the card renders a multi-line or `&&`-chained command as one string, so a
trailing `&& rm -rf ~` would otherwise inherit the harmless leading segment's rating. Shapes
that lose meaning when split, such as `curl … | sh`, are matched against the whole command
before segmentation.

## Trade-offs Accepted

- Pattern matching is a heuristic and will both miss novel destructive commands and
  occasionally over-report. It is tuned to fail toward over-reporting, and the code comment
  states explicitly that it is decision support, not an execution boundary.
- The pattern lists need maintenance as tooling changes. Accepted because the alternative —
  trusting a model-authored field — has no failure mode that is recoverable by the user.

## Related Code Paths

- `src/shared/api/runtimeAgentSuggestions.ts` — `riskFromCommand`, `riskFromSuggestion`,
  and the `HIGH_RISK_*` / `MID_RISK_SEGMENT` pattern lists that replaced `riskFromConfidence`
- `tests/e2e/runtime-agent-suggestions-service.spec.ts` — six tests covering each taxonomy
  tier, the confidently-stated destructive command, and the chained/multi-line case
- `src/prototype.jsx` — `highestSuggestionRisk` can now actually return `"high"`, so the
  previously dead `riskHigh` / `riskHighDesc` strings render

## Consequences

- The `"high"` badge now appears in the UI for the first time. Any visual regression baseline
  that assumed only `low`/`mid` badges needs refreshing.
- This closes one of four High security findings from the readiness assessment. It does not
  address the ungated IPC surface, which is what makes a mis-rated command dangerous in the
  first place; the approval gate remains the only barrier until that work lands.
- A follow-up should apply the same segment-splitting logic to the command actually executed,
  so that what runs cannot exceed what was rated and shown on the card.

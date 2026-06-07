# Brain OS : Weekly Scorecard

Run a repeatable weekly health check. Score Brain OS out of 100. Compare week-over-week.

## Arguments

`$ARGUMENTS` — optional entity scope (default: `my-project`). Pass `all` to score globally.

## Tool sequence

Run all five reads first, then score:

1. `mcp__brain-os__entity_read(entity_id="my-project")` — momentum, mode, staleness
2. `mcp__brain-os__memory_check(entity_id="my-project")` — overdue reviews, contradiction signals
3. `mcp__brain-os__decision_review(entity_id="my-project", root_path="<cwd>")` — overdue decisions, placeholder proof actions
4. `mcp__brain-os__semantic_recall("tester feedback onboarding first-session value Brain OS", max_results=5)` — user signal
5. `mcp__brain-os__pattern_detect(scope="recent")` — active patterns, shipping vs. self-correction balance

## Scoring rubric (100 points)

### 1. Memory Hygiene — 20 pts
| Score | Condition |
|-------|-----------|
| 20 | No contradictions; `my-project` overdue reviews = 0; global overdue trending down; no placeholder proof actions |
| 15 | No contradictions; `my-project` overdue reviews 1–3 |
| 10 | No contradictions; overdue reviews accumulating |
| 0–5 | Contradictions present or obvious stale/unsafe state |

### 2. Reasoning Quality — 20 pts
| Score | Condition |
|-------|-----------|
| 20 | Decisions have `why`, `assumptions`, `invalidate_if`, real `proof_action`; review-trigger behavior working |
| 15 | Mostly strong; some placeholder or duplicate decisions remain |
| 10 | Works but inconsistent or noisy |
| 0–5 | Decisions vague, non-testable, or hard to trust |

### 3. Reliability / Trust — 20 pts
| Score | Condition |
|-------|-----------|
| 20 | Tests green; no corruption bugs active; audit clean; no dangerous memory signals |
| 15 | Mostly stable; minor rough edges |
| 10 | Recurring tool bugs or trust breaks |
| 0–5 | Users cannot trust outputs |

### 4. Actionability — 15 pts
| Score | Condition |
|-------|-----------|
| 15 | Clear next move; usable focus/reconcile output; system helps user decide what to do now |
| 10 | Useful but requires manual interpretation |
| 5 | Smart but not operationally helpful |

### 5. Onboarding / Felt Intelligence — 15 pts
| Score | Condition |
|-------|-----------|
| 15 | New user sees value before or during setup |
| 10 | Value becomes clear only after setup or after a few days |
| 5 | User needs developer environment or walkthrough to understand it |

### 6. Self-Propulsion — 10 pts
| Score | Condition |
|-------|-----------|
| 10 | System actively keeps itself clean; nudges review debt down |
| 7 | Some nudges exist; cleanup depends on user remembering |
| 3 | Shipping outpaces self-correction |
| 0 | No self-maintenance behavior |

## Output format

```
==============================
  BRAIN OS SCORECARD
  Week of [YYYY-MM-DD]
==============================

  Memory Hygiene         [score]/20
  Reasoning Quality      [score]/20
  Reliability / Trust    [score]/20
  Actionability          [score]/15
  Onboarding / Felt      [score]/15
  Self-Propulsion        [score]/10
  ─────────────────────────────────
  TOTAL                  [score]/100

  Key signals:
  - [1–3 bullet observations from the tool reads]

  Top 1–2 actions to raise the score:
  - [Specific, concrete fix with tool to call]
  - [Specific, concrete fix with tool to call]
==============================
```

## Rules

- Pull scores only from the five MCP tool reads above. Do not guess.
- Cite the specific tool output that drove each score (e.g. "memory_check returned 4 overdue → Memory Hygiene: 15").
- If tester feedback in semantic_recall is older than 4 weeks, note it may be stale.
- Save the score to entity state: `mcp__brain-os__entity_update(entity_id="my-project", updates={ evidence_of_progress: "Scorecard [date]: [total]/100" })`.
- Every scorecard run should take under 5 minutes.

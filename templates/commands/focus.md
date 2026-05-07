# Brain OS : Focus Engine

Answer the question: "What should I work on today, and why?"

Not a dashboard. A judgment call backed by evidence.

## Input

Arguments: `$ARGUMENTS` (optional : a constraint like "only 2 hours" or "low energy today")

## How

Call the Brain OS MCP tool `focus_get` (pass the user's constraint as context if given). Read returned entities and decisions. Do not read code, repos, or `CLAUDE.md` files.

If you need additional context, call `entity_read` for individual entities or `pattern_detect` for active patterns.

## What to weigh

- **Staleness**: days since `last_updated` for each active entity
- **Momentum**: from the entity, or inferred from update frequency and `evidence_of_progress`
- **Blockers**: anything preventing forward movement
- **Strategic leverage**: does this entity unlock others?
- **Urgency**: deadlines, people waiting, decay risk
- **Recent decisions**: anything that constrains or directs the work
- **User constraint**: if given, weight low-friction options higher

## Output

```
========================================
  TODAY'S FOCUS
========================================

## 1. [Entity name] : [one-line action]

  Why this matters:
  [2 to 3 sentences : strategic reason, not "it's overdue"]

  Evidence:
  - [from entity, decision, or pattern]
  - [from entity, decision, or pattern]

  Next move:
  [one concrete action, not "think about X"]

  Timebox:
  [60 to 120 minutes]

## 2. [optional second priority]
  ...

========================================
  DO NOT DO TODAY
========================================
  - [thing that feels productive but isn't]
  - [shiny new idea to resist]
  - [reorganization that can wait]

========================================
  STALENESS ALERT
========================================
  [list any active entities aging/stale/dormant]
  [if none, omit this section]
========================================
```

## Rules

- Maximum 3 priorities. Usually 1 is best.
- Every priority needs a concrete next action, not "continue working on X".
- "Do not do today" is mandatory. The problem is too many realities, not too few.
- If nothing is urgent, say so. "Low-urgency day, pick what has energy" is a valid output.
- If a proof action from a decision hasn't been done, surface it.
- If an active entity is stale but has no blocker, call it fake-active. Recommend: ship something or park it.
- Never guilt-trip about parked entities. Parked is intentional.
- Do not read code or `CLAUDE.md`. MCP tools only.
- After output, ask: "Ready to start?"

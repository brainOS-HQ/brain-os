# Brain OS : Focus Engine

"What should I work on today, and why?"

Not a dashboard. A judgment call backed by evidence.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. It governs tool routing for every Brain OS skill.

## Input

Arguments: `$ARGUMENTS` (optional constraint like "only 2 hours" or "low energy today")

## Primary tool sequence

1. `mcp__brain-os__focus_get(constraints=$ARGUMENTS)` : prioritized recommendations across all entities
2. `mcp__brain-os__entity_read(top_pick.entity_id)` : detail on the #1 priority
3. `mcp__brain-os__decision_check(top_pick.next_move, top_pick.entity_id)` : verify no active decision contradicts the recommendation

The `focus_get` tool returns: prioritized entities with scores and reasons, `do_not_do` list, staleness alerts, unreviewed decisions. Use that data first. Only fall back to `entity_read` / `pattern_detect` / `semantic_recall` if it returns empty.

## What to weigh (already encoded in focus_get, surface in output)

- Staleness, momentum, blockers, strategic leverage, urgency, recent decisions
- User constraint: if given, weight low-friction options higher

## Output

```
========================================
  TODAY'S FOCUS
========================================

## 1. [Entity name] : [one-line action]

  Why this matters:
  [2 to 3 sentences : strategic reason, not "it's overdue"]

  Evidence:
  - [from focus_get.evidence or entity_read]
  - [from focus_get.evidence or entity_read]

  Next move:
  [one concrete action, not "think about X"]

  Timebox:
  [60 to 120 minutes]

## 2. [optional second priority]
  ...

========================================
  DO NOT DO TODAY
========================================
  - [from focus_get.do_not_do]
  - [shiny new idea to resist]
  - [reorganization that can wait]

========================================
  STALENESS ALERT
========================================
  [from focus_get.staleness_alerts]
  [if none, omit this section]

========================================
  UNREVIEWED DECISIONS
========================================
  [from focus_get.unreviewed_decisions]
  [if none, omit this section]
========================================
```

## After output

Ask: "Ready to start?"

## Rules

- Maximum 3 priorities. Usually 1 is best.
- Every priority needs a concrete next action.
- "Do not do today" is mandatory. The problem is too many realities, not too few.
- If nothing is urgent, say so. "Low-urgency day, pick what has energy" is valid.
- If a proof action from a decision hasn't shipped, surface it (focus_get returns these).
- If an active entity is stale but has no blocker, call it fake-active. Recommend: ship or park.
- Never guilt-trip about parked entities.
- MCP tools only. Name them in user-facing text.

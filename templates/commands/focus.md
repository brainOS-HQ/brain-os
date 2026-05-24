# Brain OS : Focus Engine

"What should I work on today, and why?"

Not a dashboard. A judgment call backed by evidence.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. It governs tool routing for every Brain OS skill.

## Input

Arguments: `$ARGUMENTS` (can be a project name like "brain os" or "ghost", OR a constraint like "only 2 hours" or "low energy today", OR both like "ghost, low energy")

## Primary tool sequence

**If the user names a specific project:**
1. `mcp__brain-os__entity_read(entity_id)` : load that project's full state
2. `mcp__brain-os__plan_read(entity_id)` : get active step and progress
3. `mcp__brain-os__decision_check(entity.next_move, entity_id)` : verify no active decision contradicts the next move
4. Skip `focus_get` — the user already told you what to focus on. Give them the deep view of that one project.

**If no specific project is named (general focus):**
1. `mcp__brain-os__focus_get(constraints=$ARGUMENTS)` : prioritized recommendations across all entities
2. `mcp__brain-os__entity_read(top_pick.entity_id)` : detail on the #1 priority
3. `mcp__brain-os__decision_check(top_pick.next_move, top_pick.entity_id)` : verify no active decision contradicts the recommendation

The `focus_get` tool returns: prioritized entities with scores and reasons, `do_not_do` list, staleness alerts, unreviewed decisions. Use that data first. Only fall back to `entity_read` / `pattern_detect` / `semantic_recall` if it returns empty.

## What to weigh (already encoded in focus_get, surface in output)

- Staleness, momentum, blockers, strategic leverage, urgency, recent decisions
- User constraint: if given, weight low-friction options higher

## Output

Write in PLAIN LANGUAGE. No JSON. No field names like entity_id or staleness.level. The user should understand what to do next without any technical knowledge.

Use this pattern (adapt to content, don't copy robotically):

```
Your top priority right now is [PROJECT NAME].

Do this next:
1. [One concrete action — not "think about X"]
2. [Optional second step if obvious]

Why this matters:
[2 to 3 sentences in plain language. Strategic reason, consequence of not doing it, or what it unlocks. Not "it's overdue."]

What not to do yet:
- [Shiny distraction to resist]
- [Other project that can wait]
- [Reorganization or new idea]

[If there's a second priority, add it briefly:]

After that, consider [SECOND PROJECT]:
[One sentence on what and why]

---
[If staleness alerts exist for the FOCUSED project:]
Heads up: this project hasn't been touched in [N] days. Either ship something or park it.

[If unreviewed decisions exist for the FOCUSED project:]
Decision review due: "[decision text]" — reaffirm, update, or archive it.

---
[ALWAYS AT THE END. If staleness alerts or unreviewed decisions exist for OTHER projects:]
Elsewhere in your workspace worth checking:
- [PROJECT] hasn't been touched in [N] days — ship something or park it.
- [PROJECT] has a decision review due: "[decision text]"
[If nothing from other projects, omit this section entirely.]
```

## After output

Ask: "Ready to start?"

## Rules

- Maximum 3 priorities. Usually 1 is best.
- Every priority needs a concrete next action.
- "What not to do" is mandatory. The problem is too many realities, not too few.
- If nothing is urgent, say so. "Low-urgency day, pick what has energy" is valid.
- If a proof action from a decision hasn't shipped, surface it.
- If an active entity is stale but has no blocker, call it fake-active. Recommend: ship or park.
- Never guilt-trip about parked entities.
- Write like you're talking to a smart friend, not filing a report.
- No JSON in the output. No field names. No scores. The engine does the scoring; the user sees the judgment.
- MCP tools are used internally but never named in user-facing output.

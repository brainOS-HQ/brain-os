# Brain OS : Project Scanner

Instant project intelligence. Where things are, what's stale, what decisions are pending, where to go next.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. It governs tool routing for every Brain OS skill. Pulse files are stale by design; MCP tools read the live `.brain/` store.

## Input

Arguments: `$ARGUMENTS` (format: `<entity-name>`). If no argument, show the master overview.

## Primary tool sequence

**With entity name:**
1. `mcp__brain-os__entity_read(entity_id)` : status, mode, momentum, blockers, decisions
2. `mcp__brain-os__plan_read(entity_id)` : active step and progress
3. `mcp__brain-os__decision_check("scan", entity_id)` : surface any alerts

**Without argument (master overview):**
1. `mcp__brain-os__entity_read()` : all entities at once
2. `mcp__brain-os__pattern_detect()` : active patterns
3. `mcp__brain-os__focus_get(max_results=3)` : top priorities

## Staleness rules

Calculate from each entity's `last_updated`:

- Fresh: 0 to 7 days
- Aging: 8 to 21 days
- Stale: 22 to 45 days
- Dormant: 45+ days

Skip the staleness alert for entities with `mode = parked` or `archived`.

## Output : single entity

Write in PLAIN LANGUAGE. The structured block is for scanability; follow it with a plain-language summary.

```
==============================
  [ENTITY NAME]
==============================
  STATUS      [what's been done recently, in plain words]
  MODE        [active / parked / incubating / archived]
  MOMENTUM    [high / medium / low / stalled]
  BLOCKED     [what's in the way, or "none"]
  NEXT        [the one thing to do next]
  UPDATED     [date] — [Fresh / Aging / Stale / Dormant]
  ----------------------------
  PLAN        [current step] ([done/total] done)
  ----------------------------
  FOCUS NOW   [one sentence: what to do and what NOT to do yet]
==============================
```

After the block, add 2-3 sentences of plain-language context:
- What was the last meaningful progress?
- What decision is this building on?
- What's the risk if this sits?

## Output : master overview

```
============================================================
  YOUR PROJECTS
============================================================

  ACTIVE
  [name]     [momentum]   [how fresh]   [what's next, in plain words]
  [name]     ...

  INCUBATING
  [name]     [why it's incubating]

  PARKED
  [names, one line]

============================================================
  NEEDS ATTENTION
============================================================
  [stale active projects — "X hasn't been touched in N days"]
  [blocked projects — "X is stuck on Y"]
  [fake-active — "X is marked active but nothing is moving"]

============================================================
  RECENT DECISIONS
============================================================
  [last 3, one line each in plain language — not decision IDs]

============================================================
  WHAT YOU CAN DO
============================================================
  /focus      What should I work on today?
  /patterns   What patterns are emerging?
  /retro      What happened this week?
  /strategy   Think through a decision
  /decide     Log a decision
============================================================
```

## After output

Ask: "Want to dig into one of these, or run `/focus`?"

## Rules

- MCP tools are used internally but never named in user-facing output. No "Calling entity_read..." in the response.
- Never speculate. If a field is missing, show "—".
- Do not nag about parked entities. Parked is intentional.
- Write like you're briefing a busy founder, not filing a system report.
- No JSON in the output. No field names like entity_id or staleness.level. No scores.
- The "FOCUS NOW" line in single-entity view is the most important line — make it a clear, actionable judgment call.
- When the user asks about a specific project: that project gets the full report first. Any alerts, staleness, decisions, or patterns from OTHER projects go under "Elsewhere in your workspace worth checking:" at the very end. If nothing from other projects is relevant, omit that section entirely.
- When no specific project is named: show everything without separation.

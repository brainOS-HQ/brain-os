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

```
==============================
  [ENTITY NAME]
==============================
  STATUS      [from entity_read]
  MODE        [active/parked/incubating/archived]
  MOMENTUM    [high/medium/low/stalled]
  BLOCKED     [blocker, or none]
  NEXT        [next_move]
  UPDATED     [last_updated] : [Fresh/Aging/Stale/Dormant]
  ----------------------------
  ACTIVE PLAN [step from plan_read]
  RELATED     [related_entities]
  DECISIONS   [active decisions, or none]
  ----------------------------
  OPEN        [open_questions, or none]
==============================
```

## Output : master overview

```
============================================================
  BRAIN OS : OVERVIEW
============================================================

  ACTIVE
  --------------------------------------------------------
  ENTITY            MOMENTUM   UPDATED    FRESHNESS  NEXT
  [name]            [m]        [date]     [f]        [next]

  INCUBATING
  --------------------------------------------------------
  [name]            ...

  PARKED / ARCHIVED
  --------------------------------------------------------
  [names, comma-separated]

============================================================
  ALERTS
============================================================
  STALE:    [active entities not updated in 22+ days]
  BLOCKED:  [entities with active blockers]
  FAKE:     [active entities with stalled momentum]
============================================================
  RECENT DECISIONS
============================================================
  [last 3 from entity_read.recent_decisions, one line each]
============================================================
  ACTIVE PATTERNS
============================================================
  [from pattern_detect, one line each]
============================================================
  SUGGESTED NEXT
============================================================
  -> /focus      What should I work on today?
  -> /patterns   What patterns are emerging?
  -> /retro      What happened this week?
  -> /strategy   Think through a decision
  -> /decide     Log a decision
============================================================
```

## After output

Ask: "Want to work on something, or run `/focus`?"

## Rules

- Brain OS MCP tools only. Never read code, `CLAUDE.md`, or pulse files when the MCP server is available.
- Never speculate. If a field is missing, show `-`.
- Staleness is today minus `last_updated`.
- Do not nag about parked entities. Parked is intentional.
- Name the MCP tools you call in user-facing text (e.g. "Calling `entity_read`..."). Reinforces tool habit per protocol.

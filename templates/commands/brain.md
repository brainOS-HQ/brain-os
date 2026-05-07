# Brain OS : Project Scanner

Instant project intelligence. Not just context, judgment.

Shows where things are, what's stale, what decisions are pending, and where to go next.

## Input

Arguments: `$ARGUMENTS` (format: `<entity-name>`)

If no arguments → show the master overview.

## Data Source

All data comes from the Brain OS MCP server. Do not read code, repos, or `CLAUDE.md` files : only call MCP tools.

---

## If entity name given: Single Entity Scan

### Step 1 : Read the entity

Call `entity_read` with the given name.

### Step 2 : Calculate staleness

Compare the entity's `last_updated` to today:

- **Fresh**: 0 to 7 days
- **Aging**: 8 to 21 days
- **Stale**: 22 to 45 days
- **Dormant**: 45+ days

Skip the staleness alert for entities with `mode = parked` or `mode = archived`.

### Step 3 : Check decisions

Look at the entity's recent decisions (use `entity_read` output). Surface anything still active.

### Step 4 : Display

```
==============================
  [ENTITY NAME]
==============================
  STATUS      [status from entity]
  MODE        [active/parked/incubating/archived]
  MOMENTUM    [high/medium/low/stalled]
  BLOCKED     [blocker, or none]
  NEXT        [next_move]
  UPDATED     [last_updated] : [Fresh/Aging/Stale/Dormant]
  ----------------------------
  RELATED     [related entities]
  DECISIONS   [active decisions, or none]
  ----------------------------
  OPEN        [open questions, or none]
==============================
```

---

## If no argument: Master Overview

### Step 1 : Read all entities

Call `entity_read` with no arguments (returns all entities) or list each via the entities directory.

### Step 2 : Display

```
============================================================
  BRAIN OS : OVERVIEW
============================================================

  ACTIVE
  --------------------------------------------------------
  ENTITY            MOMENTUM   UPDATED    FRESHNESS  NEXT
  [name]            [m]        [date]     [f]        [next]
  ...

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
  [last 3 decisions, one line each]
============================================================
  ACTIVE PATTERNS
============================================================
  [active patterns from pattern_detect, one line each]
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

Keep each cell to one short phrase. The table must be scannable in 10 seconds.

---

## Rules

- Only read entity data via Brain OS MCP tools. Never read code, `CLAUDE.md`, or repo files.
- Never speculate about entity state. If a field is missing, show `-`.
- If an entity has no `momentum` or `mode` field, infer from `last_updated` and `evidence_of_progress`, or show `-`.
- Staleness is calculated from today's date minus `last_updated`.
- After the overview, ask: "Want to work on something, or run `/focus`?"
- Do not nag about parked entities. Parked is intentional.

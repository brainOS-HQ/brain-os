# Brain OS : Retrospective Engine

"What actually happened? What moved, what stuck, what am I avoiding?"

Not a status report. A mirror.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`.

## Input

Arguments: `$ARGUMENTS` (optional : entity/project name, "weekly" or "monthly", or both e.g. `brain-os weekly`). Defaults to weekly across all entities if no argument.

## Primary tool sequence

1. `mcp__brain-os__audit_log({days: 7})` (or 30) : what was actually written, decided, updated
2. `mcp__brain-os__entity_read()` : current state of all entities
3. `mcp__brain-os__pattern_detect()` : active patterns
4. `mcp__brain-os__semantic_recall("this week", source_kind="session")` : cross-reference session context

## Analysis

### Weekly retro

Look at what changed in the last 7 days. For each touched entity, compare current state to the `next_move` at the start of the week.

Determine:

- **Shipped**: things that actually moved from plan to done
- **Decided**: strategic decisions made
- **Repeated but not shipped**: things mentioned in `next_move` / `open_questions` that haven't moved
- **Avoided**: active entities not touched at all this week
- **Surprise**: unplanned work that took priority, or an entity that moved when it wasn't supposed to

### Monthly retro

Same analysis over 30 days. Plus:

- **Mode changes**: entities that moved between active/parked/incubating/archived
- **Decisions that held**: 30+ day old decisions still guiding work
- **Decisions that didn't hold**: decisions quietly abandoned or contradicted
- **Momentum trajectory**: for each active entity, momentum higher or lower than a month ago?

## Output

```
========================================
  [WEEKLY/MONTHLY] RETRO : [date range]
========================================

  SHIPPED
  ----------------------------------------
  [entity] : [what actually moved]

  DECIDED
  ----------------------------------------
  [entity] : [decision]

  REPEATED BUT NOT SHIPPED
  ----------------------------------------
  [entity] : [thing that keeps appearing in next_move]

  NOT TOUCHED
  ----------------------------------------
  [entity] : [days since last update] : [mode]

  HIDDEN PATTERN
  ----------------------------------------
  [one honest observation about the period]

========================================
  RECOMMENDATION
========================================
  [one sentence: what next period should focus on]
  [one sentence: what to stop doing]
========================================
```

## After the retro

Ask:

1. Does this feel accurate?
2. Any patterns to log?
3. Any entity mode changes? (active to parked, etc.)
4. Should any `next_move` fields be rewritten based on this?

For each yes, call the appropriate MCP tool (`entity_update`, `pattern_detect` to confirm a new pattern, etc.).

## Rules

- Be honest. If nothing shipped, say nothing shipped. Don't soften it.
- "Repeated but not shipped" is the most important section. It reveals where energy leaks.
- Never frame parked entities as failures. Parking is a decision.
- Keep "Hidden pattern" to ONE observation. The most important one.
- If this is the first retro, say so: "First retro. No comparison data yet. Establishing baseline."
- MCP tools only.
- Write in plain language. No JSON in the output. No field names like entity_id or staleness.level. No scores or technical jargon.
- MCP tools are used internally but never named in user-facing output.
- When the user asks about a specific project: that project gets the full report first. Any alerts, staleness, decisions, or patterns from OTHER projects go under "Elsewhere in your workspace worth checking:" at the very end. If nothing from other projects is relevant, omit that section entirely.
- When no specific project is named: show everything without separation.

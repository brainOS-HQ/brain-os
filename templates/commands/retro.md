# Brain OS : Retrospective Engine

Answer: "What actually happened? What moved, what stuck, what am I avoiding?"

Not a status report. A mirror.

## Input

Arguments: `$ARGUMENTS` (optional : "weekly" or "monthly", defaults to weekly)

## How

Call `audit_log` for the relevant time window (last 7 or 30 days) to see what was actually written, decided, and updated. Cross-reference with `entity_read` for current state and `pattern_detect` for active patterns.

Do not read code, repos, or `CLAUDE.md` files.

## Analysis

### Weekly retro

Look at what changed in the last 7 days. For each entity touched, compare current state to the `next_move` at the start of the week (use audit log + decisions).

Determine:

- **Shipped**: things that actually moved from plan to done
- **Decided**: strategic decisions made (last 7 days)
- **Repeated but not shipped**: things mentioned in `next_move` or `open_questions` that haven't moved
- **Avoided**: active entities not touched at all this week
- **Surprise**: anything unexpected : unplanned work that took priority, or an entity that moved when it wasn't supposed to

### Monthly retro

Same analysis but over 30 days. Plus:

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
3. Any entity mode changes? (active : parked, etc.)
4. Should any `next_move` fields be rewritten based on this?

For each yes, call the appropriate MCP tool (`entity_update`, `pattern_detect` to confirm a new pattern, etc.).

## Rules

- Be honest. If nothing shipped, say nothing shipped. Don't soften it.
- "Repeated but not shipped" is the most important section. It reveals where energy leaks.
- Never frame parked entities as failures. Parking is a decision, not a defeat.
- Keep "Hidden pattern" to ONE observation. The most important one.
- If this is the first retro, say so: "First retro. No comparison data yet. Establishing baseline."
- Do not read code. MCP tools only.

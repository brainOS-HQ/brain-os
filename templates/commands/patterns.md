# Brain OS : Pattern Engine

"What patterns are showing up across my work?"

Not analytics. Recognition.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. Tool routing is non-negotiable.

## Input

Arguments: `$ARGUMENTS` (optional : "weekly" for recent patterns, "deep" for full analysis, or a specific theme)

## Primary tool sequence

1. `mcp__brain-os__pattern_detect()` : current pattern report
2. If empty: `mcp__brain-os__semantic_recall("recent patterns", source_kind="pattern")`
3. Supporting evidence: `mcp__brain-os__entity_read()` for relevant entities

## What to look for

### 1. Momentum patterns
- Which entities are moving? Which are stalled?
- Is momentum concentrated or scattered?
- Anything losing momentum that was recently high?

### 2. Blocker recurrence
- Same blocker across multiple entities
- Same blocker in the same entity across sessions
- Blockers noted but never resolved

### 3. Decision repetition
- Strategic questions that keep being reopened
- Decisions marked active but not acted on
- Similar decisions made independently across entities

### 4. Theme emergence
- Concepts appearing across multiple entities
- What kind of work the user keeps gravitating toward
- Shared architectural needs

### 5. Execution vs discussion gap
- Entities with lots of decisions but little evidence of progress
- High-status descriptions that don't match actual output
- `next_move` fields unchanged across updates

### 6. Avoidance signals
- "Active" entities not updated in 3+ weeks
- Entities where `next_move` keeps changing without anything shipping
- Open questions piling up without answers

### 7. Convergence opportunities
- Entities that could share architecture, components, or patterns
- Work in one entity that directly benefits another

## Output

```
========================================
  PATTERN REPORT
========================================

## Pattern 1: [name]

  Evidence:
  - [specific data point from entity_read or pattern_detect]
  - [specific data point]

  Interpretation:
  [one paragraph max]

  Risk:
  [what happens if this pattern continues]

  Recommendation:
  [one concrete action]

  Entities affected:
  [list]

----------------------------------------

## Pattern 2: [name]
  ...

========================================
  EXISTING PATTERNS : STATUS CHECK
========================================
  [for each pattern already logged]
  [still active? resolved? false positive?]
========================================
```

## After output

Ask the user which patterns to save. For confirmed ones, the tool persists them (or update existing entries if evidence has changed).

## Rules

- Patterns must have evidence. Never speculate without data.
- Distinguish "this happened once" from "this keeps happening".
- Do not moralize. State the pattern, the risk, and the action. No lectures.
- If no new patterns, say so: "No new patterns. Current ones still hold."
- If a logged pattern looks resolved or false, recommend removing it.
- Maximum 5 patterns per report. Prioritize the most impactful.
- MCP tools only. Name them in user-facing text.

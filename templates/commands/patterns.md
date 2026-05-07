# Brain OS : Pattern Engine

Answer the question: "What patterns are showing up across my work?"

Not analytics. Recognition. The kind of insight that changes how you see your own entities.

## Input

Arguments: `$ARGUMENTS` (optional : "weekly" for recent patterns, "deep" for full analysis, or a specific theme to investigate)

## How

Call `pattern_detect` to get the current pattern report. If you need supporting evidence, call `entity_read` and review recent decisions.

Do not read code, repos, or `CLAUDE.md` files.

## What to look for

### 1. Momentum patterns
- Which entities are moving? Which are stalled?
- Is momentum concentrated in one area or scattered?
- Is anything losing momentum that was recently high?

### 2. Blocker recurrence
- Same blocker appearing in multiple entities
- Same blocker appearing in the same entity across sessions
- Blockers that are noted but never resolved

### 3. Decision repetition
- Strategic questions that keep being reopened
- Decisions marked active but not acted on
- Similar decisions being made independently across entities

### 4. Theme emergence
- What concepts appear across multiple entities?
- What kind of work does the user keep gravitating toward?
- Are there shared architectural needs?

### 5. Execution vs discussion gap
- Entities with lots of decisions but little evidence of progress
- High-status descriptions that don't match actual output
- `next_move` fields that haven't changed across updates

### 6. Avoidance signals
- Entities that are "active" but haven't been updated in 3+ weeks
- Entities where the next move keeps changing without anything shipping
- Entities where open questions pile up without answers

### 7. Convergence opportunities
- Entities that could share architecture, components, or patterns
- Work in one entity that directly benefits another
- Themes that suggest a bigger unified direction

## Output

```
========================================
  PATTERN REPORT
========================================

## Pattern 1: [name]

  Evidence:
  - [specific data point]
  - [specific data point]

  Interpretation:
  [what this pattern means : one paragraph max]

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
  [for each pattern already in the log]
  [still active? resolved? false positive?]
========================================
```

## After the report

Ask the user which patterns to save. For confirmed ones, the agent should call the appropriate Brain OS tool to persist them (or update existing entries if the evidence has changed).

## Rules

- Patterns must have evidence. Never speculate without data.
- Distinguish between "this happened once" and "this keeps happening".
- Do not moralize. State the pattern, the risk, and the action. No lectures.
- If no new patterns are found, say so. "No new patterns. Current ones still hold."
- If a logged pattern looks resolved or false, recommend removing it.
- Maximum 5 patterns per report. Prioritize the most impactful.
- Do not read code. MCP tools only.

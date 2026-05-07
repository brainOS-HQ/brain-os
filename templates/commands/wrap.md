# Brain OS : Session Wrap

Close the session cleanly. Update entity state. Capture decisions. Detect momentum shifts.

Not just "what changed" : "what does the system need to remember?"

## Input

Arguments: `$ARGUMENTS` (optional : entity name if wrapping a single entity)

If no argument → wrap all entities touched this session.

## How

The Brain OS MCP tool `memory_commit` is designed for this flow. Call it to drive the wrap, or use `entity_update`, `decision_log`, and `pattern_detect` directly if you need finer control.

Do not read code, repos, or `CLAUDE.md` files. Use conversation context plus MCP tools only.

## Step 1: Identify what was worked on

Look back at this conversation. Identify which entities were touched : anywhere a decision was made, code was written, or direction changed.

If an entity name was given as argument → wrap that one only.

## Step 2: For each touched entity, ask

One message per entity. Keep it fast:

```
Wrapping [ENTITY NAME]:

1. Status changed? (y/n, if yes, what's the new status?)
2. Decision made? (what was decided? should it go in the decision log?)
3. Next move changed? (what's the actual next thing?)
4. Momentum: up / same / down / stalled?
5. Should this entity stay active, or be parked/archived?
6. Any pattern noticed? (recurring theme, blocker, or behavior?)
```

Yes/no where possible. One message per entity, max.

## Step 3: Update the entity

For each entity with changes, call `entity_update` with the relevant fields:

- `status` if changed
- `mode` if changed (active/parked/incubating/archived)
- `mode_reason` if parked or incubating
- `momentum` (high/medium/low/stalled)
- `last_decision` if a decision was made this session
- `blocked` (update or clear if resolved)
- `next_move` (the concrete next action)
- `evidence_of_progress` (what actually shipped or moved)
- `open_questions` (any unresolved questions)

`last_updated` is set automatically by the tool.

## Step 4: Capture decisions

If a strategic decision was made during the session, ask: "Should this go in the decision log?"

If yes, call `decision_log`. Before writing, call `decision_check` to surface any conflicts with existing active decisions.

If a new decision supersedes an existing one, the tool will mark the old one `superseded`.

## Step 5: Log patterns

If a recurring theme, blocker, or avoidance behavior was noticed, ask: "Should this go in the pattern log?"

If yes, call `pattern_detect` to confirm it as a pattern (or add a new one). If it matches an existing pattern, update that entry instead of creating a duplicate.

## Step 6: Summary

```
==============================
  SESSION WRAPPED
==============================
  [ENTITY]   [what changed]   [momentum]
  [ENTITY]   [what changed]   [momentum]
  ----------------------------
  Unchanged: [entities not touched]
  ----------------------------
  Decisions logged: [count, or none]
  Patterns logged:  [count, or none]
==============================
```

## Rules

- Never guess what changed. Always ask.
- If the user says "nothing changed" for an entity, do not update. Just confirm.
- If a blocker was resolved, clear it.
- Keep questions short. This is a close, not a review.
- If this session touched the user's Brain OS entity itself, update it too.
- Every wrap should take under 2 minutes. Fast close, clean state.
- Do not read code. MCP tools only.

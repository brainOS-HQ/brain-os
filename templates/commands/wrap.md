# Brain OS : Session Wrap

Close the session cleanly. Update entity state. Capture decisions. Detect momentum shifts.

Not just "what changed" : "what does the system need to remember?"

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. The wrap writes state back via MCP mutating tools; it must read current state via MCP tools first.

## Input

Arguments: `$ARGUMENTS` (optional : entity name if wrapping a single entity). If no argument, wrap all entities touched this session.

## Primary tool sequence

1. `mcp__brain-os__entity_read(entity_id)` : current state of the entity being wrapped
2. `mcp__brain-os__plan_read(entity_id)` : current active step (so the wrap can advance it if relevant)
3. Ask the user the questions in Step 2 (propose options for open-ended fields, per `feedback_wrap_question_options`)
4. `mcp__brain-os__decision_check(...)` if a decision was made (conflict gate)
5. `mcp__brain-os__entity_update(...)` : write the new state back
6. `mcp__brain-os__plan_update(...)` : advance / complete plan steps if changed
7. `mcp__brain-os__decision_log(...)` : if a strategic decision was made
8. `mcp__brain-os__memory_commit(...)` : optional, writes a session-level audit entry

## Step 1: Identify what was worked on

Look back at this conversation. Identify which entities were touched : anywhere a decision was made, code was written, or direction changed.

If an entity name was given as argument, wrap that one only.

## Step 2: For each touched entity, ask

One message per entity. Propose 2 to 3 candidate answers drawn from the conversation for open-ended fields (decision, next move, pattern). Structured fields with enums (status y/n, momentum up/same/down/stalled, mode active/parked/incubating/archived) stay direct.

```
Wrapping [ENTITY NAME]:

1. Status changed? (y/n, if yes: a / b / c / other)
2. Decision made? (a / b / c / none)
3. Next move changed? (a / b / c / other)
4. Momentum: up / same / down / stalled?
5. Mode: stay active / park / incubate / archive?
6. Pattern noticed? (a / b / none)
```

Yes/no or pick-one where possible. One message per entity, max.

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

If a strategic decision was made, ask: "Should this go in the decision log?"

If yes:
- Call `decision_check` to surface any conflicts with existing active decisions
- Call `decision_log` to persist
- If the new decision supersedes an existing one, the tool will mark the old one `superseded`

## Step 5: Advance the plan if needed

If a plan step shipped this session, call `plan_update` to mark it complete and surface the next active step.

## Step 6: Log patterns

If a recurring theme, blocker, or avoidance behavior was noticed, ask: "Should this go in the pattern log?"

If yes, call `pattern_detect` to confirm it (or update existing).

## Step 7: Summary

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
  Plan steps advanced: [count, or none]
==============================
```

## Autowrap

If context compression fires during a session (the system summarizes earlier messages), treat it as a signal that session state may be lost. Proactively trigger a wrap before continuing work — ask the user "Context is getting long. Want me to wrap before continuing?" If they agree, run this protocol. If they decline, continue but flag it once more if compression fires again.

## Rules

- Never guess what changed. Always ask.
- For open-ended fields, propose 2 to 3 candidate answers. Picking is the reflection.
- If the user says "nothing changed" for an entity, do not update. Just confirm.
- If a blocker was resolved, clear it.
- Keep questions short. This is a close, not a review.
- If this session touched the user's Brain OS entity itself, update it too.
- Every wrap should take under 2 minutes.
- Write in plain language. No JSON in the output. No field names like entity_id or staleness.level.
- MCP tools are used internally but never named in user-facing output.
- When the user asks about a specific project: that project gets the full report first. Any alerts, staleness, decisions, or patterns from OTHER projects go under "Elsewhere in your workspace worth checking:" at the very end. If nothing from other projects is relevant, omit that section entirely.
- When no specific project is named: show everything without separation.

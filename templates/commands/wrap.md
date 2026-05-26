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

## Step 2: Ask what to remember

Show the user a short memory checklist in everyday language. Ask one yes/no question per thing worth saving. Do not ask about fields, entities, momentum, mode, plans, commits, logs, or schemas.

Group by project if more than one project changed, but keep each item as a plain sentence the user could say to a coworker.

Use this shape:

```
Here is what seems worth remembering:

[Project name]
- You decided to drop the auth rewrite. Remember that?
- You're blocked on the API key. Flag that for next time?
- You made progress on the landing page. Save where you left off?
- Next time, start by testing the checkout flow. Keep that as the next step?

Reply yes/no for each one, or edit the wording.
```

Good question patterns:

- "You decided [decision]. Remember that?"
- "You're blocked on [blocker]. Flag that for next time?"
- "You made progress on [work]. Save where you left off?"
- "Next time, start with [specific action]. Keep that as the next step?"
- "[Project] is paused for now. Remember that?"
- "This keeps coming up: [pattern]. Save that as a pattern?"

If there are more than 5 items, show only the highest-value memories first. A wrap should feel like checking off notes, not filling out a form.

Internally map confirmed items like this:

- decision remembered -> `decision_check`, then `decision_log`, and usually `last_decision`
- blocker flagged -> `blocked`
- progress saved -> `evidence_of_progress` and, if useful, `status`
- next step kept -> `next_move` or plan step update
- pause/archive/incubate remembered -> `mode` and `mode_reason`
- recurring behavior saved -> pattern note or session pattern

If the user says no to an item, do not write it.

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

If a strategic decision was made and it was not already confirmed in Step 2, ask: "You decided [decision]. Remember that for next time?"

If yes:
- Call `decision_check` to surface any conflicts with existing active decisions
- Call `decision_log` to persist
- If the new decision supersedes an existing one, the tool will mark the old one `superseded`

## Step 5: Advance the plan if needed

If a plan step shipped this session, call `plan_update` to mark it complete and surface the next active step.

## Step 6: Log patterns

If a recurring theme, blocker, or avoidance behavior was noticed and it was not already confirmed in Step 2, ask: "This keeps coming up: [pattern]. Save that as a pattern?"

If yes, call `pattern_detect` to confirm it (or update existing).

## Step 7: Summary

```
==============================
  SESSION WRAPPED
==============================
  Remembered:
  - [Plain-language thing saved]
  - [Plain-language thing saved]
  ----------------------------
  Skipped:
  - [Plain-language thing the user declined, or "Nothing"]
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

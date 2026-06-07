# Brain OS : Session Wrap

Close the session cleanly. Update entity state. Capture decisions. Detect momentum shifts.

Not just "what changed" : "what does the system need to remember?"

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. The wrap writes state back via MCP mutating tools; it must read current state via MCP tools first.

## Step 0: Check for Compact Checkpoints

Before asking wrap questions, check for unconfirmed checkpoint files:

```
.brain/sessions/checkpoints/*-*.json
```

Look for any file where `"confirmed": false` and `"status": "captured"`.

If found:

1. Read the checkpoint(s).
2. Show the user a human summary of what was captured:
   ```
   Before context was compacted, I saved a checkpoint:
   - You were working on: [last_user_goals summary]
   - Files touched: [count] files in [project]
   - Open threads: [open_questions summary]
   - Last direction: [last_assistant_summary, one line]

   Does this look right? I'll fold the confirmed parts into today's wrap.
   ```
3. User confirms, edits, or discards.
4. Confirmed content feeds into the normal wrap questions below (pre-filling suggestions).
5. After wrap completes, mark the checkpoint file: `"status": "confirmed"` or `"status": "discarded"`.

### Auto-wraps from a previous session

Also check for unconfirmed auto-wrap records written by `wrap_auto`:

```
.brain/sessions/autowrap-*.json
```

Each has `"confirmed": false`, the low-risk fields **already applied** (`applied`), and high-risk proposals **staged** under `pending_review`. For each one:

1. Tell the user what was already auto-saved (the `applied` list — next move, open questions, evidence).
2. For each `pending_review` item (status, mode, blocked, decisions), ask one short yes/no: "Last session I held this back for you to confirm: [item]. Apply it?"
3. Apply confirmed items via the normal tools (`entity_update`; `decision_check` then `decision_log` for decisions). Discard the rest.
4. Mark the record `"confirmed": true`.

If no checkpoints or auto-wraps found, skip this step silently.

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

## Step 6b: Review debt check

Before writing the final summary, check each entity touched this session for overdue review debt:

- Call `mcp__brain-os__decision_review(entity_id=<entity>, limit=3)` for each entity wrapped.
- If `overdue_count > 0` for any entity, add a single line to the summary output:

  ```
  ⚠ [N] overdue decisions in [entity] — run /reconcile [entity] to clear them.
  ```

- Do not block the wrap on this. Surface it once, then close.

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

## Auto-mode (no-review wrap)

Manual wrap needs the user present. When state is about to be lost and the user is not reviewing, capture it anyway — a flagged auto-wrap beats losing the session.

**Detect.** Call `wrap_check` when the user signals they are stopping, or periodically in a long session. If `recommend_wrap` is true, offer: "You've got [N] unwrapped changes — want me to wrap?"

**If they decline, can't review, or context compression / session end is imminent:** run `wrap_auto` instead of the interactive flow. Synthesize the session yourself and pass:

- LOW-RISK (applied now): `next_move`, `open_questions`, `evidence_of_progress`.
- HIGH-RISK (staged, never applied): `pending_review` → `status`, `mode`, `blocked`, `decisions`.

`wrap_auto` applies the low-risk fields, stages the high-risk ones as `confirmed:false`, and logs a `session_wrapped` marker. `/start` surfaces the staged items next session for confirm / edit / discard.

**Per client.** This safety net matters where sessions are actually lost — Claude Code (compaction + terminal close, via the PreCompact + SessionEnd hooks). Clients with a persistent chat room (e.g. ChatGPT) do not lose context the same way: there, use `wrap_check` to *suggest* a wrap, but do not auto-wrap silently. If compression fires mid-session and the user is around, still prefer the interactive wrap — only fall back to `wrap_auto` when they are not.

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

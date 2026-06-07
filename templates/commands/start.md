# Brain OS : Session Start

"What accumulated? What's blocking? Where do I begin?"

Run this at the start of every work session. It surfaces everything that
accumulated since last time — including anything an auto-wrap saved without
review — and gives you one clear place to begin.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`.

## Input

Arguments: `$ARGUMENTS` (optional project name to scope)

## Step 0: Reconcile unconfirmed auto-wraps & checkpoints

Before anything else, check for state the last session saved without review:

```
.brain/sessions/autowrap-*.json          (auto-wraps from wrap_auto)
.brain/sessions/checkpoints/*-*.json      (raw captures from the PreCompact / SessionEnd hooks)
```

Look for files where `"confirmed": false`.

- **Auto-wraps** (`autowrap-*.json`): the `applied` fields were already written (low-risk — next move, open questions, evidence). The `pending_review` items were held back for you. For each high-risk item (status, mode, blocked, decisions), ask one short yes/no, then apply confirmed ones via the normal tools and mark the record `"confirmed": true`.
- **Raw checkpoints**: summarize what was captured (`last_user_goals`, `open_questions`, `last_assistant_summary`) and offer to fold it into a proper wrap. Mark `"confirmed"` or `"discarded"` after.

Surface these under "RECOVERED FROM LAST SESSION" in the output. If none exist, skip silently.

## Tool sequence

1. `mcp__brain-os__context_resolve(user_message=$ARGUMENTS)` — resolve scope if project named
2. `mcp__brain-os__entity_read(entity_id)` — current state, open questions, blockers
3. `mcp__brain-os__plan_read(entity_id)` — active plan step and progress
4. `mcp__brain-os__decision_review(entity_id, limit=3)` — overdue decisions
5. `mcp__brain-os__focus_get(entity_id)` — priority recommendation

Run all 5. Combine into a single session brief.

## Output format

```
SESSION START — [date]
═══════════════════════════════════════

[Project / Global]

RECOVERED FROM LAST SESSION
  ✓ Auto-saved: [what was already applied]
  ? Needs your call: [staged high-risk item — confirm/discard]

SINCE LAST SESSION
  Plan: [X/N steps done] — active: [current step]
  [If anything changed: "Last updated [N] days ago"]

NEEDS ATTENTION NOW
  🔴 [blocker or overdue decision — act before starting]
  🟡 [stale question or aging open item]

FOCUS
  → [One concrete thing to do right now, from focus_get]

PIPELINE
  → Active: [current plan step]
  → Next:   [next step]

OPEN QUESTIONS (oldest first, unresolved)
  ? [question — if older than 7 days, mark as "needs resolution"]
  ? [question]

OVERDUE DECISIONS
  - "[decision]" — due [date] (use /reconcile)

═══════════════════════════════════════
Start with: [exact first action]
```

## Aging rules (apply when formatting output)

- Open question not actioned in 7+ days → prefix with ⏰
- Blocker unchanged in 7+ days → prefix with 🔴 "still blocking:"
- Plan active step unchanged in 7+ days → flag as "stalled"
- Overdue decision → always show, never hide
- High-priority question → show first regardless of age

## Rules

- Reconcile auto-wraps and checkpoints FIRST — recovered state is worthless if it's never surfaced.
- Never more than 5 open questions in the output — show oldest/highest-priority first
- If nothing needs attention, say so clearly: "Clean slate — straight to work"
- One concrete first action at the bottom — not a list, one thing
- Write in plain language, no JSON, no field names
- MCP tools used internally, never named in output

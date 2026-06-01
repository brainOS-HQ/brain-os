# Brain OS : Reconcile Decision Review-Debt

Clear the decision review backlog. Walk the decisions that are due for review and, for each, decide together: still true, needs evidence, changed, or archive.

This is the user-facing loop on top of `decision_review` (which finds the debt) and `decision_check` (which flags when a premise may have changed). `/decide` captures a new decision; `/reconcile` revisits old ones.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. The protocol's "Tool routing" and "Mutation safety" sections are load-bearing: this command proposes, the user confirms, and nothing is archived or superseded automatically (dec-051).

## Input

Arguments: `$ARGUMENTS`.

- A project / entity name → scope the review to that entity. No name → review across the workspace.
- `--details` (aliases: `--debug`, `--system`) → after each plain-language item, also show the **System detail** block (the structured reason: bucket, assumptions, invalidate_if, matched conditions). Default is plain language only.

## Primary tool sequence

1. `mcp__brain-os__decision_review(entity_id?, limit?)` : the read-only inbox. Buckets overdue decisions into `still_true` / `needs_evidence` / `archive` / `changed` with a recommended action and reason for each. Mutates nothing.
2. For each item the user confirms, apply:
   - `mcp__brain-os__decision_refresh(decision_id, review_date?, add_evidence?, status?)` : bump the review date forward, append evidence, or archive.
   - `mcp__brain-os__decision_log(..., supersedes=[id])` : when a decision has **changed**, log the replacement and supersede the old one.

## Step 1: Pull the inbox

Call `decision_review`. If `overdue_count` is 0, say the review queue is clear and stop — don't manufacture work.

Otherwise you have grouped items. Each carries: the decision, why it was decided, its `assumptions`, its `invalidate_if` conditions, an evidence count, a suggested action, and a confidence.

## Step 2: Walk each item — plain language first

Go bucket by bucket, highest-value first (`archive` cleanups and `changed` items before routine refreshes). For each decision, lead with a **human-language frame** built from its own fields — what was decided, the assumption behind it, and whether reality still matches — then add **one light technical line** naming the concrete signal (the matched condition, the version, the bucket in plain terms). This is the default for `/reconcile` (the decision-review tier of dec-mpungjpq-1b47): human-first, but with the one technical line a developer needs to trust *why* it surfaced. Not a field dump — that stays behind `--details`.

```
We decided "local-only storage" assuming single-machine use.
That review came due 12 days ago. Does single-machine use still hold,
or are you syncing across devices now?
Matched condition: invalidate_if = "user asks to sync across machines"
```

Then give the recommendation in plain words, mapped from the bucket:

- **still_true** → "There's evidence this still holds. I'd reaffirm it and push the review out." (refresh: new `review_date` + `add_evidence`)
- **needs_evidence** → "This is still active but unproven. What's the evidence it still holds — or should we set a real proof action?" (refresh with evidence, or capture a proof action)
- **archive** → "This looks like a duplicate of an earlier decision. I'd archive this copy." (refresh `status="archived"`, note the canonical id)
- **changed** → "The assumption behind this no longer holds. I'd log a new decision that supersedes it." (decision_log with `supersedes`)

Test the `invalidate_if` conditions out loud against current reality: if one now holds, the decision's premise changed → it's a **changed** item even if `decision_review` filed it elsewhere. That judgment is the user's; offer it, don't force it.

Ask for the call. One decision at a time, or batch a few if the user wants to move fast. Never archive or supersede without an explicit yes.

## Step 3: Apply what's confirmed

For each confirmed call, use the matching tool from the sequence above. After applying, state the result in one plain line ("Reaffirmed — next review in three months." / "Archived the duplicate." / "Logged the new direction; the old one is superseded.").

## Step 4 (only with `--details`): show the full machinery

The default already carries one light technical line per item (Step 2). The `--details` / `--debug` / `--system` flag is the third tier: append the **full System detail** block beneath each item's frame — the complete structured reason, not a JSON dump:

```
System detail:
bucket = changed
assumptions = ["single-machine use"]
invalidate_if = ["user asks to sync across machines"]
matched_condition = "user asks to sync across machines"
confidence = 0.6
action = supersede via decision_log
```

Without the flag, keep it to the human frame + the single technical line — never dump the full block of fields, tool names, or confidence scores.

## Output

```
========================================
  DECISION REVIEW
========================================
  Scope:        [entity name | workspace]
  Due:          [overdue_count] decision(s)
  Reaffirmed:   [n]
  Updated:      [n]
  Archived:     [n]
  Superseded:   [n]
  Left open:    [n] (still need your call)
========================================
```

If items were left open, name them in one plain line each so the user knows what's still on the table.

## Rules

- `decision_review` is read-only. Nothing changes until the user confirms each call (dec-051).
- Never archive or supersede a decision without an explicit yes.
- Three output tiers (dec-mpungjpq-1b47): human frame + one light technical line by default; the full `System detail` block only with `--details` / `--debug` / `--system`. Never all-plain (strips the developer signal), never a full field dump unprompted.
- Don't re-litigate decisions with standing evidence — reaffirm and move on.
- A decision with no proof action and no evidence isn't "still true" by default — it's unproven. Say so.
- MCP tools are used internally but never named in user-facing output (unless `--details`).
- If the queue is empty, say so and stop.

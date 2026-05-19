# Brain OS : Decision Capture

Capture a strategic decision so it never gets lost or reopened accidentally.

This is not `/strategy` (which helps you think a decision through). This captures the decision after it's been made.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. The protocol's "Tool routing" section is load-bearing: `decision_check` runs BEFORE any write.

## Input

Arguments: `$ARGUMENTS` (format: `<entity-name> "<decision summary>"`). If no arguments, review what was decided this session and ask what to log.

## Primary tool sequence

1. `mcp__brain-os__decision_check(proposed_action, entity_id)` : conflict gate, runs FIRST
2. Gather details (see Step 2 below)
3. `mcp__brain-os__decision_log(...)` : persist the decision
4. `mcp__brain-os__entity_update(...)` : if the decision changes `next_move` or clears a blocker

## Step 1: Conflict check

`decision_check` returns one of:

- **clear** : no conflict, proceed.
- **caution** : a related decision exists. Surface it, ask if this supersedes it.
- **conflict** : a contradictory active decision exists. STOP. Show the conflict and ask the user to confirm before proceeding.

Never log a `conflict` result without explicit user confirmation.

## Step 2: Gather details

If a decision summary was provided, confirm and fill in gaps. If not, ask:

1. What was decided?
2. Why? (the real reason, not the polite one)
3. What alternatives were considered, and why rejected?
4. What's the proof action : one thing that validates this decision?
5. When should this be reviewed?

One message, not an interrogation.

## Step 3: Classify

Assign a decision type:

- **product_direction** : what to build, what the product is
- **architecture** : how to build it technically
- **scope** : what to include or cut
- **priority** : what to do first
- **kill_park** : stopping or pausing an entity or feature
- **monetization** : how to make money
- **brand** : identity, voice, positioning

## Step 4: Log it

Call `decision_log` with:

- `entity_id`
- `decision` : what was decided
- `why` : the real reason
- `alternatives` : array of `{option, rejected_because}` objects
- `chosen_direction` : one-sentence summary of the chosen option
- `proof_action` : concrete action that validates this
- `review_date` : YYYY-MM-DD
- `type` : from Step 3

The tool appends to the decision log, updates the entity's `last_decision`, and writes an audit entry.

## Step 5: Update the entity if needed

If the decision changes the entity's `next_move`, call `entity_update` to set it. If it clears a blocker, clear `blocked`.

## Output

```
========================================
  DECISION LOGGED
========================================
  Entity:     [name]
  ID:         [dec-XXX from decision_log return]
  Decision:   [one-line summary]
  Proof:      [proof action]
  Review by:  [date]
========================================
```

## Rules

- Never log trivial decisions (variable names, CSS tweaks). Only strategic ones.
- Every decision needs a proof action. Otherwise it's an opinion, not a decision.
- Every decision needs a review date. Decisions without expiry become dogma.
- `decision_check` runs FIRST, every time. No exceptions.
- MCP tools only. Name them in user-facing text.

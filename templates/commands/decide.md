# Brain OS : Decision Capture

Capture a strategic decision so it never gets lost or reopened accidentally.

This is not `/strategy` (which helps you think a decision through). This captures the decision after it's been made.

## Input

Arguments: `$ARGUMENTS` (format: `<entity-name> "<decision summary>"`)

If no arguments → review what was decided this session and ask what should be logged.

## Step 1: Conflict check

Before logging, call `decision_check` with the entity name and proposed decision summary. The tool returns one of:

- **clear** : no conflict, proceed.
- **caution** : a related decision exists. Surface it, ask the user if this supersedes it.
- **conflict** : a directly contradictory active decision exists. Stop. Show the conflict and ask the user to confirm before proceeding.

Never log a `conflict` result without explicit user confirmation.

## Step 2: Gather details

If a decision summary was provided, confirm and fill in gaps. If not, ask:

1. What was decided?
2. Why? (the real reason, not the polite one)
3. What alternatives were considered? (and rejected)
4. What's the proof action : one thing that validates this decision?
5. When should this be reviewed?

Keep it conversational. One message, not an interrogation.

## Step 3: Classify

Assign a decision type:

- **Product Direction** : what to build, what the product is
- **Architecture** : how to build it technically
- **Scope** : what to include or cut
- **Priority** : what to do first
- **Kill/Park** : stopping or pausing an entity or feature
- **Monetization** : how to make money
- **Brand** : identity, voice, positioning

## Step 4: Log it

Call `decision_log` with:

- `entity` : the entity name
- `decision` : what was decided
- `why` : the real reason
- `alternatives` : array of rejected options
- `proof_action` : the concrete action that validates this
- `review_date` : YYYY-MM-DD
- `type` : the classification from Step 3

The tool will append to the decision log and update the related entity's `last_decision`.

## Step 5: Update the entity

If the decision changes the entity's `next_move`, call `entity_update` to set it.

## Output

```
========================================
  DECISION LOGGED
========================================
  Entity:     [name]
  Decision:   [one-line summary]
  Proof:      [proof action]
  Review by:  [date]
========================================
```

## Rules

- Never log trivial decisions (variable names, CSS tweaks). Only strategic ones.
- Every decision needs a proof action. Otherwise it's an opinion, not a decision.
- Every decision needs a review date. Decisions without expiry become dogma.
- If `decision_check` returns `conflict`, do not proceed without explicit user confirmation.
- Do not read code. Use MCP tools only.

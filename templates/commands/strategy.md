# Brain OS : Strategy

For product decisions, concept rethinking, and direction. A thinking partner that helps you decide before you build.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. Tool routing matters here: `decision_check` runs early so you don't propose work that contradicts a settled decision.

## Input

Arguments: `$ARGUMENTS` (format: `<entity-name> "<question or problem>"`). If no question is given, read the entity and surface the open strategic question from its `open_questions` field.

## Primary tool sequence

1. `mcp__brain-os__entity_read(entity_id)` : load context, recent decisions, open questions
2. `mcp__brain-os__semantic_recall(question)` : surface related prior thinking across decisions, patterns, sessions
3. `mcp__brain-os__decision_check(question, entity_id)` : detect if this re-opens a settled decision

## Step 1: Load context

Identify the core strategic tension:

- Concept problem : does the idea actually work?
- Product decision : what to build, what to cut, what to gate
- Direction question : how to sell, who to sell to, what comes first
- Priority conflict : two valid paths, need to pick one

## Step 2: Name the real question

State the actual decision in one sentence. Not the symptom : the root choice.

Example:
- Not: "[Project] feels broken."
- But: "Does [project] produce real value when used for an actual decision, or is the concept flawed?"

## Step 3: Think it through

Use this structure. Keep each section short and direct.

### What we know
Facts from the entity and recent decisions. No speculation.

### The real question
The one decision that unlocks everything else.

### Options
2 to 3 real options only. No false choices. No "option C: do both."

### Recommendation
Pick one. Explain why in 2 sentences max. Be direct, don't hedge.

### Next move
One concrete action that proves or disproves the recommendation within a week.

## Step 4: Capture the outcome

Ask: "Is this the direction?"

If yes:
- `mcp__brain-os__decision_check` again with the chosen direction (final conflict gate)
- `mcp__brain-os__decision_log` (capture the decision)
- `mcp__brain-os__entity_update` (set the new `next_move`, clear `blocked` if resolved)

If no, do not log. Note the open question on the entity for next time via `entity_update`.

## Rules

- Never recommend building more before validating the concept.
- Never give more than 3 options.
- Always end with one concrete next move, not a list.
- If the user is stuck on "I don't know what I want", say that directly and ask the right question.
- Strategy before code, always.
- MCP tools only. Name them in user-facing text.

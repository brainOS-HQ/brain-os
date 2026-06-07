# Brain OS : What's in Queue

"What's coming up — plan steps, releases, backlog, and overdue decisions?"

Not a focus engine. A pipeline view. Shows the ordered queue of what's next, not just what's now.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`.

## Input

Arguments: `$ARGUMENTS` (optional project name to scope to one entity, e.g. "brain os" or "my-app")

## Primary tool sequence

1. `mcp__brain-os__context_resolve(user_message=$ARGUMENTS)` — resolve scope if a project is named
2. `mcp__brain-os__plan_read(entity_id)` — get the active plan and pending steps
3. `mcp__brain-os__entity_read(entity_id)` — get open questions and backlog signals
4. `mcp__brain-os__decision_review(entity_id, limit=5)` — surface overdue decision reviews

If no project is named, call `entity_read()` for all entities, then show the global queue view.

## Output format

```
BRAIN OS — QUEUE
═══════════════════════════════════════

ACTIVE NOW
  → [current plan step]

BLOCKERS (act first)
  🔴 [project]: [what is blocked and why]

OVERDUE DECISIONS (review before proceeding)
  - "[decision]" — [N] days overdue ([project])

NEXT MOVES (across all active projects)
  [Project A]: [next_move]
  [Project B]: [next_move]

PIPELINE
  [N+1]. [next step]
  [N+2]. [step after that]
  ...
  [release step]: [what ships in the next release]

UNRESOLVED QUESTIONS (oldest/highest-priority)
  ⏰ [question older than 7 days — needs resolution]
  ? [question — blocking current step]
  · [question — can wait]

PATTERNS REPEATING
  ~ [pattern detected across sessions]

═══════════════════════════════════════
```

## Rules

- **Sections only show if they have content** — no empty sections
- **Blockers first** — if anything is blocked, show it before everything else
- **Overdue decisions** — always surface, never hide, use decision_review
- **Next moves** — call entity_read for all active entities, show each entity's next_move
- **Aging rules for questions:**
  - ⏰ = older than 7 days unactioned
  - blocking current plan step = show with ?
  - backlog / can wait = show with ·
  - max 5 questions total — oldest/highest-priority first
- **Release queue** = plan steps tagged with version numbers
- **Patterns** = call pattern_detect, show active patterns (skip if none)
- Keep it scannable — one line per item, no prose
- Never show entity IDs, decision IDs, or internal field names
- Write in plain language

## Scoped vs global

- Named project → show that project's full queue only. Any cross-project alerts go at the bottom under "Elsewhere in your workspace worth checking:" if relevant.
- No project named → show all active entities' queues, ordered by priority score (critical first, then high, then medium)

# Brain OS : Focus Engine

"What should I work on today, and why?"

Not a dashboard. A judgment call backed by evidence.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`. It governs tool routing for every Brain OS skill.

## Input

Arguments: `$ARGUMENTS` (can be a project name like "brain os" or "ghost", OR a constraint like "only 2 hours" or "low energy today", OR both like "ghost, low energy")

## Primary tool sequence

### Step 0 — Resolve scope

Before calling `focus_get`, resolve whether this is a named/scoped focus or a global focus.

1. If `$ARGUMENTS` contains `--global` or `all`, skip scope resolution → use **General focus**.
2. If `$ARGUMENTS` names a project, call `mcp__brain-os__context_resolve(user_message=$ARGUMENTS)`.
3. If no project is named, obtain the client-visible workspace/folder path first (from client metadata or by running `pwd` in the active workspace), then call `mcp__brain-os__context_resolve(user_message=$ARGUMENTS, files_touched=[current workspace/folder path])`.
4. If `context_resolve` returns `entity_id` with `ask_user=false`, use **Named project** with that entity.
5. If `context_resolve` cannot resolve, but the client-visible folder is a known workspace mapping (for example `brain-os` → `tasha-brain`, `jinx-life` → `jinx-life`), use that as a weak client-side folder signal.
6. Only use **General focus** after scope resolution has actually run or after the user explicitly requested `--global` / `all`. Do not ask the user to clarify for a generic "focus" request unless the resolver reports an explicit ambiguity.

Important: this uses the client-visible workspace/folder path as an intent signal. It is not server-side `process.cwd()` inference. Explicit user project names always beat folder context.

### Step 1 — Scan repo evidence (when a workspace path is known)

If you have a client-visible workspace/folder path, call `mcp__brain-os__project_evidence_scan(root_path=<workspace path>, entity_id=<resolved entity, if any>)` BEFORE `focus_get`.

This is read-only and deterministic — it reads repo-native operating state (`STATE.md`, `FLAGS*`, `HANDOFF*`, `ROADMAP.md`, `PLAN*.md`, `TODO.md`, `AGENTS.md`) plus recent git activity and dirty files, and returns exact lines for: human gates, blockers, next moves, do-not-touch, and safe parallel work. It does NOT decide focus — it supplies evidence the brief combines with Brain OS memory.

Skip this step only when no workspace path is available (e.g. a purely conversational client). It is a separate adapter from `context_resolve` — never use it to pick which project you are in.

### Named project (user specified a project name OR context resolution found one):
1. `mcp__brain-os__focus_get(entity_id=<matched>)` : scoped priority for this project only
2. `mcp__brain-os__plan_read(entity_id)` : get active step and progress
3. `mcp__brain-os__decision_check(entity.next_move, entity_id)` : verify no active decision contradicts the next move

### General focus (`--global`, `all`, or no scope resolved):
1. `mcp__brain-os__focus_get(constraints=$ARGUMENTS)` : prioritized recommendations across all entities
2. `mcp__brain-os__entity_read(top_pick.entity_id)` : detail on the #1 priority
3. `mcp__brain-os__decision_check(top_pick.next_move, top_pick.entity_id)` : verify no active decision contradicts the recommendation

The `focus_get` tool returns: prioritized entities with scores and reasons, `do_not_do` list, staleness alerts, unreviewed decisions. Use that data first. Only fall back to `entity_read` / `pattern_detect` / `semantic_recall` if it returns empty.

## What to weigh (already encoded in focus_get, surface in output)

- Staleness, momentum, blockers, strategic leverage, urgency, recent decisions
- User constraint: if given, weight low-friction options higher

## Output

Write in PLAIN LANGUAGE. No JSON. No field names like entity_id or staleness.level. The user should understand what to do next without any technical knowledge.

Use this pattern (adapt to content, don't copy robotically):

```
Your top priority right now is **[PROJECT NAME]**.

**Do this next:**
1. [One concrete action — not "think about X"]
2. [Optional second step if obvious]

**Why this matters:**
[2 to 3 sentences in plain language. Strategic reason, consequence of not doing it, or what it unlocks. Not "it's overdue."]

**What not to do yet:**
- [Shiny distraction to resist]
- [Other project that can wait]
- [Reorganization or new idea]

[If there's a second priority, add it briefly:]

**After that, consider [SECOND PROJECT]:**
[One sentence on what and why]

---
[If staleness alerts exist for the FOCUSED project:]
**Heads up:** this project hasn't been touched in [N] days. Either ship something or park it.

[If unreviewed decisions exist for the FOCUSED project — focus_get returns this as `review_debt`:]
**Decision review due:** [N] decision(s) past their review date → run `/reconcile` to reaffirm, update, or archive them.

---
[For named-project focus, do not add other projects unless the user explicitly asks for global context.]
```

### When repo evidence is available — emit an operating brief

If `project_evidence_scan` returned evidence (next moves, human gates, dirty files, do-not-touch), the answer should be an **action router**, not a description. Combine Brain OS memory (focus_get) with the repo evidence and separate *who acts*: what the human must decide vs. what an agent can execute vs. what must not be touched. Still plain language — these are section cues, not rigid headers to copy robotically:

```
FOCUS NOW
[The one thing to do, in plain language.]

WHY
[Why this is the priority — what it unblocks or what breaks if skipped.]

HUMAN NEEDED
[The 1-3 actions only the user can do — decisions, approvals, gated steps. Pull from detected human gates.]

AGENT-SAFE WORK
[What an agent can execute now without waiting. Pull from safe parallel work / next moves that aren't gated.]

DO NOT TOUCH
[Files / phases / projects that would conflict or are gated. Pull from do-not-touch + conflict rules.]

EVIDENCE USED
[Briefly: STATE.md, recent commits, dirty files, Brain OS decisions — what this brief was grounded on.]
```

Omit any section that has no content (e.g. no human gate → no HUMAN NEEDED). If `project_evidence_scan` found nothing, fall back to the plain-language priority format above.

## After output

Ask: "Ready to start?"

## Rules

- Maximum 3 priorities. Usually 1 is best.
- Every priority needs a concrete next action.
- "What not to do" is mandatory. The problem is too many realities, not too few.
- If nothing is urgent, say so. "Low-urgency day, pick what has energy" is valid.
- If a proof action from a decision hasn't shipped, surface it.
- If an active entity is stale but has no blocker, call it fake-active. Recommend: ship or park.
- Never guilt-trip about parked entities.
- Write like you're talking to a smart friend, not filing a report.
- No JSON in the output. No field names. No scores. The engine does the scoring; the user sees the judgment.
- MCP tools are used internally but never named in user-facing output.

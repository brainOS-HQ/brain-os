# AGENTS.md

Agent operating instructions for the Brain OS repository.

This file is the **canonical** source of truth for how AI agents (Claude Code, GitHub Copilot, Cursor, Zed, Windsurf, Codex, any MCP-compatible client) should behave when working in this repo. Tool-specific files (`CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/brain-os.mdc`) are thin pointers to this document.

---

## Context

This repo IS Brain OS — an MCP server for persistent operational state across AI agents. State lives in `.brain/`. The MCP server is built from `src/`, published to npm as `brain-os`, and exposes tools prefixed `mcp__brain-os__*` when connected as a client.

When asked about project state, priorities, decisions, plans, blockers, or focus, you are answering questions about an **operating product**, not a codebase. Use the MCP tools. Do not grep source code.

---

## The hard rule

For ANY question about project state, priorities, decisions, patterns, focus, or what to work on, use the Brain OS MCP tools as the **primary** data source. Never read `src/tools/focus-get.ts` (or similar) to answer "what should I focus on" — that's the implementation of the tool, not the answer. Call the tool itself.

If you read source code as your first action on a state question, you are in generic-coding-assistant mode. Stop and re-route through MCP.

---

## Tool routing (in order)

| # | Tool | When to call |
|---|------|--------------|
| 1 | `mcp__brain-os__entity_read(entity_id?)` | First call for any project-state question. Omit `entity_id` to list all entities. |
| 2 | `mcp__brain-os__plan_read(entity_id)` | Get active step + progress for an entity. |
| 3 | `mcp__brain-os__focus_get(entity_id?, constraints?)` | Prioritized recommendations. Pass `entity_id` to scope to one project; omit for global. Use for "what should I work on." |
| 4 | `mcp__brain-os__semantic_recall(query, source_kind?)` | Fuzzy search when you don't know the entity ID or want cross-decision / pattern / session context. |
| 5 | `mcp__brain-os__decision_check(proposed_action, entity_id?)` | Call **before** any action that might contradict an active decision. Returns clear / caution / conflict. |
| 6 | `mcp__brain-os__pattern_detect()` | Surface current behavioral patterns. |
| 7 | `mcp__brain-os__entity_update`, `plan_update`, `decision_log`, `decision_refresh`, `memory_commit` | Mutating tools. Use when writing state back. |

Name the tool in user-facing text when you call it (e.g., "Calling `entity_read`..."). Reinforces the tool-first habit and makes routing visible.

---

## Mutation safety

Before any mutating call (`decision_log`, `entity_update`, `plan_update`, `decision_refresh`), call `decision_check` with a short description of the proposed action. If status is `conflict`, do NOT proceed without explicit user confirmation. If `caution`, surface the relevant active decision and ask.

Known v0.4.1 bugs (do not work around silently — surface them):

- `decision_log` over-supersedes any active decision of the same `entity_id + type`. Real fix is the explicit `supersedes: []` param shipping in v0.4.1. Until then, if a write supersedes unrelated decisions, mention it.
- `plan_advance` can promote later pending steps while an earlier step is still active. If you see multiple `active` steps in a plan, that's the bug.

---

## Output formatting

### `focus_get` results

Always show the scope line first, then format as a fixed-column table:

```
Scope: global

ENTITY               SCORE   MOMENTUM   NEXT
product-launch       75      high       Recruit 5 users for landing-page test
core-engine          75      high       Run smoke tests → fix bugs → publish patch
mobile-app           55      medium     Add missing production env var
```

For scoped focus (single entity):

```
Scope: Jinx

ENTITY               SCORE   MOMENTUM   NEXT
jinx-life            65      high       Ship onboarding flow v2
```

Plus a one-line **Do not do** summary and **Staleness alerts** as bullets. No long-form rephrasing of the JSON.

### `entity_read` for a single entity

Use the fixed format from `/brain <entity>`:

```
==============================
  [ENTITY NAME]
==============================
  STATUS      ...
  MODE        ...
  MOMENTUM    ...
  BLOCKED     ...
  NEXT        ...
  UPDATED     [date] : [Fresh/Aging/Stale/Dormant]
  ----------------------------
  ACTIVE PLAN ...
  RELATED     ...
  DECISIONS   ...
  ----------------------------
  OPEN        ...
==============================
```

### Mutations

After a successful write, return the resulting record's key fields (`id`, `date`, summary) in one short paragraph. Do not paraphrase the entire object.

---

## Terseness

- Do NOT create todo lists for state-reading questions. Just call the tool and return the answer.
- Do NOT narrate every step ("I'll first do X, then Y, then Z") — call tools and report results.
- Do NOT offer to do five follow-up things at the end of every response. One suggested next move is enough.
- Default to short. The user reads diffs, tool calls, and JSON directly — no need to re-explain them.

---

## Escape this protocol when

The task is genuinely outside Brain OS scope:

- Writing or editing source code (TypeScript, schemas, etc.) inside `src/`
- Running shell commands, builds, tests
- Reading source files to understand implementation (vs. to answer a state question)
- General web search or fetching docs

If the user asks "what should I work on" / "what's the state of X" / "is this decision still good", **stay in MCP tools.**

---

## Command vocabulary

Slash commands (`/brain`, `/focus`, etc.) are a Claude-Code-specific feature and do not exist in Copilot, JetBrains, etc. To give the same UX in any client, treat these **bare keywords** as command shortcuts when the user types them in chat. Match the leading word case-insensitively; ignore extra surrounding text only if it's clearly a clarifier.

| Keyword | Run | Output |
|---|---|---|
| `brain` (no arg) | `entity_read()` + `pattern_detect()` + `focus_get(max_results=3)` | Master overview table (see Output formatting) |
| `brain <entity-id>` | `entity_read(entity_id)` + `plan_read(entity_id)` + `decision_check("scan", entity_id)` | Single-entity card (see Output formatting) |
| `focus` | If CWD maps to a known entity → `focus_get(entity_id=<matched>)`. Otherwise → `focus_get(max_results=3)` (global). | Scoped or global priorities table + do-not-do + staleness alerts. Response always shows `Scope: <name>` or `Scope: global`. |
| `focus --global` or `focus all` | `focus_get(max_results=3)` | Force global priorities even when inside a project folder. |
| `focus <constraints>` | `focus_get(constraints)` | Same, scoped by constraints (e.g. "only 2 hours", "low energy") |
| `decide` or `decide <topic>` | Guide user through `decision_log` with `decision_check` first | Logged decision summary (id, date, decision, why) |
| `wrap` | `entity_read()` to find dirty entities + propose `entity_update` calls | Wrap summary, ask for confirmation before mutating |
| `retro` | `entity_read()` + `pattern_detect(scope="recent")` + `semantic_recall("last 7 days")` | Weekly retro narrative grouped by entity |
| `patterns` | `pattern_detect()` | Active patterns + new patterns + risk lines |
| `graph` or `graph <entity>` | `entity_read()` to walk `related_entities` | ASCII relationship graph |
| `strategy <question>` | `semantic_recall(question)` + `decision_check(question)` | Decision-framework analysis |

If the user types `/brain` or `/focus` etc. in a client that doesn't support custom slash commands, treat the leading `/` as a hint and run the matching command anyway.

---

## CWD → entity mapping

When a user runs `focus` (or other context-sensitive commands) from inside a project folder, infer the entity:

1. Take the CWD folder name (e.g. `jinx-life`, `brain-os`, `the-boards`)
2. Check if an entity with that ID exists via `entity_read(entity_id)`
3. If it matches → use that entity_id for scoped focus
4. If no match → fall back to global focus

Common mappings where folder ≠ entity ID: the agent should call `entity_read()` once to scan names if the folder name doesn't match an entity ID directly (e.g. `brain-os` folder → `tasha-brain` entity). Clients that support MCP roots expose the CWD via `listRoots`.

---

## Staleness

Calculate from each entity's `last_updated`:

- Fresh: 0 to 7 days
- Aging: 8 to 21 days
- Stale: 22 to 45 days
- Dormant: 45+ days

Skip the staleness alert for entities with `mode = parked` or `archived`.

---

## Drift check

If your first action on a state question is reading pulse files (`~/.claude/projects/.../memory/*-pulse.md`), `decision-log.md`, or any file under `.brain/` directly, **stop**. You are in generic-Claude mode. Route through the MCP tools above.

The user is building a memory product. Degraded behavior here is the worst possible signal.

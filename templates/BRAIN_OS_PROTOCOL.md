# Brain OS Protocol — REQUIRED READING

You are operating inside a Brain OS workspace. A `.brain/` directory exists in the project root. The Brain OS MCP server is connected. Tools prefixed `mcp__brain-os__*` are available.

This protocol governs how every Brain OS slash command operates. Skills load this file first, then add their specific intent. Follow the routing below before doing anything else.

---

## The hard rule

For ANY question about project state, priorities, decisions, patterns, focus, or what to work on, use Brain OS MCP tools as the **primary** data source. Pulse files (in `~/.claude/projects/.../memory/`) are stale by design. They are personal-global snapshots that drift between updates. The MCP tools read the **live** `.brain/` store.

If you read pulse files when MCP tools are available, you give the user a degraded experience that looks like Brain OS but is generic file search. Do not do this.

---

## Tool routing (in order)

| # | Tool | When to call |
|---|------|--------------|
| 1 | `mcp__brain-os__entity_read(entity_id?)` | First call for any project-state question. Omit `entity_id` to list all entities. |
| 2 | `mcp__brain-os__plan_read(entity_id)` | Get active step + progress for an entity. |
| 3 | `mcp__brain-os__focus_get(entity_id?, constraints?)` | Prioritized recommendations. Pass `entity_id` to scope to one project; omit for global. Use for "what should I work on." |
| 4 | `mcp__brain-os__semantic_recall(query, source_kind?)` | Fuzzy search when you don't know the entity ID or want cross-decision / pattern / session context. |
| 5 | `mcp__brain-os__decision_check(proposed_action, entity_id?)` | Call **before** proposing any action that might contradict an active decision. Returns clear / caution / conflict. |
| 6 | `mcp__brain-os__pattern_detect()` | Surface current behavioral patterns. |
| 7 | `mcp__brain-os__entity_update`, `plan_update`, `decision_log`, `decision_refresh`, `memory_commit` | Mutating tools. Use when the skill writes state back. |

---

## Fallback chain (only when MCP is unreachable)

1. If `mcp__brain-os__entity_read` errors or no `.brain/` exists in the workspace, fall back to pulse files at `~/.claude/projects/-Users-<user>/memory/*-pulse.md`.
2. If pulse files don't exist either, treat the workspace as un-tracked. Ask the user whether to run `brain-os init`.

---

## When to ESCAPE this protocol

Step outside Brain OS tools only when the task is genuinely outside Brain OS scope:

- Writing or editing code unrelated to Brain OS state
- Running shell commands, builds, tests
- Reading source files to understand code structure
- General web search or fetching docs

If the user asks "what should I work on" / "what's the state of X" / "is this decision still good", **stay in Brain OS.**

---

## Naming discipline

When you call a Brain OS MCP tool, name it in user-facing text. Example:

> "Calling `entity_read` to get fresh state on your project..."

This reinforces the user's habit of using Brain OS tools intentionally.

---

## Drift check

If you find yourself reading pulse files, `decision-log.md`, or `pattern-log.md` as your **first** action inside a Brain OS workspace, stop. You are in generic-Claude mode. Re-route through the MCP tools above.

The user is building a memory product. Degraded behavior here is the worst possible signal.

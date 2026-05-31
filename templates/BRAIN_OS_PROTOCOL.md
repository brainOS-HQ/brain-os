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
| 3 | `mcp__brain-os__context_resolve(user_message?, files_touched?, explicit_entity_id?)` | Resolve context before `focus_get` / `decision_check` when the target entity is not already known. For "what should I work on" from inside a workspace, call this before `focus_get`. |
| 4 | `mcp__brain-os__project_evidence_scan(root_path, entity_id?)` | Read-only repo evidence (STATE.md, FLAGS*, HANDOFF*, ROADMAP/PLAN/TODO, git activity, dirty files). Call AFTER `context_resolve` and BEFORE `focus_get` when a workspace path is known, so the focus answer is grounded in repo-native state, not only `.brain` memory. NOT a router — never use it to pick the project. |
| 5 | `mcp__brain-os__focus_get(entity_id?, constraints?)` | Prioritized recommendations. Pass resolved `entity_id` to scope to one project; omit only for explicit global focus or unresolved context. |
| 6 | `mcp__brain-os__semantic_recall(query, source_kind?)` | Fuzzy search when you don't know the entity ID or want cross-decision / pattern / session context. |
| 7 | `mcp__brain-os__decision_check(proposed_action, entity_id?)` | Call **before** proposing any action that might contradict an active decision. Returns clear / caution / conflict. |
| 8 | `mcp__brain-os__pattern_detect()` | Surface current behavioral patterns. |
| 9 | `mcp__brain-os__entity_update`, `plan_update`, `decision_log`, `decision_refresh`, `memory_commit` | Mutating tools. Use when the skill writes state back. |

For focus requests, do not call `focus_get` first. The focus pipeline is: `context_resolve` (which project?) → `project_evidence_scan` (what does the repo say now?) → `focus_get` (what does Brain OS memory say?) → combined operating brief. Resolve context first unless the user explicitly says `--global` / `all`.

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

# Zed Agent Rules

This project uses **Brain OS** — an MCP server for persistent operational state. State lives in `.brain/`.

## Canonical instructions

See [`AGENTS.md`](../AGENTS.md) at the project root. It is the cross-tool source of truth. This file exists only so Zed's agent picks up the same rules.

## Critical rules (also in AGENTS.md)

1. **Brain OS MCP tools are the primary data source** for any question about project state, priorities, decisions, plans, blockers, or focus. Tools are prefixed `mcp__brain-os__` (e.g., `entity_read`, `focus_get`, `decision_log`, `decision_check`). Do NOT grep source code to answer state questions.

2. **Routing order:** `entity_read` → `plan_read` → `focus_get` → `semantic_recall` → `decision_check` → `pattern_detect`. Mutating tools (`decision_log`, `entity_update`, `plan_*`, `decision_refresh`) require a prior `decision_check`.

3. **Conflict handling:** if `decision_check` returns `conflict`, do not proceed without explicit user confirmation.

4. **Output format:** fixed-column tables for `focus_get`, single-card format for `entity_read`. No long-form rephrasing of tool output.

5. **Command vocabulary:** when the user types bare keywords (`brain`, `focus`, `decide`, `wrap`, `retro`, `patterns`, `graph`, `strategy`) with or without a leading `/`, run the matching MCP tool sequence per the AGENTS.md command table.

6. **No todo lists for state-reading questions.** Call the tool, return the answer.

7. **Drift check:** if your first action on a state question is reading `.brain/` files directly, stop and re-route through the MCP tools.

# GitHub Copilot instructions

This project uses **Brain OS** — an MCP server for persistent operational state. State lives in `.brain/`.

## Read this first

All agent instructions for this project live in [`AGENTS.md`](../AGENTS.md). Follow that document. This file exists only so VS Code GitHub Copilot picks up the same rules.

## Critical rules (also in AGENTS.md)

1. **Use the Brain OS MCP tools as the primary data source** for any question about project state, priorities, decisions, plans, blockers, or focus. The tools are exposed as `brain-os` in your MCP server list (`entity_read`, `focus_get`, `decision_log`, `decision_check`, `decision_refresh`, `plan_read`, `plan_advance`, `pattern_detect`, `semantic_recall`, etc.). Do NOT grep source code to answer state questions — call the tool itself.

2. **No todo lists for state-reading questions.** When the user asks "what should I work on" or "scan the project", call the MCP tool and return the answer directly.

3. **Format output as compact tables, not paragraphs.** See "Output formatting" in AGENTS.md. For `focus_get`, return a fixed-column table:
   ```
   ENTITY               SCORE   MOMENTUM   NEXT
   project-alpha        75      high       Recruit 5 for usability test
   ```
   Then one line of `do_not_do`, one line of `staleness_alerts`. No long-form rephrasing.

4. **Mutation safety.** Before any `decision_log`, `entity_update`, or `plan_*`, call `decision_check` with a short description of the proposed action. If status is `conflict`, do NOT proceed without explicit user confirmation.

5. **Command vocabulary.** When the user types `brain`, `focus`, `decide`, `wrap`, `retro`, `patterns`, `graph`, or `strategy` in chat (with or without a leading `/`), run the matching MCP tool sequence from the table in AGENTS.md. Do not search the repo for these words.

6. **Terseness.** Don't end every response with "would you like me to do X, Y, or Z?" — one suggested next move is enough.

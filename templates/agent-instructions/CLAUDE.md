# CLAUDE.md

This project uses **Brain OS** for persistent operational state. State lives in `.brain/`.

## Agent instructions

See [`AGENTS.md`](./AGENTS.md). It is the canonical, cross-tool instruction file for how to behave in this project (MCP tool routing, output formatting, mutation safety, command vocabulary). This `CLAUDE.md` exists only so Claude Code finds the same rules; do not duplicate content here.

## Project memory

Brain OS is the project's operational state. Run `/brain` to scan state, `/focus` for priorities, `/wrap` to end a session. State lives in `.brain/`, not in this file.

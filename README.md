# Brain OS

Persistent operational memory for AI agents. Decisions, priorities, and project state that survive across sessions.

## What is this?

AI agents are powerful inside a session but start fresh every time. Brain OS gives them operational memory — not conversation logs, but structured state:

- **Entities** — track projects, deals, initiatives with status, momentum, blockers, and next moves
- **Decisions** — log what was decided, why, what alternatives were rejected, and when to revisit
- **Patterns** — detect recurring blockers, stale work, avoidance signals, and theme convergence
- **Focus** — prioritize what to work on based on urgency, momentum, leverage, and staleness
- **Semantic recall** — search memory by meaning, not just ID

Brain OS is an [MCP server](https://modelcontextprotocol.io) that works with any MCP-compatible client — Claude Code, Cursor, or any agent that speaks the protocol.

## Quick start

```bash
# Install globally
npm install -g brain-os

# Initialize in your project
brain-os init

# Or run directly
npx brain-os init
```

This creates a `.brain/` directory with your entity, decision, and pattern stores.

### Connect to Claude Code

```bash
claude mcp add brain-os node /path/to/brain-os/dist/index.js
```

### Connect to Cursor / other MCP clients

Add to your MCP config:

```json
{
  "brain-os": {
    "command": "node",
    "args": ["/path/to/brain-os/dist/index.js"]
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `entity_read` | Read operational state of one or all tracked entities |
| `entity_update` | Update entity state — status, momentum, blockers, next moves |
| `decision_log` | Log a strategic decision with reasoning and alternatives |
| `focus_get` | Get prioritized recommendations on what to work on |
| `pattern_detect` | Analyze patterns across all entities |
| `memory_check` | Audit memory quality — flags stale data, contradictions, noise |
| `memory_commit` | End-of-session commit — save all state changes |
| `semantic_recall` | Search memory by meaning using natural language |

## How it works

Brain OS stores everything as local JSON files in a `.brain/` directory:

```
.brain/
  entities/     — one file per tracked entity
  decisions/    — decision log
  patterns/     — detected patterns
  config.json   — workspace settings
```

No cloud. No database. No account. Your data stays on your machine.

## Auto-loaded status

When an MCP client connects, Brain OS exposes a `brain://status` resource with an operational overview — active entities, alerts, top priority, and recent decisions. The agent starts every session with context, not amnesia.

## License

MIT

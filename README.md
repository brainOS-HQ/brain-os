<p align="center">
  <img src="https://raw.githubusercontent.com/brainOS-HQ/brain-os/main/assets/hero.png" alt="Brain OS - Operational memory for AI agents" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/brain-os"><img src="https://img.shields.io/npm/v/brain-os.svg?color=blue" alt="npm version" /></a>
  <a href="https://github.com/brainOS-HQ/brain-os/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-purple.svg" alt="MCP Compatible" /></a>
  <a href="https://brainos-hq.com"><img src="https://img.shields.io/badge/site-brainos--hq.com-black.svg" alt="brainos-hq.com" /></a>
</p>

# Brain OS

**[brainos-hq.com](https://brainos-hq.com)**

Persistent operational memory for AI agents. Decisions, priorities, and project state that survive across sessions.

## What is this?

AI agents are powerful inside a session but start fresh every time. Brain OS gives them operational memory — not conversation logs, but structured state:

- **Entities** — track projects, deals, initiatives with status, momentum, blockers, and next moves
- **Decisions** — log what was decided, why, what alternatives were rejected, and when to revisit
- **Patterns** — detect recurring blockers, stale work, avoidance signals, and theme convergence
- **Focus** — prioritize what to work on based on urgency, momentum, leverage, and staleness
- **Semantic recall** — search memory by meaning, not just ID

Brain OS is an [MCP server](https://modelcontextprotocol.io) that works with any MCP-compatible client — Claude Code, Cursor, or any agent that speaks the protocol.

## What it looks like in use

Before the agent acts, it can check whether a proposed move conflicts with an existing decision:

```
> decision_check({ proposal: "switch to Postgres for the new service" })

{
  "verdict": "conflict",
  "conflicting_decision": {
    "id": "dec_2026_03_14_db_choice",
    "decision": "Use SQLite for all local-first projects",
    "reason": "Lower ops burden, no infra to run, fits single-user scope",
    "rejected_alternatives": ["Postgres", "DuckDB"],
    "logged_at": "2026-03-14"
  },
  "guidance": "Re-litigating a settled choice. Surface the prior reasoning to the user before proceeding."
}
```

That's the wedge: structured state with enforcement, so agents stop re-opening questions you already answered.

## Quick start

```bash
# In your project
npx brain-os init
```

This does two things:

1. **Creates a `.brain/` directory** with your entity, decision, and pattern stores.
2. **Installs slash commands** into `.claude/commands/` so you can run `/brain`, `/brain:focus`, `/brain:decide`, etc. directly in Claude Code. Bare aliases (`/focus`, `/decide`, etc.) install alongside for brevity.

Skip the slash commands with `npx brain-os init --no-commands` if you only want the MCP server.

### Connect to Claude Code

```bash
claude mcp add brain-os -- npx brain-os serve
```

### Connect to Cursor / other MCP clients

Add to your MCP config:

```json
{
  "brain-os": {
    "command": "npx",
    "args": ["-y", "brain-os", "serve"]
  }
}
```

### Configure semantic search (optional)

The `semantic_recall` tool needs an embeddings provider. Everything else (`entity_update`, `decision_log`, `plan_*`, etc.) works without one.

Pick a provider by adding `BRAIN_EMBEDDINGS` to your MCP server env:

```json
{
  "brain-os": {
    "command": "npx",
    "args": ["-y", "brain-os", "serve"],
    "env": {
      "BRAIN_EMBEDDINGS": "local"
    }
  }
}
```

| Mode | What it does | Setup |
|------|--------------|-------|
| `local` | Downloads a ~100MB on-device model (`Xenova/all-MiniLM-L6-v2`). Runs on your CPU. No data leaves your machine. | Just set `BRAIN_EMBEDDINGS=local`. First call to `semantic_recall` triggers the model download (~30s on good wifi). |
| `openai` | Uses `text-embedding-3-small` via the OpenAI API. Faster than local. Costs ~$0.02 per million tokens. | Set both `BRAIN_EMBEDDINGS=openai` and `OPENAI_API_KEY=sk-...` |

If `BRAIN_EMBEDDINGS` is unset, `semantic_recall` returns a clear error with this config snippet. No silent downloads, no surprise API calls.

## Tools

| Tool | Description |
|------|-------------|
| `entity_read` | Read operational state of one or all tracked entities |
| `entity_update` | Update entity state — status, momentum, blockers, next moves |
| `decision_log` | Log a strategic decision with reasoning and alternatives |
| `decision_check` | Check a proposed action against active decisions — returns clear/caution/conflict |
| `decision_refresh` | Refresh an existing decision: bump review_date, append evidence, change status. Metadata only — does not mutate decision content. |
| `focus_get` | Get prioritized recommendations on what to work on |
| `pattern_detect` | Analyze patterns across all entities |
| `memory_check` | Audit memory quality — flags stale data, contradictions, noise |
| `memory_commit` | End-of-session commit — save all state changes |
| `semantic_recall` | Search memory by meaning using natural language |
| `audit_log` | Read the full mutation history — what changed, when, by whom |
| `plan_set` | Set an ordered plan for an entity — step 1 becomes active next_move |
| `plan_advance` | Complete or skip a step (requires evidence/reason) — auto-promotes next |
| `plan_add` | Add steps to an existing plan |
| `plan_read` | View plan progress and current step |

## Slash commands

`brain-os init` installs slash commands into `.claude/commands/` so the agent has a clear vocabulary for working with operational state. Each command installs in two forms: `/brain:*` (canonical, documented form) and a bare alias (`/decide`, `/focus`, etc.) for power-user brevity. `/brain` is the namespace root and installs once.

It also installs:

- **`BRAIN_OS_PROTOCOL.md`** at `.claude/brain-os/PROTOCOL.md` (project) and `~/.claude/brain-os/PROTOCOL.md` (user). The protocol governs tool routing: when an agent runs a Brain OS slash command, it reads the protocol first, then calls `entity_read`/`plan_read`/`focus_get`/etc. as primary. Pulse files become fallback only.
- **`brain-os-mode` subagent** at `.claude/agents/brain-os-mode.md`. When the main agent delegates Brain OS work to a subagent (e.g. Claude Code's Task tool), it picks up under the same protocol — no risk of subagents falling back to generic file search.
- **Optional routing-guard hook** at `templates/hooks/brain-os-routing-guard.py`. Opt-in PreToolUse hook that warns if pulse files are read while a `.brain/` workspace exists. Install instructions are printed by `brain-os init`.

| Command | Alias | What it does |
|---------|-------|-------------|
| `/brain` | — | Project scanner: overview of all entities, freshness, decisions, alerts |
| `/brain:focus` | `/focus` | "What should I work on today, and why?" with evidence |
| `/brain:decide` | `/decide` | Capture a strategic decision (with conflict check before logging) |
| `/brain:strategy` | `/strategy` | Strategic thinking partner: think a decision through before building |
| `/brain:wrap` | `/wrap` | Session wrap: update entity state, capture decisions, detect momentum shifts |
| `/brain:patterns` | `/patterns` | Detect patterns across entities: recurring blockers, avoidance, themes |
| `/brain:retro` | `/retro` | Weekly or monthly retrospective: what shipped, what stalled, what's hidden |
| `/brain:graph` | `/graph` | Show how entities connect, leverage opportunities, shared decisions |

### Idempotent install

Re-running `init` is safe and repair-aware: existing Brain OS commands are preserved, and any missing form is installed. If a command path is taken by another tool, that path is skipped and reported — your file is never overwritten. You can install Brain OS into a project with existing `/decide` or `/focus` commands and the namespaced `/brain:*` forms will still land.

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

## Why no UI?

The interface is the agent. Brain OS is read and written through MCP tool calls — `/brain`, `/focus`, `/decide`, `decision_check`, etc. — surfaced inline by whichever client you use (Claude Code, Cursor, etc.). There's no separate dashboard to keep open, no second tab to context-switch into, no UI state that can drift from the underlying files.

This is a design choice, not a missing feature. Brain OS state lives at the same level as your code; the agent is already there, already in the conversation, already the right surface to ask "what's the priority right now?" Adding a human dashboard would split attention between two interfaces for the same data.

If you want a visual at-a-glance view, `.brain/` is plain JSON — render it however you want. The public MCP server stays agent-native by design.

## Teams & sync

Brain OS is single-user by design today. But because `.brain/` is just local JSON files, teams can share a brain through any synced filesystem — no product changes needed:

| Approach | Pros | Cons |
|----------|------|------|
| **Git** — commit `.brain/` to the repo | Diff/merge tools, version history, intentional sync points | Manual `git pull`; merge conflicts on simultaneous edits |
| **Dropbox / Drive shared folder** | Real-time-ish, no manual steps | Concurrent writes can create conflict files; `embeddings.json` rewrites often |
| **NFS / SMB / S3 mount** | Truly real-time | Requires infrastructure setup |

This works without any built-in sync because **every Brain OS tool call reads fresh from disk** — there's no in-memory cache to invalidate. Whatever your filesystem syncs, the next tool call sees. Same applies cross-tool: log a decision from Claude Code on Monday, open Cursor on Tuesday — same brain, both agents.

Native encrypted team sync with proper merge semantics is on the roadmap. The local-first foundation today is what makes that federation additive, not a retrofit.

## Auto-loaded status

When an MCP client connects, Brain OS exposes a `brain://status` resource with an operational overview — active entities, alerts, top priority, and recent decisions. The agent starts every session with context, not amnesia.

## Testing

Brain OS has no automated test suite yet. The 15 MCP tools are exercised through real daily use across 18 projects, but coverage is manual. Adding a smoke test suite for the core tools (`decision_log`, `decision_check`, `decision_refresh`, `entity_update`, `semantic_recall`) is on the roadmap.

If you hit a bug, please open an issue with the tool, input, and output — that's the fastest path to a fix.

## Community

- **Discord:** [discord.gg/9VBUGstjY](https://discord.gg/9VBUGstjY) — questions, feedback, what broke for you, what you're shipping with Brain OS
- **Site:** [brainos-hq.com](https://brainos-hq.com)
- **Issues:** [github.com/brainOS-HQ/brain-os/issues](https://github.com/brainOS-HQ/brain-os/issues)

## License

MIT

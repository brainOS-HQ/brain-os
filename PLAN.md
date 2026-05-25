# Brain OS — Technical Plan

## What This Is

A local-first MCP server that gives AI agents persistent operational state.

Not conversation memory. Operational state: entity state, decisions, blockers, patterns, relationships, and priorities that persist across sessions and inform judgment.

## Positioning

> AI agents are powerful inside a session but unreliable across time. Brain OS gives them operational state.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  AI Client (Claude Code / Cursor / Agent)       │
│                                                 │
│  Calls MCP tools:                               │
│  entity_read, entity_update, decision_log,      │
│  focus_get, pattern_detect, memory_commit        │
└──────────────────┬──────────────────────────────┘
                   │ MCP Protocol (stdio)
┌──────────────────▼──────────────────────────────┐
│  Brain OS MCP Server                            │
│                                                 │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐          │
│  │ Tools   │ │ Schemas │ │ Utils    │          │
│  │ layer   │ │ layer   │ │ layer    │          │
│  └────┬────┘ └────┬────┘ └────┬─────┘          │
│       └───────────┼───────────┘                 │
│                   │                              │
│            ┌──────▼──────┐                      │
│            │ File Store  │                      │
│            └──────┬──────┘                      │
└───────────────────┼─────────────────────────────┘
                    │ reads/writes
┌───────────────────▼─────────────────────────────┐
│  .brain/ (local directory)                      │
│                                                 │
│  entities/        — pulse files per entity       │
│  decisions/       — decision log                 │
│  patterns/        — pattern log                  │
│  config.json      — workspace settings           │
└─────────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime:** Node.js
- **Language:** TypeScript
- **MCP SDK:** @modelcontextprotocol/sdk
- **Storage:** Local JSON/Markdown files (no database)
- **Transport:** stdio (standard MCP transport)
- **Package manager:** npm
- **Distribution:** npx brain-os init / npm install -g brain-os

## Project Structure

```
brain-os/
├── package.json
├── tsconfig.json
├── PLAN.md
├── src/
│   ├── index.ts              — entry point, starts MCP server
│   ├── server.ts             — server setup, tool registration
│   ├── tools/
│   │   ├── entity-read.ts    — read one or all entities
│   │   ├── entity-update.ts  — update entity state
│   │   ├── decision-log.ts   — log a strategic decision
│   │   ├── focus-get.ts      — priority recommendation
│   │   ├── pattern-detect.ts — cross-entity pattern analysis
│   │   └── memory-commit.ts  — session close + state save
│   ├── schemas/
│   │   ├── entity.ts         — entity type definitions
│   │   ├── decision.ts       — decision type definitions
│   │   └── pattern.ts        — pattern type definitions
│   └── utils/
│       ├── file-store.ts     — read/write .brain/ directory
│       ├── staleness.ts      — freshness calculation
│       └── init.ts           — brain init command
├── schemas/
│   ├── entity.schema.json    — JSON Schema for entities
│   ├── decision.schema.json  — JSON Schema for decisions
│   └── pattern.schema.json   — JSON Schema for patterns
├── examples/
│   ├── solo-builder/         — example: indie dev with 3 projects
│   └── sales-team/           — example: small sales team with deals
└── bin/
    └── brain-os.js           — CLI entry point
```

## MCP Tool Definitions

### 1. entity_read

Read one entity or list all entities with staleness.

```typescript
{
  name: "entity_read",
  description: "Read operational state of one or all tracked entities. Returns current status, momentum, blockers, decisions, staleness, and next actions. Use this at the start of any session to understand what exists and what matters.",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: {
        type: "string",
        description: "ID of a specific entity to read. Omit to get summary of all entities."
      }
    }
  }
}
```

**Behavior:**
- If `entity_id` provided → return full entity state + staleness calculation + related entities + recent decisions for this entity
- If omitted → return summary table of all entities: id, name, mode, momentum, staleness, blocker, next_move

### 2. entity_update

Update an entity's operational state.

```typescript
{
  name: "entity_update",
  description: "Update the operational state of a tracked entity. Use after work is done, a decision is made, a blocker changes, or momentum shifts. Always update last_updated.",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity to update" },
      updates: {
        type: "object",
        properties: {
          status: { type: "string" },
          mode: { enum: ["active", "parked", "incubating", "archived"] },
          mode_reason: { type: "string" },
          momentum: { enum: ["high", "medium", "low", "stalled"] },
          priority: { enum: ["critical", "high", "medium", "low"] },
          blocked: { type: ["string", "null"] },
          next_move: { type: "string" },
          last_decision: { type: "string" },
          evidence_of_progress: { type: "string" },
          open_questions: { type: "array", items: { type: "string" } },
          related_entities: { type: "array", items: { type: "string" } }
        }
      }
    },
    required: ["entity_id", "updates"]
  }
}
```

**Behavior:**
- Merge updates into existing entity file
- Auto-set `last_updated` to today
- Recalculate staleness
- If mode changed to `parked` or `archived`, require `mode_reason`
- Return updated entity state

### 3. decision_log

Log a strategic decision with full context.

```typescript
{
  name: "decision_log",
  description: "Log a strategic decision so it persists across sessions and cannot be accidentally reopened. Every decision needs a reason, alternatives considered, and a proof action.",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity this decision applies to" },
      decision: { type: "string", description: "What was decided" },
      type: { enum: ["product_direction", "architecture", "scope", "priority", "kill_park", "monetization", "brand"] },
      why: { type: "string", description: "The real reason — not the polite one" },
      alternatives: {
        type: "array",
        items: {
          type: "object",
          properties: {
            option: { type: "string" },
            rejected_because: { type: "string" }
          }
        }
      },
      chosen_direction: { type: "string" },
      proof_action: { type: "string", description: "One concrete action that validates this decision" },
      review_date: { type: "string", description: "YYYY-MM-DD — when to revisit" }
    },
    required: ["entity_id", "decision", "why", "proof_action", "review_date"]
  }
}
```

**Behavior:**
- Append to decisions log file
- Auto-assign decision ID and timestamp
- Check for existing active decisions on the same entity + type → flag potential supersession
- Update entity's `last_decision` field
- Return logged decision with ID

### 4. focus_get

Calculate what deserves attention right now.

```typescript
{
  name: "focus_get",
  description: "Determine what to work on right now based on urgency, momentum, leverage, staleness, blockers, and dependencies. Returns prioritized recommendations with evidence and a 'do not do' list.",
  inputSchema: {
    type: "object",
    properties: {
      constraints: {
        type: "string",
        description: "Optional constraints like 'only 2 hours', 'low energy', 'only entity X'"
      },
      max_results: {
        type: "number",
        description: "Max priorities to return (default 3)"
      }
    }
  }
}
```

**Behavior:**
- Read all active/incubating entities
- Read recent decisions (check for unexecuted proof actions)
- Read pattern log (check for active risks)
- Score each entity on: urgency, momentum, strategic leverage, staleness risk, blocker clearability, dependency impact
- Apply constraints if given
- Return: top N priorities with evidence + "do not do" list + staleness alerts

### 5. pattern_detect

Find patterns across entities over time.

```typescript
{
  name: "pattern_detect",
  description: "Analyze behavioral and strategic patterns across all tracked entities. Detects: repeated blockers, stale-but-active entities, recurring decisions, convergence themes, execution gaps, and avoidance signals.",
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        description: "'recent' for last 7 days, 'deep' for full analysis, or a specific theme to investigate"
      }
    }
  }
}
```

**Behavior:**
- Read all entities + decisions + existing patterns
- Detect: blocker recurrence, decision repetition, momentum patterns, theme emergence, execution-discussion gap, avoidance signals, convergence opportunities
- Compare against existing pattern log → confirm, update, or retire patterns
- Return: new patterns found + existing pattern status check
- Each pattern includes: evidence, interpretation, risk, recommendation

### 6. memory_commit

Close a session cleanly. Persist all state changes.

```typescript
{
  name: "memory_commit",
  description: "End-of-session commit. Updates all touched entities, logs decisions made, records patterns noticed, and ensures memory state is clean for the next session. Call this before ending any work session.",
  inputSchema: {
    type: "object",
    properties: {
      session_summary: {
        type: "string",
        description: "Brief summary of what happened this session"
      },
      entities_touched: {
        type: "array",
        items: { type: "string" },
        description: "Entity IDs that were worked on"
      },
      decisions_made: {
        type: "array",
        items: {
          type: "object",
          properties: {
            entity_id: { type: "string" },
            decision: { type: "string" },
            why: { type: "string" }
          }
        },
        description: "Decisions to log (simplified — full details prompted if needed)"
      },
      patterns_noticed: {
        type: "array",
        items: { type: "string" },
        description: "Any patterns observed during the session"
      },
      momentum_changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            entity_id: { type: "string" },
            direction: { enum: ["up", "same", "down", "stalled"] }
          }
        }
      }
    },
    required: ["session_summary", "entities_touched"]
  }
}
```

**Behavior:**
- Update `last_updated` on all touched entities
- Log any decisions to decision file
- Log any patterns to pattern file
- Update momentum on changed entities
- Write session record to `.brain/sessions/` (for future retro analysis)
- Return: session summary + what was persisted + next session should start with

## Data Schemas

### Entity (stored as JSON in .brain/entities/)

```json
{
  "id": "project-alpha",
  "name": "Project Alpha",
  "type": "project",
  "status": "Building auth module",
  "mode": "active",
  "momentum": "high",
  "priority": "high",
  "blocked": null,
  "next_move": "Wire up OAuth flow and test with Google provider",
  "last_decision": "Use OAuth2 instead of custom auth — simpler, more secure",
  "evidence_of_progress": "Database schema complete, API routes defined, frontend auth components built",
  "open_questions": ["Should we support Apple Sign-In in v1?"],
  "related_entities": ["project-beta", "infra-setup"],
  "metadata": {
    "path": "/Users/dev/project-alpha",
    "repo": "github.com/user/project-alpha"
  },
  "created_at": "2026-04-15",
  "last_updated": "2026-04-30"
}
```

### Decision (stored in .brain/decisions/)

```json
{
  "id": "dec-001",
  "date": "2026-04-30",
  "entity_id": "project-alpha",
  "type": "architecture",
  "decision": "Use OAuth2 instead of custom auth",
  "why": "Custom auth is a security liability and 3x the development time for no user benefit",
  "alternatives": [
    { "option": "Custom JWT auth", "rejected_because": "Security risk, maintenance burden" },
    { "option": "Magic link only", "rejected_because": "Poor UX for frequent users" }
  ],
  "chosen_direction": "OAuth2 with Google + GitHub providers",
  "proof_action": "Get Google OAuth working in dev by end of week",
  "review_date": "2026-05-14",
  "status": "active"
}
```

### Pattern (stored in .brain/patterns/)

```json
{
  "id": "pat-001",
  "first_detected": "2026-04-30",
  "name": "Auth decisions keep being revisited",
  "entities_affected": ["project-alpha", "project-beta"],
  "evidence": [
    "Auth approach changed 3 times in project-alpha",
    "Same discussion happening in project-beta"
  ],
  "interpretation": "No clear auth standard across projects — each one reinvents the wheel",
  "risk": "Wasted time and inconsistent security posture",
  "recommendation": "Make one auth decision for all projects and share the implementation",
  "status": "active"
}
```

## Init Flow

When a user runs `npx brain-os init`:

1. Create `.brain/` directory in current folder (or specified path)
2. Create subdirectories: `entities/`, `decisions/`, `patterns/`, `sessions/`
3. Create `config.json` with defaults
4. Prompt: "What's the first entity you want to track?" → create first entity file
5. Print MCP config snippet for Claude Code / Cursor
6. Done in under 60 seconds

### MCP Config Output (for Claude Code)

```json
{
  "mcpServers": {
    "brain-os": {
      "command": "npx",
      "args": ["-y", "brain-os", "serve"],
      "env": {
        "BRAIN_DIR": "/path/to/.brain"
      }
    }
  }
}
```

## Demo Script (3 minutes)

### Setup (30 seconds)
- Show empty project directory
- Run `npx brain-os init`
- Show created `.brain/` structure
- Add MCP config to Claude Code

### Read (30 seconds)
- Start Claude Code session
- AI calls `entity_read` → sees 3 example entities
- One is stale (not updated in 25 days), one is blocked, one has high momentum

### Focus (30 seconds)
- AI calls `focus_get`
- Returns: "Work on Entity B — it has momentum and unblocks Entity C. Do not reorganize Entity A today."
- Show the AI explaining why with evidence

### Decide (30 seconds)
- Make a decision about Entity B
- AI calls `decision_log` → persists it
- Show the decision in the file

### Pattern (30 seconds)
- AI calls `pattern_detect`
- Finds: "Entity A and Entity B share the same blocker — this should be resolved once, not twice"

### Commit + Return (30 seconds)
- AI calls `memory_commit` → session closes clean
- **Start a new session** — AI calls `entity_read`
- Everything is there. Decisions preserved. Patterns remembered. No context lost.
- Viewer feels: "Oh. This makes AI useful across time."

## Success Criteria — 10-User Beta

### Installation
- [ ] Install time < 5 minutes
- [ ] Works on macOS and Linux
- [ ] Works with Claude Code and Cursor
- [ ] Zero configuration beyond `init`

### Usage (tracked over 14 days)
- [ ] At least 5 of 10 users create 2+ entities
- [ ] At least 3 of 10 use it more than 5 times
- [ ] At least 3 of 10 say it changed what they worked on
- [ ] At least 2 of 10 say they'd pay for it
- [ ] At least 1 user asks to use it for their team

### Reliability
- [ ] Zero data loss incidents
- [ ] Entity state persists correctly across sessions
- [ ] Decisions are never lost
- [ ] No crashes or silent failures

### Signal quality
- [ ] `focus_get` produces useful recommendations (user agrees >60% of the time)
- [ ] `pattern_detect` finds at least 1 non-obvious pattern per user
- [ ] `memory_commit` leaves clean state that next session can pick up

### Disqualifying signals
- Users create entities but never read them back → schema is wrong
- Users ignore focus recommendations → prioritization logic is wrong
- Users don't call memory_commit → session close is too much friction
- Users stop after day 3 → onboarding or value prop is weak

## Build Sequence

### Phase 1: Core (week 1)
1. Set up TypeScript project with MCP SDK
2. Implement file store (read/write .brain/ directory)
3. Implement `entity_read` and `entity_update`
4. Implement `decision_log`
5. Implement `memory_commit`
6. Test with Claude Code locally

### Phase 2: Intelligence (week 2)
1. Implement staleness calculation
2. Implement `focus_get` with priority scoring
3. Implement `pattern_detect` with basic pattern rules
4. Build `init` command + CLI
5. Create example data for both use cases
6. End-to-end test: init → use → commit → return

### Phase 3: Polish + Beta (week 3)
1. Record demo video
2. Write README with clear install instructions
3. Publish to npm
4. Find 10 beta users
5. Set up feedback channel
6. Track usage metrics

## Not Building (MVP scope guard)

- Dashboard or web UI
- Team/multi-user support
- Slack/GitHub/Linear integrations
- TRIBE agent routing
- Advanced personas
- Authentication or accounts
- Cloud sync
- Analytics beyond local patterns
- Mobile app

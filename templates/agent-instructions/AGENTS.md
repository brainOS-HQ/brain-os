# AGENTS.md

Agent operating instructions for projects using Brain OS.

This file is the **canonical** source of truth for how AI agents (Claude Code, GitHub Copilot, Cursor, Zed, Windsurf, Codex, any MCP-compatible client) should behave when working in this project. Tool-specific files (`CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/brain-os.mdc`, `.zed/rules.md`, `.windsurfrules`) are thin pointers to this document.

---

## Context

This project uses **Brain OS** — an MCP server for persistent operational state. State lives in `.brain/`. Brain OS tools are exposed prefixed `mcp__brain-os__*` when connected as an MCP client.

When asked about project state, priorities, decisions, plans, blockers, or focus, you are answering questions about **live operational state**, not source code. Use the MCP tools. Do not grep the codebase for the answer.

---

## The hard rule

For ANY question about project state, priorities, decisions, patterns, focus, or what to work on, use the Brain OS MCP tools as the **primary** data source. Do not infer state from source files or recent commits — those reflect what was written, not what is true now.

If you read source code as your first action on a state question, you are in generic-coding-assistant mode. Stop and re-route through the MCP tools below.

---

## Natural-language behavior

Users should not need to know commands or tool names to use Brain OS. When the user says something that implies a state change or query, translate it to the right tool call automatically.

| User says (examples) | You call |
|---|---|
| "I'm blocked on API keys" | `entity_update` with `blocked` |
| "I decided not to build the mobile app" | `decision_check` then `decision_log` |
| "What should I work on?" | `focus_get` |
| "Remember that Stripe is on hold" | `entity_update` with `mode: parked` |
| "What did I say I was doing next for X?" | `entity_read(entity_id)` |
| "How are my projects doing?" | `entity_read()` (all) |

After a silent tool call, confirm in plain language what was saved:

- "Noted — Stripe is flagged as blocked on API keys."
- "Got it — logged the decision to skip mobile for now."
- "Saved — landing page is parked, reason: waiting on copy."

Do not name tools, fields, schemas, or IDs in user-facing output. The user sees plain sentences; the structure is internal.

---

## Session start

At the start of a conversation, silently call `entity_read()` to load current state. Do not dump a full overview unless the user asks for one. Instead:

- If something is stale or blocked, mention it briefly: "Heads up — the payments project hasn't been touched in 3 weeks."
- If a decision has an upcoming review date, surface it: "You said you'd revisit the pricing model this week."
- If nothing is urgent, say nothing. Start with the user's request.

### First run (no entities exist)

If `entity_read()` returns no entities, this is a new user. Do not show tool lists, schemas, or setup instructions. Start a short conversation instead.

1. **Ask what they're working on.** One question: "No projects tracked yet — what are you working on right now?" Let them answer naturally. They might mention one project or several.

2. **Extract from their answer:**
   - A short project name (slug it yourself, e.g. "my saas app" → `my-saas-app`)
   - Current status — are they building, launching, stuck, exploring?
   - A blocker, if they mention one
   - What they plan to do next
   - Any decision or commitment they state ("I decided to use Stripe", "we're not doing mobile")

3. **Confirm before saving.** Summarize back in 2-3 sentences: "Got it — you're building [name], currently [status]. Next up: [next move]. [Blocker if any]." Ask: "Sound right?"

4. **Create the entity.** Call `entity_update` with the extracted fields. If they mentioned multiple projects, create one entity each — but keep it to what they actually said, do not invent fields.

5. **Log any decision.** If they stated a commitment or choice, call `decision_check` first, then `decision_log`. Confirm: "Noted — I'll remember that you decided [decision]."

6. **Show what matters now.** Call `focus_get` and show the result. This proves the loop: they talked, the system listened, and now it can tell them what to focus on.

7. **Close with:** "You're set up. Next time I'll remember where you left off."

Keep the whole exchange to 2-3 messages. Do not over-ask. If they give a short answer, work with what you have — a single entity with a name and next move is enough to start.

---

## Tool routing (in order)

| # | Tool | When to call |
|---|------|--------------|
| 1 | `mcp__brain-os__entity_read(entity_id?)` | First call for any project-state question. Omit `entity_id` to list all entities. |
| 2 | `mcp__brain-os__plan_read(entity_id)` | Get active step + progress for an entity. |
| 3 | `mcp__brain-os__focus_get(entity_id?, constraints?)` | Prioritized recommendations. Pass `entity_id` to scope to one project; omit for global. Use for "what should I work on." |
| 4 | `mcp__brain-os__semantic_recall(query, source_kind?)` | Fuzzy search across decisions, patterns, sessions when you don't know the entity ID. |
| 5 | `mcp__brain-os__decision_check(proposed_action, entity_id?)` | Call **before** any action that might contradict an active decision. Returns clear / caution / conflict. |
| 6 | `mcp__brain-os__pattern_detect()` | Surface current behavioral patterns. |
| 7 | `mcp__brain-os__entity_update`, `plan_set/add/advance`, `decision_log`, `decision_refresh`, `memory_commit` | Mutating tools. Use when writing state back. |

Do not name tools in user-facing text. Use plain language: "Checking your projects..." not "Calling `entity_read`...".

---

## Mutation safety

Before any mutating call (`decision_log`, `entity_update`, `plan_set/add/advance`, `decision_refresh`), call `decision_check` with a short description of the proposed action. If status is `conflict`, do NOT proceed without explicit user confirmation. If `caution`, surface the relevant active decision and ask.

---

## Output formatting

### `focus_get` results

Format as a fixed-column table, not a paraphrase:

```
ENTITY               SCORE   MOMENTUM   NEXT
project-alpha        75      high       Recruit 5 for usability test
project-beta         55      medium     Add API key to staging
```

Plus a one-line **Do not do** summary and **Staleness alerts** as bullets. No long-form rephrasing of the JSON.

### `entity_read` for a single entity

Use the fixed format:

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

Confirm writes in plain language (see Natural-language behavior above). When the user explicitly asks for detail, return key fields (`id`, `date`, summary) in one short paragraph.

---

## Terseness

- Do NOT create todo lists for state-reading questions. Just call the tool and return the answer.
- Do NOT narrate every step ("I'll first do X, then Y, then Z") — call tools and report results.
- Do NOT offer five follow-up options at the end of every response. One suggested next move is enough.
- Default to short. The user reads diffs, tool calls, and JSON directly — no need to re-explain them.

---

## Escape this protocol when

The task is genuinely outside Brain OS scope:

- Writing or editing source code for the project
- Running shell commands, builds, tests
- Reading source files to understand implementation (vs. to answer a state question)
- General web search or fetching docs

If the user asks "what should I work on" / "what's the state of X" / "is this decision still good", **stay in MCP tools.**

---

## Command vocabulary

Slash commands (`/brain`, `/focus`, etc.) are a Claude-Code-specific feature and do not exist in Copilot, JetBrains, etc. To give the same UX in any client, treat these **bare keywords** as command shortcuts when the user types them in chat. Match the leading word case-insensitively.

| Keyword | Run | Output |
|---|---|---|
| `brain` (no arg) | `entity_read()` + `pattern_detect()` + `focus_get(max_results=3)` | Master overview table |
| `brain <entity-id>` | `entity_read(entity_id)` + `plan_read(entity_id)` + `decision_check("scan", entity_id)` | Single-entity card |
| `focus` | `focus_get(max_results=3)` | Global priorities table + do-not-do + staleness alerts. |
| `focus <entity>` | `focus_get(entity_id=<entity>)` | Scoped priorities for that entity + related entities. |
| `focus <constraints>` | `focus_get(constraints)` | Same, scoped by constraints (e.g. "only 2 hours", "low energy") |
| `decide` or `decide <topic>` | Guide user through `decision_log` with `decision_check` first | Logged decision summary (id, date, decision, why) |
| `wrap` | `entity_read()` to find dirty entities + propose `entity_update` calls | Wrap summary, ask before mutating |
| `retro` | `entity_read()` + `pattern_detect(scope="recent")` + `semantic_recall("last 7 days")` | Weekly retro narrative grouped by entity |
| `patterns` | `pattern_detect()` | Active patterns + new patterns + risk lines |
| `graph` or `graph <entity>` | `entity_read()` to walk `related_entities` | ASCII relationship graph |
| `strategy <question>` | `semantic_recall(question)` + `decision_check(question)` | Decision-framework analysis |

If the user types `/brain` or `/focus` etc. in a client that doesn't support custom slash commands, treat the leading `/` as a hint and run the matching command anyway.

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

If your first action on a state question is reading files under `.brain/` directly (entity JSON, decisions log, pulse markdown), **stop**. Route through the MCP tools above. Direct file reads bypass the audit log and miss derived fields that the tools compute.

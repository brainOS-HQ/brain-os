# Twitter / X drafts — Brain OS launch wave

**Date drafted:** 2026-05-19
**Voice rules honored:** no em dashes, no heavy promises, no moralizing, gap-claim posture (1-2 shipped, 3-4 imminent, 5-6 roadmap)
**Per dec-005:** Claude drafts, Tasha reviews + ships from `@tashaamanda`. No auto-posting.

Each post is ≤280 chars. Image / gif placeholders are suggestions, not required.

---

## Launch thread (10 posts)

### 1. Hook
```
Your AI remembers conversations.
It still forgets project state.

Brain OS gives agents operational state: decisions, plans, blockers, and priorities across sessions.

Open-source MCP server. Local-first. No cloud.

→ npx brain-os init
```

### 2. The gap
```
Two memory categories collapsed into one word:

1. Transcript capture — your chat history, embeddings, recall
2. Operational state — entity status, decisions, blockers, plans

Most "AI memory" products do #1. Brain OS does #2. Different jobs, both legitimate.
```

### 3. What Brain OS is
```
Brain OS is an MCP server.

It writes a .brain/ directory in your repo:
  entities/    project state
  decisions/   what you chose and why
  patterns/    behaviors detected
  audit.jsonl  append-only history

You can grep it. A teammate can read it. No vector DB required.
```

### 4. Cross-tool moat
```
Same .brain/ directory.
Three engines: Claude Code, Cursor, Zed.

Each one autonomously called entity_read, semantic_recall, decision_check across tool boundaries.

The big AI vendors won't build this — lock-in incentives.

[gif: three editors lighting up the same .brain/]
```

### 5. Build log
```
v0.4.0 just shipped:

→ decision_refresh tool (bump review_date, append evidence, change status without losing audit history)
→ Skill routing protocol (Brain OS slash commands now lead with MCP tools, not file search)
→ Auto-synced pulse files (entities/.json → human-readable markdown)
```

### 6. Social proof
```
r/MCP launch landed:
  #3 of the day
  3.2k views in 24h
  ~230 weekly npm installs
  5 substantive comments, including Kenny @ Tesseron endorsing the "operational state, not transcripts" framing

Distribution still early. Product is the work.
```

### 7. Concrete tool — decision_check
```
The killer feature is decision_check.

Before any action, the agent calls it:
  decision_check({ proposal: "switch to Postgres" })
  → conflict (dec-002 chose SQLite, with reasoning)

Agents stop agreeing with contradictions you didn't notice.
```

### 8. The principle
```
The schema is the product.

If a teammate can't read your AI's memory, your AI doesn't have memory. It has a vector index.

Brain OS state is plain JSON + markdown. Commit it to git. Diff it. Review it.

Black-box memory is a step backward.
```

### 9. Install
```
One command:

  npx brain-os init

Installs the .brain/ directory, 8 slash commands, the routing protocol, and a subagent definition. Skip commands with --no-commands if you only want the MCP server.

MIT license. Source: github.com/brainOS-HQ/brain-os
```

### 10. Repo + community
```
Brain OS is open and free.

Repo: github.com/brainOS-HQ/brain-os
Site: brainos-hq.com
npm: npmjs.com/package/brain-os
Discord: [discord link]

If you try it on a real project this week, I want to hear what broke.
```

---

## Standalone posts (5, variety pack)

### A. Build-in-public moment (the meta-bug from today)
```
Real conversation today:

I asked Brain OS what was next.
It read a stale pulse file from 4 days ago.
I almost planned work that had already shipped.

The fix isn't "use Brain OS more carefully." The fix is: the skill itself needs to route through Brain OS first.

Shipping the fix in v0.4.0.
```

### B. Technical — decision_check semantic layer
```
decision_check used to be string overlap.

v0.3.0 added a semantic-similarity layer over the same call:
  → catches paraphrased conflicts the text heuristics miss
  → cheap when embeddings are local (BRAIN_EMBEDDINGS=local)
  → opt-in entirely (don't want it, don't enable it)
```

### C. Positioning
```
There are two memory categories in AI tooling, and they keep getting confused:

  TRANSCRIPT MEMORY      claude-mem, Hindsight, Mem0, AMP
  OPERATIONAL STATE      Brain OS

Both legitimate. Different jobs. Pick the one that matches the problem.

I'm not trying to win the embeddings race.
```

### D. Process
```
I dogfood Brain OS while building Brain OS.

Every entity_update on the brain-os entity is the product being its own user. When it drifts, I feel it before anyone else does. When it works, I trust it more than I would otherwise.

Recursion catches drift early.
```

### E. Vision (one-sentence)
```
What if every AI tool you use read from the same brain?

Same decisions, same context, same priorities. Claude Code on Monday. Cursor on Tuesday. Zed on Wednesday. Pick up where the last one left off.

That's the bet.
```

---

## Posting notes

- **Order:** thread first, then standalones spaced across 5 to 7 days. Don't dump all in one day.
- **Best slot per memory:** Tasha hasn't established a Twitter posting cadence yet (step-004 of `brainos-marketing` is literally to kick this off). Start small. One thread, watch what lands.
- **Visual asset gaps:** posts 4, 5, 10 reference a gif or screenshot. None exist yet. Either ship without them or queue them as part of the cross-tool demo video (`brainos-marketing` step-005).
- **YC timing:** YC S26 decision due 2026-06-05 (17 days out). Visible build-in-public during the YC window is a positive signal; don't pause posting just because YC is pending.
- **Link in bio:** brainos-hq.com, with the install command above the fold.
- **Reply discipline:** answer technical questions in-thread when possible. Save the "DM me" reflex for actual deal flow.

---

## What I did NOT draft (deliberate)

- LinkedIn version — different audience, different voice. Worth a separate pass.
- HN launch post — that's `brainos-marketing` step-006, gated on the demo video. Don't pre-write yet.
- Reply templates / canned responses — better to write those reactively based on what real comments look like.

# Brain OS — Product Roadmap

Position: **Operational state layer for AI work** (not chat memory, not embeddings DB)

Strategy: Don't build "more memory." Build trust, enforcement, and continuity.

## Why Brain OS is different

These define the lane. Any one gap alone is copyable, but each is a natural extension of the existing foundation — so a competitor would have to rebuild architecture to follow.

- [x] **1. Cross-tool coherence** — MCP-native + local `.brain/` means any MCP client (Claude Code, Cursor, Zed, Windsurf, VS Code) reads the same source of truth. **Shipped.** The big AI vendors won't build it (lock-in incentives), Supermemory's fact-extraction model can't share structured decisions, GSD is locked to Claude Code by design.
- [x] **2. Anti-sycophancy / agent pushback** — `decision_check` returns conflict/caution/clear with the original reasoning surfaced. Stops agents from agreeing with contradictions you didn't notice. **Shipped.** The inverse of every other AI tool, which tries to be more agreeable.
- [ ] **3. Decision aging** — Decisions have timestamps; need `revisit_after` field + stale-decision surfacing. **Partial** — see Priority 2: Revisit triggers. Compounds with use: the longer you run Brain OS, the more valuable this becomes.
- [ ] **4. Drift detection** — Entity has `vision`, `do_not_build`, `out_of_scope`; need `drift_check` tool that compares current `next_move` against original vision. **Partial** — primitives exist, comparison tool pending.
- [ ] **5. Decision provenance for code** — Link decisions to commit hashes / file paths so "why is this function structured this way?" surfaces the original decision with reasoning + rejected alternatives. **Roadmap.**
- [ ] **6. Federated patterns** — Opt-in community decision support: "other Brain OS users facing this decision typically chose X for these reasons." Local-first architecture makes federation safe and adjacent, not contradictory. **Phase 2** (~12-18mo, see below).

## Priority 1 — Foundation (build now)

- [x] Entity schema with status/momentum/blockers/next_move
- [x] Decision log with alternatives, reasons, review dates, supersession
- [x] Focus scoring (urgency/momentum/leverage/staleness)
- [x] Memory check (signal classification)
- [x] Pattern detection
- [x] Semantic recall (local + OpenAI embeddings)
- [x] Auto-loaded status resource
- [x] **Audit log** — append-only write history (who changed what, when, from which session)
- [x] **Plan primitive** — ordered work steps on entities, auto-promotes next_move, enforces evidence/reason
- [ ] **Entity version history** — save previous state before each update, enable rollback

## Priority 2 — Decision Continuity (the killer feature)

- [x] **`decision_check` tool** — agent calls before acting, returns "clear" / "caution" / "conflict"
- [x] **Decision Lock enforcement** — conflicts block agent from proceeding without user confirmation
- [x] **`decision_refresh` tool** — bump `review_date`, append evidence, change status. Metadata-only mutation; preserves audit-log fidelity (no more direct JSON edits)
- [ ] **Revisit triggers** — auto-flag decisions when their review_date passes or new evidence appears

## Priority 3 — Schema Expansion

- [ ] **Blocker as first-class object** — resolution tracking, who unblocked, when
- [ ] **Owner field** on entities — who is responsible
- [ ] **Assumption primitive** — things believed true that haven't been verified
- [ ] **Risk primitive** — identified risks with likelihood/impact/mitigation
- [ ] **Dependency tracking** — entity A blocks entity B (not just `related_entities`)

## Priority 4 — Memory Safety

- [ ] **Write validation** — reject suspicious instruction-like content being stored as memory
- [ ] **Confidence scoring** — each memory write gets a confidence level
- [ ] **Memory diff** — show what changed since last session in human-readable form
- [ ] **Rollback** — revert entity/decision to a previous version from audit log
- [ ] **Secret detection** — refuse to store API keys, tokens, passwords

## Priority 5 — Governance (team-ready)

- [ ] **Permission boundaries** — which agents can read/write which entities
- [ ] **Memory review mode** — proposed writes that need human confirmation
- [ ] **Export/delete** — full data portability
- [ ] **Encrypted local storage** — at-rest encryption for `.brain/`

## Phase 2 — Optional Cloud Sync (~12–18mo, after ~1k+ active local installs)

Cloud is opt-in, end-to-end encrypted, and only built once users explicitly ask for it. Local-first is the default today and remains the priority.

- [ ] **Multi-device sync** — same `.brain/` state across laptop, desktop, mobile agents
- [ ] **Encrypted sync protocol** — E2E encryption, server cannot read entity content
- [ ] **Selective sync** — choose which projects sync, which stay local only
- [ ] **Conflict resolution** — last-write-wins with audit-log-backed merge view
- [ ] **Backup/recovery** — restore `.brain/` from any point in audit history

Trigger: build only when ~1k+ local installs are asking for sync. Until then, do not build.

## Phase 3 — Enforcement at Team Scale (the moat)

Once cloud sync exists, enforcement becomes the enterprise wedge — auditable decision logs across multiple humans + agents working on shared state.

- [ ] **Multi-actor decision log** — track which human/agent made each decision
- [ ] **Cross-agent decision_check** — conflicts surface across the team, not just one user
- [ ] **Compliance-grade audit export** — SOC2/GDPR-ready logs
- [ ] **Org-level policy enforcement** — "no decisions without owner field" etc.

## Not building yet

- Dashboard UI (read-only `brain://status` resource is enough)
- Slack/GitHub/Linear integrations
- Generic chatbot memory
- Agent personality system
- Knowledge graph visualization
- Public SaaS UI / web dashboard

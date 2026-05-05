# Brain OS — Product Roadmap

Position: **Operational state layer for AI work** (not chat memory, not embeddings DB)

Strategy: Don't build "more memory." Build trust, enforcement, and continuity.

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

## Not building yet

- Dashboard UI
- Cloud/SaaS version
- Slack/GitHub/Linear integrations
- Generic chatbot memory
- Agent personality system
- Knowledge graph visualization

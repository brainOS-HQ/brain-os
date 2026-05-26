# Brain OS — Roadmap

Brain OS is the **operational truth layer for agentic work**: persistent project state, decisions, plans, focus, and auditability for AI agents working across time and tools.

This roadmap is the public build plan. The longer product thesis lives in `STRATEGY.md`.

## Shipped

- [x] **Local-first `.brain/` state** — entity, decision, pattern, session, audit, and embedding stores live in the project.
- [x] **MCP server** — works with MCP-compatible clients such as Claude Code, Cursor, and Zed.
- [x] **Entity state** — track projects/initiatives with status, momentum, blockers, next moves, related entities, and open questions.
- [x] **Decision log** — record what was decided, why, rejected alternatives, proof action, review date, and supersession.
- [x] **Decision check** — returns clear/caution/conflict before an agent acts against prior decisions.
- [x] **Focus engine** — ranks what to work on by urgency, momentum, leverage, and staleness.
- [x] **Plan primitive** — ordered work steps with evidence/reason requirements and next-step promotion.
- [x] **Pattern detection** — surfaces recurring blockers, stale work, avoidance signals, and theme convergence.
- [x] **Semantic recall** — local/OpenAI embedding search over entities, decisions, patterns, and sessions.
- [x] **Audit log** — append-only record of state mutations.
- [x] **Smoke tests + CI** — regression coverage for core tools and safety helpers.

## Now — Launch Readiness

Goal: a new user can install Brain OS, create useful state, and see one agent respect that state in another client within 10 minutes.

- [ ] **One-command install path** — Smithery/Cursor/Zed-friendly setup so users do not hand-edit config unless needed.
- [ ] **Workspace discovery** — MCP server reliably finds the correct `.brain/` from each client without hardcoded `BRAIN_DIR`.
- [ ] **Guided init flow** — first run captures one project, one active commitment, one blocker, and one next move.
- [ ] **First-win demo flow** — capture decision → ask in another client → agent respects prior state.
- [ ] **Default workflow** — capture → decide → next step → daily/weekly recap, with user-facing names instead of tool jargon.
- [ ] **Starter templates** — solo builder, coding project, launch/marketing project, team workspace.

## Next — Decision Continuity

Goal: agents reliably use prior decisions without noisy false stops.

- [ ] **Revisit triggers** — flag decisions when review dates pass or new evidence appears.
- [ ] **Decision provenance for code** — link decisions to commits/files so agents can explain why code is structured a certain way.
- [ ] **Drift check** — compare proposed next moves against entity vision, scope, and explicit do-not-build constraints.
- [ ] **Stale-state warnings** — require refresh/confirmation before acting on old state.

Gate: `decision_check` catches real contradictions, stale decisions surface at the right time, and code-level decisions can be traced back to their reasoning.

## Next — State Model Expansion

Goal: cover the common things that change action without becoming a generic notes database.

- [ ] **Entity version history** — save previous state before updates and enable rollback when audit/review UX needs it.
- [ ] **Blocker objects** — resolution tracking, who unblocked, and when.
- [ ] **Owner field** — who is responsible for an entity or plan.
- [ ] **Assumption primitive** — things believed true but not yet verified.
- [ ] **Risk primitive** — likelihood, impact, mitigation, and review date.
- [ ] **Dependency tracking** — entity A blocks entity B, beyond loose related entities.

## Next — Memory Safety and Governance

Goal: agents can distinguish allowed actions, approval-required actions, stale-state actions, and forbidden actions before mutating state or causing external side effects.

- [ ] **Write validation** — reject suspicious instruction-like content stored as memory.
- [ ] **Secret detection** — refuse to store API keys, tokens, passwords, or sensitive credentials.
- [ ] **Memory diff** — show what changed since the last session.
- [ ] **Rollback** — revert entity/decision state from audit history.
- [ ] **Policy rules** — project/team constraints such as "do not change pricing without approval" or "do not work on parked projects."
- [ ] **Approval gates** — proposed actions that require human confirmation.
- [ ] **Permission boundaries** — which agents can read/write which entities.
- [ ] **Export/delete** — full data portability.
- [ ] **Encrypted local storage** — at-rest encryption for `.brain/`.

## Later — Optional Sync and Visibility

Cloud stays optional. Local-first remains the default.

Trigger: build only when enough active local users explicitly ask for sync.

- [ ] **Multi-device sync** — same `.brain/` state across laptop, desktop, and mobile agents.
- [ ] **Encrypted sync protocol** — end-to-end encryption; server cannot read entity content.
- [ ] **Selective sync** — choose which projects sync and which stay local only.
- [ ] **Conflict resolution** — last-write-wins with audit-log-backed merge view.
- [ ] **Backup/recovery** — restore `.brain/` from audit history.
- [ ] **Control-room surface** — inspect, correct, approve, and review agent state without editing JSON.

## Later — Multi-Agent Coordination

Goal: multiple agents can work from the same truth without stepping on each other.

- [ ] **Agent sessions** — track active/paused/completed agent work with client, entity, start time, and last seen time.
- [ ] **Territories** — agents declare owned scopes such as files, features, projects, channels, or workflows.
- [ ] **Territory check** — `territory_check(proposed_action, scope)` returns clear/caution/conflict before another agent edits the same area.
- [ ] **Locks with TTL** — short-lived coordination locks that expire or require renewal.
- [ ] **Handoffs** — transfer context, ownership, and next move from one agent to another.
- [ ] **Activity feed** — human-readable view of who/what is working on which territory.

## Later — Team Enforcement and Learning

Goal: teams can audit, govern, and improve agentic work over time.

- [ ] **Multi-actor decision log** — track which human/agent made each decision.
- [ ] **Cross-agent decision check** — conflicts surface across the team, not just one user.
- [ ] **Compliance-grade audit export** — SOC2/GDPR-ready logs.
- [ ] **Org-level policy enforcement** — required owners, approvals, review gates, or evidence fields.
- [ ] **Workflow failure patterns** — detect repeated skipped tests, stale launches, reopened decisions, or recurring stalls.
- [ ] **Agent reliability signals** — track which agents/clients tend to miss checks, touch stale state, or require correction.
- [ ] **Retro-to-policy loop** — convert repeated retros into suggested policies, gates, or checklist changes.
- [ ] **Routing hints** — learn which tasks should go to which agent/tool based on past success.

## Not Building Yet

- Generic chatbot memory
- Dashboard UI unrelated to sync, visibility, governance, or coordination
- Slack/GitHub/Linear integrations before users demand them
- Agent personality system
- Knowledge graph visualization
- Public brain-region branding
- AGI-infrastructure launch language

# Changelog

All notable changes to Brain OS are documented here. This project uses [semantic versioning](https://semver.org/).

## [0.4.0] — 2026-05-19

### Added — `decision_refresh` MCP tool (closes #3)

- New tool: `mcp__brain-os__decision_refresh({ decision_id, review_date?, add_evidence?, status? })`. Metadata-only mutation on existing decisions. Bumps `review_date` forward, appends evidence with a date stamp, or changes status (`active` / `superseded` / `archived`). Preserves audit-log fidelity — no more direct JSON edits to refresh a decision.
- New `evidence_appended` array on the Decision schema: each call to `decision_refresh` with `add_evidence` appends a `{date, note}` entry. Original decision content (`decision`, `why`, `alternatives`, `chosen_direction`, `proof_action`) stays append-only.

### Added — Brain OS Protocol (skill routing fix)

- New file `BRAIN_OS_PROTOCOL.md` shipped via `brain-os init` to both `.claude/brain-os/PROTOCOL.md` (project) and `~/.claude/brain-os/PROTOCOL.md` (user). Single source of truth for how Brain OS slash commands route tool calls. Skills now lead with MCP tools (`entity_read`, `plan_read`, `focus_get`, `semantic_recall`, `decision_check`); pulse files become fallback only.
- All 8 slash command templates (`brain`, `focus`, `decide`, `patterns`, `retro`, `graph`, `strategy`, `wrap`) rewritten as thin wrappers that load the protocol first, then add skill-specific intent.
- New `brain-os-mode` subagent definition at `.claude/agents/brain-os-mode.md`. When the main agent delegates Brain OS work via the Task tool, the subagent picks up under the same protocol — no risk of subagents falling back to generic file search.
- Optional `brain-os-routing-guard.py` PreToolUse hook (opt-in). Warns when pulse files are read while a `.brain/` workspace exists. Install instructions printed by `brain-os init`.

### Added — Pulse auto-sync

- `entity_update` now writes a human-readable pulse file to `.brain/pulses/<entity_id>-pulse.md` on every mutation. Pulse files are auto-generated mirrors of `.brain/entities/<id>.json` — they cannot drift. Useful for portable cross-machine reading, grep, or copying state into chat.

### Why this matters

Skill text alone is too soft — models ignore prompts under load. The protocol-plus-subagent-plus-hook layering gives Brain OS slash commands real teeth: an agent that runs `/brain` inside a `.brain/` workspace is now structurally pushed toward `entity_read` and away from stale pulse-file searches. This closes a credibility gap where Brain OS could look like generic file search to a user who didn't notice the difference.

## [0.3.1] — 2026-05-18

- Fix broken hero image on npm.
- Minor README cleanups.

## [0.3.0] — 2026-05-18

- Embeddings now opt-in. Set `BRAIN_EMBEDDINGS=local` or `BRAIN_EMBEDDINGS=openai` to enable `semantic_recall`. No silent downloads.
- Workspace-aware `.brain/` discovery: 4-tier path resolution (BRAIN_DIR env, MCP `listRoots()`, walk-up from CWD, fallback to `cwd/.brain`). Cross-tool support (Claude Code, Cursor, Zed) without per-client hardcoded paths.
- Semantic-similarity layer added to `decision_check` for paraphrased conflict detection.

## [0.2.1] — 2026-05-07

- README updated to reflect the slash-commands feature shipped in 0.2.0.

## [0.2.0] — 2026-05-07

- `brain-os init` now installs 8 slash commands into `.claude/commands/`. Auto-detects existing commands with the same names and installs uniformly under the `/brain:` namespace when conflicts exist.
- `--no-commands` flag opts out of slash command installation.

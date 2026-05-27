# Changelog

All notable changes to Brain OS are documented here. This project uses [semantic versioning](https://semver.org/).

## [0.5.2] — 2026-05-26

> Minor release: focus auto-scoping, compact checkpoint, plain-language UX.

### Added — Focus entity scoping

- `focus_get` now accepts an optional `entity_id` parameter and exposes a `scope` field in the result.
- When `entity_id` is passed, returns scoped priorities for that entity plus its related entities. Omit for global cross-project priorities.
- Unreviewed decisions are now scoped to the focused entity set instead of leaking all entities.

### Added — Compact Checkpoint (Claude Code)

- New `PreCompact` hook template (`templates/hooks/brain-os-precompact.py`) saves an unconfirmed checkpoint to `.brain/sessions/checkpoints/` before context compaction. Best-effort only — never blocks compaction.
- Checkpoint data model: `status: "captured"`, `confirmed: false`, `source: "precompact"`. Includes last user goals, files touched, entity mentions, open questions, and last assistant summary.
- `/wrap` now checks for unconfirmed checkpoints (Step 0) and asks the user to confirm, edit, or discard before folding into the normal wrap flow. Stale checkpoints are never auto-promoted to truth.
- Automatic in Claude Code via `PreCompact` hook. Other MCP clients can use Brain OS confirmed memory directly; cross-client checkpoint MCP tools are on the roadmap.

### Changed — Plain-language UX

- Agent instructions rewritten: agents speak in everyday sentences, not tool jargon or JSON field names. MCP tools are used internally but never named in user-facing output.
- Guided first-run flow: new users get a short conversation instead of a tool list. Agent extracts project name, status, blockers, and next move from natural answers.

### Changed — Distributed templates updated

- `BRAIN_OS_PROTOCOL.md`: `focus_get` signature updated to `(entity_id?, constraints?)`.
- `templates/agent-instructions/AGENTS.md`: focus command vocabulary updated, `focus_get` signature updated.
- `templates/commands/focus.md`: scoping instructions simplified — agent passes `entity_id` explicitly, no implicit CWD inference.
- `templates/commands/wrap.md`: checkpoint reconciliation step added.

### Fixed — Precompact hook filename sanitization

- `brain-os-precompact.py` now sanitizes `session_id` before using it in checkpoint filenames.

### Fixed — Version constant drift

- `CURRENT_VERSION` in `src/index.ts` was `0.5.0` while `package.json` was `0.5.1`. Now both are `0.5.2`.

## [0.5.0] — 2026-05-24

> Minor release: MCP Prompts, autowrap, and init cleanup.

### Added — MCP Prompts: 8 commands available without `brain-os init`

- Users who connect the MCP server without running init now get `/brain:wrap`, `/brain:focus`, `/brain:decide`, `/brain:retro`, `/brain:patterns`, `/brain:strategy`, `/brain:graph`, and `/brain` as MCP prompts — no skill file installation needed.
- Duplicate-skip logic: if skill files are already installed (e.g. from a prior `brain-os init`), MCP Prompts are suppressed to avoid duplicate entries in the command picker.
- Prompt handler loads the same `templates/commands/*.md` files used by skill-file installation, so behavior is identical either way.

### Added — Autowrap on context compression

- Wrap template now includes an autowrap section: when context compression fires during a long session, the agent proactively offers to wrap before session state is lost.

### Changed — `brain-os init` installs only namespaced commands

- Init now installs `/brain:focus`, `/brain:wrap`, etc. (namespaced under `brain/`). Previously it installed both flat (`/focus`) and namespaced (`/brain:focus`) forms, creating duplicates. Flat forms are no longer distributed — they're for developer use only.

### Added — CI: GitHub Actions test workflow

- `npm test` runs on every push and PR via `.github/workflows/test.yml`.

## [0.4.3] — 2026-05-23

> Patch release: security + correctness fixes from a four-round code audit, plus the step-008 cross-client init feature that was already committed (`9d75906`). v0.5.0 reserved for step-009 (MCP Prompts) — see ROADMAP.

### Added — `brain-os init` installs AGENTS.md + 5 client pointer templates

- Closes the cross-client UX consistency gap surfaced 2026-05-20: GitHub Copilot output was a verbose paraphrase until `AGENTS.md` + `.github/copilot-instructions.md` were manually scaffolded; after scaffolding, output became a clean fixed-format table matching Claude Code's slash-command UX.
- New `templates/agent-instructions/` ships 6 generic templates: `AGENTS.md` (canonical, cross-tool), `CLAUDE.md`, `copilot-instructions.md`, `cursor-brain-os.mdc`, `zed-rules.md`, `windsurfrules`.
- Per dec-023 (2026-05-22): install-all by default. New `--minimal` flag opts out down to just `AGENTS.md` + `CLAUDE.md`. New `--no-agent-instructions` flag skips all of them.
- `installAgentInstructions()` preserves existing files (no clobber) and reports installed / preserved / skipped_minimal in the output.
- This feature was committed in `9d75906` (titled "v0.5.0: …") but never version-bumped. It ships in 0.4.3 alongside this audit's bug fixes; v0.5.0 is reserved for the step-009 MCP Prompts feature still to come.

### Fixed — `decision_check` false-STOP on aligned proposals (HIGH)

- The directional semantic layer now compares rejected-facet vs chosen-facet similarity before promoting to `conflict`. A proposal 0.95-similar to chosen and 0.66-similar to rejected used to hard-STOP; now it correctly drops as alignment. Cleared an entire class of false STOPs that the v0.4.1 facet split introduced.

### Fixed — `decision_check` embedding-error fail-open (HIGH)

- Distinguished `EmbeddingsNotConfiguredError` (soft, no-op) from real provider crashes. A transient OpenAI 500 or local-model failure no longer reads as "embeddings unset" — it surfaces in the response as `embeddings_error` and appears in the guidance string so the caller knows conflicts may be under-reported.

### Fixed — embeddings store non-atomic write (HIGH)

- `saveEmbeddings` now writes to a per-process tmp file and renames into place. Prevents corruption from concurrent writers (multiple MCP clients sharing a `.brain/`) or mid-write crashes leaving partial JSON.

### Fixed — `focus_get` timezone bug (HIGH)

- Overdue-decision and unreviewed-decision checks now compare `YYYY-MM-DD` strings against the local date, not `new Date("YYYY-MM-DD")` which parses as UTC midnight. In non-UTC timezones the old code flagged decisions as overdue hours before (or after) the local review day arrived.

### Fixed — `focus_get` hardcoded English guidance lines (HIGH)

- The built-in `do_not_do` lines ("Do not reorganize files…", "Do not start new ideas…") are now opt-out via a new `suppress_default_guidance` tool parameter or the `BRAIN_FOCUS_OMIT_DEFAULT_GUIDANCE=1` env var. Default behavior unchanged for existing callers; embedded consumers can suppress.

### Fixed — `decision_check` substring false-positives (MEDIUM)

- Keyword and negation-pair matching no longer uses raw `.includes()`. Replaced with word-boundary regex via a new `containsWord()` helper, so `"add"` no longer matches inside `"address"`/`"padding"`, `"use"` inside `"reuse"`/`"because"`, `"api"` inside `"capability"`, etc. Fix applied across all 17 opposite pairs in `extractNegationConflicts`, the rejected-alternative word overlap (Layer 1), and the topic-overlap `why` field check (Layer 3).

### Fixed — embeddings silent provider switch (MEDIUM)

- `semanticRecall` now warns to stderr (once per session) when the active provider can't see vectors from a different provider stored earlier — e.g. switching `BRAIN_EMBEDDINGS=local` → `openai`. Message tells the user how to re-embed. Previously, `decision_check`'s rejected-facet hits would silently return empty after a provider switch, with no signal that anything was wrong.

### Fixed — staleness negative-day rendering (MEDIUM)

- `calculateStaleness` now clamps days at 0. A future-dated entity (timezone edge case, pasted-in placeholder) no longer renders as `"Fresh (-5d ago)"`.

### Fixed — `focus_get` priority/momentum score fallthrough (MEDIUM)

- Replaced `priorityScores[entity.priority] || 0` and the equivalent for momentum with `?? 0`. Defensive — current enums don't include `0` as a valid score, but `??` is the correct operator and prevents future-bug-via-rename.

### Fixed — `pattern_detect` dead code removed (MEDIUM)

- Stripped the `relatedGroups` and `decisionsByType` maps that were built but never read or returned. The "related entities that could share work" pattern claimed in the comment was never emitted; removed the dead branch entirely.

### Changed — `audit()` accepts per-call `session_id` (MEDIUM)

- New optional `session_id` field on `audit()` options. The module-level `currentSessionId` singleton stays as the default (no behavior change for stdio), but stateless contexts (e.g. a Worker port) can now pass a session per call.

### Docs — README, ROADMAP, SECURITY drift fixes

- README "Testing" section rewritten to reflect that `npm test` is wired and `tests/smoke.mjs` covers 24 tests across 9 tools — was previously claiming "no test suite yet." Listed gaps explicitly.
- README quick-start now documents AGENTS.md + 5 client pointer files, plus `--minimal` and `--no-agent-instructions` flags.
- ROADMAP smoke-suite line updated to the correct tool count.
- SECURITY.md "npm audit" claim corrected — runs on every push/PR/cron, not gated on release tags. Supported-versions table remains 0.4.x active (v0.5.0 is reserved for step-009).
- Post-install banner in `brain-os init` now lists `decision_refresh` (was missing since v0.4.0).

### Security — path traversal hardening via `assertSafeId` (HIGH)

- All user-supplied identifiers (`entity_id`, `decision_id`, `step_id`, `supersedes[]`) that get concatenated into filesystem paths are now validated against a strict whitelist (kebab-case + alphanumeric + underscore, 1–100 chars, no leading dot, no `/` `\` `..` null-byte). Previously a caller passing `entity_id: "../../etc/passwd"` could escape `.brain/` and clobber or exfiltrate arbitrary files (subject to OS perms). Wired into `entity_update`, `entity_read`, `plan_set/advance/add/read`, `decision_log`, `decision_refresh`, `memory_commit`, `pulse-sync`.

### Fixed — `audit_log` survives malformed JSONL lines (HIGH)

- `readAuditLog` previously did `lines.map(JSON.parse)` with no guard. A single corrupted line — from a hand-edit, a crash mid-write, or interleaved concurrent `appendFile` writes that exceed `PIPE_BUF` (~4 KB) — crashed `audit_log` permanently until manual repair. Now parses per-line in a try/catch, skips broken lines, and reports the skip count in a new `malformed_lines` field on the response.

### Fixed — `writeJsonFile` is atomic for all entity/decision/plan writes (MEDIUM)

- All write paths now go through a unique-tmp + `rename` pattern (same as `embeddings.ts` got in this release). Prevents corruption from mid-write crashes and from another process reading a half-written file. **Known limit:** does not prevent the load-modify-save race across multiple MCP client processes; tracked as v0.5.1 optimistic locking.
- Tmp filenames include `pid + ms + random` so concurrent in-process writes (e.g. `Promise.all`) can't collide on the same tmp path.

### Fixed — `decision_log` id collision under concurrent calls (MEDIUM)

- Decision IDs are now `dec-${timestamp}-${random}` for new decisions. The old `dec-${length+1}` scheme assigned the same ID to two callers who read `decisions.json` near-simultaneously, dropping one of the writes. First-time use still gets `dec-001`. Existing dec-NNN IDs are not migrated.

### Security — transitive `qs` DoS resolved (MODERATE)

- `qs` 6.11.1 – 6.15.1 (`GHSA-q8mj-m7cp-5q26`): `qs.stringify` crashes with `TypeError` on null/undefined entries in comma-format arrays when `encodeValuesOnly` is set. Pulled in transitively via `@modelcontextprotocol/sdk` → `express@5.2.1` → `qs@6.15.1`. Brain OS uses stdio transport, so the HTTP request-parsing path isn't exercised at runtime — but the dep still loads with the SDK. Pinned `qs >=6.15.2` in `package.json` `overrides`. `npm audit` now reports 0 vulnerabilities.

### Added — smoke test expansion

- `tests/smoke.mjs` adds 14 regression tests for this release's fixes: word-boundary regex (substring false-positive), `decision_check` `embeddings_error` field stability, staleness negative-day clamp, `today()` host-local date contract, `focus_get` overdue (today + tomorrow), `focus_get` `suppress_default_guidance`, `assertSafeId` rejection of `..` / `/` / `.` / null-byte across `entity_id`/`decision_id`/`step_id` and acceptance of valid kebab-case, `audit_log` survives malformed JSONL, `decision_log` 20-sequential unique-id + all-persisted assertion, and `writeJsonFile` atomic-write leaves no tmp leftovers. Total now 24 tests across 9 tools; each HIGH- and MEDIUM-severity bug from this release ships with a regression test.

## [0.4.2] — 2026-05-22

### Security — transitive vulns in MCP SDK HTTP layer resolved

First `npm audit` run on brain-os surfaced 5 vulnerabilities, all transitive through `@modelcontextprotocol/sdk@1.29.0`'s HTTP transport stack (`hono`, `fast-uri`, `express-rate-limit`, `protobufjs`). Brain OS uses stdio transport, so the vulnerable code paths aren't exercised at runtime — but the dependencies still load with the SDK and still show in `npm audit` output to every user.

Fixed in this release:

- **HIGH** — `fast-uri` path traversal via percent-encoded dot segments (GHSA-q3j6-qgpj-74h6) + host confusion via percent-encoded authority delimiters (GHSA-v39h-62p7-jpjc)
- **MODERATE** — `hono` 5 CVEs (CSS injection in JSX SSR, JWT NumericDate validation, cache leakage via missing Vary header, body limit bypass on chunked requests, unvalidated JSX tag names)
- **MODERATE** — `ip-address` XSS via `Address6` HTML-emitting methods (GHSA-v2v4-37r5-5v8g), reached through `express-rate-limit`
- **MODERATE** — `protobufjs` DoS via unbounded recursive JSON descriptor expansion (GHSA-jggg-4jg4-v7c6)

Applied `npm audit fix` plus a new `overrides` field in `package.json` pinning safe minimums (`fast-uri >=3.1.2`, `hono >=4.12.18`, `express-rate-limit >=8.5.1`, `ip-address >=10.1.1`, `protobufjs >=7.5.8`). The lockfile isn't shipped to npm consumers, so `overrides` is what protects downstream installs via fresh resolution. `npm audit` now reports 0 vulnerabilities.

## [0.4.1] — 2026-05-21

### Fixed — `decision_log` over-supersession on type collision

- `decision_log` no longer auto-supersedes prior decisions just because they share `(entity_id, type)`. Two unrelated `architecture` (or any-type) decisions on the same entity now coexist.
- New optional parameter `supersedes: string[]` — pass the explicit IDs you intend to supersede. Each target must belong to the same `entity_id` or the call throws.
- Behavior change: callers that relied on auto-supersession lose it silently. The auto behavior was buggy (it would cascade through sequential same-type logs, falsely marking each previous decision as superseded by the next).

### Fixed — `decision_check` keyword false-positives

- Keyword heuristics (rejected-alternative word overlap, hardcoded negation pairs like `simple`/`complex`, `monolith`/`microservice`, `start`/`stop`) no longer force a hard `conflict` status on substring coincidence alone. They now demote to `caution` unless the directional semantic layer also confirms.
- `embedDecision` now stores chosen direction and rejected alternatives as **two separate facets** (`chosen` and `rejected`). `decision_check` queries both with different thresholds, then:
  - keyword flag + semantic match against rejected → promote to `conflict` (STOP)
  - keyword flag + semantic match against chosen (alignment) → drop the false-positive caution
  - keyword flag with no semantic confirmation → stay `caution`
  - Without `BRAIN_EMBEDDINGS` configured: keyword flags stay as cautions, never returns `conflict`. Softer default, no false STOPs.
- Existing single-embedding entries are treated as `chosen` for back-compat; new entries gain the facet field. Old decisions re-embed organically on next `decision_log` or `decision_refresh`.

### Fixed — `plan_advance` over-promotion

- `plan_advance` no longer promotes the next pending step to `active` when an active step already exists. Completing a non-active step out of order (e.g. finishing step-003 while step-002 is still active) used to leave two steps in `active` state simultaneously.

### Fixed — `decision_refresh` dangling `superseded_by`

- Transitioning a decision's status away from `superseded` (e.g. back to `active`) now clears the `superseded_by` pointer. Prior behavior left a dangling reference to the now-irrelevant successor.

### Added — smoke test suite

- `tests/smoke.mjs` covers the four fixes above as regression tests, plus cross-entity supersession rejection. Runs against an isolated `BRAIN_DIR` via `node --test`. New `npm test` script.

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

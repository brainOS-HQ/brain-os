# Security Policy

Brain OS is operational state infrastructure for AI agents. State lives locally in `.brain/`. The MCP server uses stdio transport — there is no network listener, no authentication surface, and no remote callers. It makes two kinds of outbound call, listed under [Network calls](#network-calls). The threat model is therefore narrower than a typical web service, but supply-chain and local-input concerns still apply.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.11.x  | ✅ Active |
| 0.10.x  | ⚠️ Security fixes only |
| < 0.10  | ❌ Please upgrade |

## Reporting a Vulnerability

Please **do not** open public GitHub issues for security reports.

Two private channels:

1. **GitHub Security Advisory** (preferred) — open a private advisory at https://github.com/brainOS-HQ/brain-os/security/advisories/new
2. **Email** — `security@brainos-hq.com`

Include:

- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept if applicable)
- Affected versions
- Suggested mitigation if you have one

**BrainOS Cloud.** The hosted service is a separate system and is not built from this repository. Report a vulnerability in BrainOS Cloud by email to `security@brainos-hq.com`, not through this repository's advisories.

We aim to acknowledge reports within **3 business days** and provide a fix or detailed response within **14 days** for HIGH-severity issues.

## Scope

In scope:

- The Brain OS MCP server itself (`src/`, `dist/`)
- Schemas under `schemas/`
- The `brain-os` CLI (`bin/brain-os.js`)
- Tool implementations exposed over MCP (`decision_log`, `entity_update`, `plan_*`, `pattern_*`, etc.)
- The pulse-file and audit-log writers

**Trusted folders only.** `project_evidence_scan` and `operational_state_check` (and `decision_review` when given a `root_path`) run Git inside the folder you name, and Git reads that folder's own config. The `root_path` must be a folder you trust. Known ways for a folder's Git config to run a program are blocked, and a new one is in scope to report, but the block list is not guaranteed complete.

Out of scope:

- Vulnerabilities only reachable via a malicious local agent that already has filesystem write access to the user's machine (the host is trusted)
- Issues in `@modelcontextprotocol/sdk`'s HTTP transport (Brain OS uses stdio only); report those upstream at https://github.com/modelcontextprotocol/typescript-sdk
- Third-party MCP clients (Claude Code, Cursor, Zed, Copilot, Windsurf)

## Disclosure

We follow a coordinated disclosure model:

1. Report received and acknowledged (≤3 business days)
2. Fix developed and tested
3. Patch released on npm + CHANGELOG entry + GitHub advisory published
4. Credit given to the reporter unless they request anonymity

## Recent Advisories

### 2026-08-05 — v0.9.2 dependency hardening

`@huggingface/transformers` was removed from Brain OS package metadata and local embeddings were temporarily disabled. Its latest release still pulls unresolved High-severity advisories through `onnxruntime-node`/`adm-zip` and `sharp`/libvips. Brain OS will not install or recommend that dependency until an audited upstream version or replacement is available. OpenAI embeddings remain an explicit optional peer; keyword recall and all non-semantic tools work without an embeddings provider.

### 2026-05-22 — v0.4.2

First `npm audit` pass on the published package surfaced 5 vulnerabilities, all transitive through `@modelcontextprotocol/sdk@1.29.0`'s HTTP transport stack. Brain OS uses stdio transport, so the vulnerable code paths aren't exercised at runtime — but the dependencies still load with the SDK. Repository installs were repaired in v0.4.2 via `npm audit fix` plus a `package.json` `overrides` field. Details: [`CHANGELOG.md`](./CHANGELOG.md#042--2026-05-22).

## Dependency Hygiene

- `npm audit` runs on every push, every pull request, and on a weekly cron via [`.github/workflows/audit.yml`](./.github/workflows/audit.yml); Critical and High findings fail CI before release
- Exact packed artifacts are audited in a clean consumer project. npm does not propagate a dependency package's `overrides`, so repository-only audit results are not presented as downstream protection
- The local embeddings provider remains disabled while its dependency tree contains unresolved High-severity advisories
- GitHub Dependabot is enabled for weekly transitive bump PRs

## Local State Considerations

Brain OS state lives in `.brain/` inside the user's project. It is:

- **Local-only** — Brain OS does not transmit your state to a network endpoint, with one exception that you switch on yourself (see below)
- **Audit-logged** — every mutation is recorded in `.brain/audit.jsonl`
- **Plaintext JSON** — do not store secrets, credentials, or PII in entity fields. If you need to record sensitive context, store a reference (e.g., "see 1Password item X"), not the value.

### Network calls

The server makes exactly two kinds of outbound call. Both use HTTPS.

1. **Version check, on every server start.** A request to `https://registry.npmjs.org/brain-os/latest` to compare the installed version with the latest one. It sends no Brain OS state. Like any HTTPS request, it shows the npm registry your IP address. There is currently no setting to turn it off.
2. **OpenAI embeddings, only if you enable them.** With `BRAIN_EMBEDDINGS=openai` and an `OPENAI_API_KEY` set, the text of entities, decisions, session summaries and `semantic_recall` queries is sent to OpenAI to create embeddings. This is off by default; without it, nothing from `.brain/` leaves your machine.

If you discover Brain OS leaking, transmitting, or persisting unexpected data beyond these two calls, that is in scope — please report.

# Security Policy

Brain OS is operational state infrastructure for AI agents. State lives locally in `.brain/`. The MCP server uses stdio transport — there is no network listener, no authentication surface, and no remote callers. The threat model is therefore narrower than a typical web service, but supply-chain and local-input concerns still apply.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.10.x  | ✅ Active |
| 0.9.x   | ⚠️ Security fixes only |
| < 0.9   | ❌ Please upgrade |

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

We aim to acknowledge reports within **3 business days** and provide a fix or detailed response within **14 days** for HIGH-severity issues.

## Scope

In scope:

- The Brain OS MCP server itself (`src/`, `dist/`)
- Schemas under `schemas/`
- The `brain-os` CLI (`bin/brain-os.js`)
- Tool implementations exposed over MCP (`decision_log`, `entity_update`, `plan_*`, `pattern_*`, etc.)
- The pulse-file and audit-log writers

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

### Unreleased — v0.10.0 candidate

The v0.10.0 dependency-reduction release removes embedding providers from the default installation. Exact clean consumer audits improve from 5 High, 2 Moderate, 0 Low, and 0 Critical findings in published v0.9.1 to 0 High, 2 Moderate, 0 Low, and 0 Critical findings in the candidate.

The removed High chains were inherited through `@huggingface/transformers` → `onnxruntime-node` → `adm-zip` and `@huggingface/transformers` → `sharp`. Users who deliberately enable local embeddings may install Transformers as an optional peer and should evaluate that provider's current advisories separately. OpenAI embeddings likewise require an explicit optional `openai` peer.

The release also strips the full inherited `GIT_*` namespace before `project_evidence_scan` invokes Git. This prevents ambient repository-routing and configuration variables from redirecting evidence reads to another repository.

The public-action guardian now treats caller-declared public destinations and clear natural-language branch or commit push descriptions as guarded actions. Callers no longer need to include the literal `git push` command for the confirmation requirement to fire.

Two Moderate findings remain in `@modelcontextprotocol/sdk` through its Hono HTTP adapter. Brain OS uses stdio transport and does not expose the affected HTTP static-file path. The findings remain tracked until the SDK supports the fixed Hono major or splits transport dependencies.

### 2026-05-22 — v0.4.2

First `npm audit` pass on the published package surfaced 5 vulnerabilities, all transitive through `@modelcontextprotocol/sdk@1.29.0`'s HTTP transport stack. Brain OS uses stdio transport, so the vulnerable code paths aren't exercised at runtime — but the dependencies still load with the SDK. Repository installs were repaired in v0.4.2 via `npm audit fix` plus a `package.json` `overrides` field. Details: [`CHANGELOG.md`](./CHANGELOG.md#042--2026-05-22).

## Dependency Hygiene

- `npm audit` runs on every push, every pull request, and on a weekly cron via [`.github/workflows/audit.yml`](./.github/workflows/audit.yml); Critical and High findings fail the feature-release bar
- Exact packed artifacts are audited in a clean consumer project. npm does not propagate a dependency package's `overrides`, so repository-only audit results are never presented as downstream protection
- Embedding providers remain explicit optional peers so default consumers do not inherit their native or image-processing dependency trees
- GitHub Dependabot is enabled for weekly transitive bump PRs

## Local State Considerations

Brain OS state lives in `.brain/` inside the user's project. It is:

- **Local-only** — never transmitted to a network endpoint by Brain OS itself
- **Audit-logged** — every mutation is recorded in `.brain/audit.jsonl`
- **Plaintext JSON** — do not store secrets, credentials, or PII in entity fields. If you need to record sensitive context, store a reference (e.g., "see 1Password item X"), not the value.

If you discover Brain OS leaking, transmitting, or persisting unexpected data, that is in scope — please report.

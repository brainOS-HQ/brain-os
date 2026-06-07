# Brain OS — Roadmap Container

This file documents the public roadmap structure that Brain OS users can use for their own projects.

It intentionally does **not** contain Brain OS's internal product roadmap, private release queue, strategic design notes, or competitive planning. Those belong in private Brain OS state, a private repo, or another gitignored planning file.

For shipped Brain OS changes, see `CHANGELOG.md`.

## How To Use This

Use a roadmap as a container for planning state:

- **Vision** — where the project is going.
- **Current release** — what is being built now.
- **Next release candidates** — accepted work, not started yet.
- **Backlog** — captured ideas that are not committed.
- **Hotfix lane** — urgent bugs, vulnerabilities, broken releases, or data-loss risks that can interrupt planned work.

The important rule is separation:

```text
roadmap container = safe to document publicly
actual roadmap data = private to the user/project unless intentionally published
```

## Template

Copy this structure into your own private project roadmap or Brain OS state.

### Vision

Describe the long-term direction of the project.

### Current Release

```text
Target:
Scope:
Acceptance:
Blocked by:
Release checklist:
```

### Next Release Candidates

Items that are accepted but not part of the current release.

### Backlog

Ideas, experiments, and possible future work. Nothing here is committed until promoted.

### Hotfix Lane

Work that may interrupt the current release:

- critical or high security issue
- data corruption or data loss
- broken published release
- tests failing on the main branch
- user-facing shipped behavior is broken

Everything else should go through the normal release queue.

### Shipped

Move shipped items to a changelog or release notes. The roadmap should not become history storage.

## Privacy Boundary

Do not put private strategy, exact internal build order, competitive design thinking, personal project state, or unreleased moat details in a public roadmap.

Brain OS stores operational planning in local-first state. Public files should expose the **shape of the system**, not the user's private data inside it.

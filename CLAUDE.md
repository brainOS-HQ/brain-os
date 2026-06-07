# CLAUDE.md

This repo is **Brain OS** — an MCP server for persistent operational state. State lives in `.brain/`.

## Agent instructions

See [`AGENTS.md`](./AGENTS.md). It is the canonical, cross-tool instruction file for how to behave in this repo (MCP tool routing, output formatting, mutation safety, command vocabulary). This `CLAUDE.md` exists only so Claude Code finds the same rules; do not duplicate content here.

## Build / dev

```bash
npm install
npm run build       # tsc
npm run dev         # tsc --watch
npm start           # node dist/index.js (runs the MCP server)
```

## Publish flow

1. Bump `package.json` + `src/index.ts` to the new version
2. Update `CHANGELOG.md`
3. `npm run build`
4. `npm publish`
5. Verify with `npm view brain-os version`

## Project memory

Brain OS uses itself for state. Run `/brain` (Claude Code) or type `brain` (other tools — see AGENTS.md command vocabulary) to scan, `/focus` for priorities, `/wrap` to end a session. Project state lives in `.brain/`, not in this file.

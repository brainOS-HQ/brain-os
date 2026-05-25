#!/usr/bin/env node

import { initBrain } from "../dist/utils/init.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "init") {
  const positional = args.slice(1).filter((a) => !a.startsWith("--"));
  const flags = args.slice(1).filter((a) => a.startsWith("--"));
  const targetDir = positional[0] || process.cwd();
  const withCommands = !flags.includes("--no-commands");
  const withAgentInstructions = !flags.includes("--no-agent-instructions");
  const minimal = flags.includes("--minimal");
  const result = await initBrain(targetDir, { withCommands, withAgentInstructions, minimal });
  console.log(result);
} else if (command === "serve") {
  await import("../dist/index.js");
} else {
  console.log(`
Brain OS : Operational state for AI agents

Usage:
  brain-os init [path] [flags]   Initialize .brain/ and install agent instructions + slash commands
  brain-os serve                 Start MCP server (stdio)

Options:
  --no-commands              Skip installing slash commands into .claude/commands/
  --no-agent-instructions    Skip installing AGENTS.md and per-client pointer files
  --minimal                  Install only AGENTS.md + CLAUDE.md (skip Copilot, Cursor, Zed, Windsurf pointers)

Learn more: https://brainos-hq.com
`);
}

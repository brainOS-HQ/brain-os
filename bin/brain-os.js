#!/usr/bin/env node

import { initBrain } from "../dist/utils/init.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "init") {
  const positional = args.slice(1).filter((a) => !a.startsWith("--"));
  const flags = args.slice(1).filter((a) => a.startsWith("--"));
  const targetDir = positional[0] || process.cwd();
  const withCommands = !flags.includes("--no-commands");
  const result = await initBrain(targetDir, { withCommands });
  console.log(result);
} else if (command === "serve") {
  await import("../dist/index.js");
} else {
  console.log(`
Brain OS : Operational memory for AI agents

Usage:
  brain-os init [path] [--no-commands]   Initialize .brain/ and install slash commands
  brain-os serve                         Start MCP server (stdio)

Options:
  --no-commands    Skip installing slash commands into .claude/commands/

Learn more: https://brainos-hq.com
`);
}

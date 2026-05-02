#!/usr/bin/env node

import { initBrain } from "../dist/utils/init.js";

const command = process.argv[2];

if (command === "init") {
  const targetDir = process.argv[3] || process.cwd();
  const result = await initBrain(targetDir);
  console.log(result);
} else if (command === "serve") {
  await import("../dist/index.js");
} else {
  console.log(`
Brain OS — Operational memory for AI agents

Usage:
  brain-os init [path]    Initialize .brain/ directory
  brain-os serve          Start MCP server (stdio)

Learn more: https://github.com/tashaamanda/brain-os
`);
}

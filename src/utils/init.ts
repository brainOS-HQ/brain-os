import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

export async function initBrain(targetDir: string): Promise<string> {
  const brainDir = join(targetDir, ".brain");

  if (existsSync(brainDir)) {
    return `Brain OS already initialized at ${brainDir}`;
  }

  const dirs = ["entities", "decisions", "patterns", "sessions"];
  for (const dir of dirs) {
    await mkdir(join(brainDir, dir), { recursive: true });
  }

  const config = {
    version: "0.1.0",
    created_at: new Date().toISOString().split("T")[0],
    brain_dir: brainDir,
  };
  await writeFile(join(brainDir, "config.json"), JSON.stringify(config, null, 2));

  const emptyDecisions: unknown[] = [];
  await writeFile(join(brainDir, "decisions", "decisions.json"), JSON.stringify(emptyDecisions, null, 2));

  const emptyPatterns: unknown[] = [];
  await writeFile(join(brainDir, "patterns", "patterns.json"), JSON.stringify(emptyPatterns, null, 2));

  const mcpConfig = {
    mcpServers: {
      "brain-os": {
        command: "npx",
        args: ["-y", "brain-os", "serve"],
        env: {
          BRAIN_DIR: brainDir,
        },
      },
    },
  };

  const output = [
    "",
    "Brain OS initialized.",
    "",
    `  ${brainDir}/`,
    "  ├── entities/     — entity pulse files",
    "  ├── decisions/    — decision log",
    "  ├── patterns/     — pattern log",
    "  ├── sessions/     — session records",
    "  └── config.json",
    "",
    "Add to your Claude Code or Cursor MCP config:",
    "",
    JSON.stringify(mcpConfig, null, 2),
    "",
    "Then start a session. The AI will have 6 tools:",
    "  entity_read      — read entity state",
    "  entity_update     — update entity state",
    "  decision_log      — log a strategic decision",
    "  focus_get         — what to work on now",
    "  pattern_detect    — find patterns across entities",
    "  memory_commit     — close session cleanly",
    "",
    "Create your first entity:",
    '  Add a JSON file to .brain/entities/ (see examples/)',
    "",
  ];

  return output.join("\n");
}

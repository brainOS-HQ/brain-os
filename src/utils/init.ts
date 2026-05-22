import { mkdir, writeFile, readdir, copyFile, stat, readFile } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CommandSpec {
  template: string;       // file in templates/commands/
  flatRel: string;        // path relative to .claude/commands/ in flat mode
  nsRel: string | null;   // path relative to .claude/commands/ in namespaced mode (null for top-level)
  flatName: string;       // display name in flat mode
  nsName: string | null;  // display name in namespaced mode
}

const COMMANDS: CommandSpec[] = [
  { template: "brain.md",    flatRel: "brain.md",    nsRel: null,                flatName: "/brain",    nsName: null },
  { template: "focus.md",    flatRel: "focus.md",    nsRel: "brain/focus.md",    flatName: "/focus",    nsName: "/brain:focus" },
  { template: "decide.md",   flatRel: "decide.md",   nsRel: "brain/decide.md",   flatName: "/decide",   nsName: "/brain:decide" },
  { template: "patterns.md", flatRel: "patterns.md", nsRel: "brain/patterns.md", flatName: "/patterns", nsName: "/brain:patterns" },
  { template: "retro.md",    flatRel: "retro.md",    nsRel: "brain/retro.md",    flatName: "/retro",    nsName: "/brain:retro" },
  { template: "graph.md",    flatRel: "graph.md",    nsRel: "brain/graph.md",    flatName: "/graph",    nsName: "/brain:graph" },
  { template: "strategy.md", flatRel: "strategy.md", nsRel: "brain/strategy.md", flatName: "/strategy", nsName: "/brain:strategy" },
  { template: "wrap.md",     flatRel: "wrap.md",     nsRel: "brain/wrap.md",     flatName: "/wrap",     nsName: "/brain:wrap" },
];

const TEMPLATE_MARKER = "# Brain OS";

async function isBrainOsCommand(filePath: string): Promise<boolean> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.trimStart().startsWith(TEMPLATE_MARKER);
  } catch {
    return false;
  }
}

interface InstallResult {
  installed: string[];     // command display names installed this run
  preserved: string[];     // command display names already there (from prior brain-os init)
  blocked: string[];       // command display names that couldn't install (path taken by other tool)
}

async function installCommands(targetDir: string): Promise<InstallResult> {
  const templatesRoot = join(__dirname, "..", "..", "templates", "commands");
  const destRoot = join(targetDir, ".claude", "commands");

  await mkdir(destRoot, { recursive: true });

  const result: InstallResult = { installed: [], preserved: [], blocked: [] };

  const tryInstall = async (
    srcPath: string,
    destRel: string,
    displayName: string,
  ): Promise<void> => {
    const destPath = join(destRoot, destRel);
    if (existsSync(destPath)) {
      if (await isBrainOsCommand(destPath)) {
        result.preserved.push(displayName);
      } else {
        result.blocked.push(displayName);
      }
      return;
    }
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(srcPath, destPath);
    result.installed.push(displayName);
  };

  // Install both canonical (brain:*) and bare alias forms for every command.
  // Re-running init repairs any missing form without disturbing the existing one.
  for (const cmd of COMMANDS) {
    const srcPath = join(templatesRoot, cmd.template);
    if (!existsSync(srcPath)) continue;

    if (cmd.nsRel && cmd.nsName) {
      await tryInstall(srcPath, cmd.nsRel, cmd.nsName);
    }
    await tryInstall(srcPath, cmd.flatRel, cmd.flatName);
  }

  return result;
}

interface ProtocolInstallResult {
  projectPath: string;
  userPath: string;
  projectInstalled: boolean;
  userInstalled: boolean;
  userPreserved: boolean;
}

async function installProtocol(targetDir: string): Promise<ProtocolInstallResult> {
  const templateRoot = join(__dirname, "..", "..", "templates");
  const srcPath = join(templateRoot, "BRAIN_OS_PROTOCOL.md");

  const projectDir = join(targetDir, ".claude", "brain-os");
  const projectPath = join(projectDir, "PROTOCOL.md");
  const userDir = join(homedir(), ".claude", "brain-os");
  const userPath = join(userDir, "PROTOCOL.md");

  const result: ProtocolInstallResult = {
    projectPath,
    userPath,
    projectInstalled: false,
    userInstalled: false,
    userPreserved: false,
  };

  if (!existsSync(srcPath)) return result;

  // Project install: always refresh (it's a read-only doc; new versions should land).
  await mkdir(projectDir, { recursive: true });
  await copyFile(srcPath, projectPath);
  result.projectInstalled = true;

  // User install: only if missing (don't clobber user customizations).
  if (existsSync(userPath)) {
    result.userPreserved = true;
  } else {
    await mkdir(userDir, { recursive: true });
    await copyFile(srcPath, userPath);
    result.userInstalled = true;
  }

  return result;
}

interface AgentInstallResult {
  installed: string[];
  preserved: string[];
}

async function installAgents(targetDir: string): Promise<AgentInstallResult> {
  const agentsTemplateDir = join(__dirname, "..", "..", "templates", "agents");
  const destDir = join(targetDir, ".claude", "agents");
  const result: AgentInstallResult = { installed: [], preserved: [] };

  if (!existsSync(agentsTemplateDir)) return result;

  let entries: string[];
  try {
    entries = await readdir(agentsTemplateDir);
  } catch {
    return result;
  }

  await mkdir(destDir, { recursive: true });

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const srcPath = join(agentsTemplateDir, entry);
    const destPath = join(destDir, entry);

    if (existsSync(destPath)) {
      result.preserved.push(entry);
      continue;
    }

    await copyFile(srcPath, destPath);
    result.installed.push(entry);
  }

  return result;
}

interface HookInfo {
  templatePath: string;
  available: boolean;
}

function getHookInfo(): HookInfo {
  const path = join(__dirname, "..", "..", "templates", "hooks", "brain-os-routing-guard.py");
  return { templatePath: path, available: existsSync(path) };
}

interface AgentInstructionSpec {
  template: string;
  destRel: string;
  displayName: string;
  minimal: boolean;
}

const AGENT_INSTRUCTIONS: AgentInstructionSpec[] = [
  { template: "AGENTS.md",                destRel: "AGENTS.md",                          displayName: "AGENTS.md",                          minimal: true },
  { template: "CLAUDE.md",                destRel: "CLAUDE.md",                          displayName: "CLAUDE.md",                          minimal: true },
  { template: "copilot-instructions.md",  destRel: ".github/copilot-instructions.md",    displayName: ".github/copilot-instructions.md",    minimal: false },
  { template: "cursor-brain-os.mdc",      destRel: ".cursor/rules/brain-os.mdc",         displayName: ".cursor/rules/brain-os.mdc",         minimal: false },
  { template: "zed-rules.md",             destRel: ".zed/rules.md",                      displayName: ".zed/rules.md",                      minimal: false },
  { template: "windsurfrules",            destRel: ".windsurfrules",                     displayName: ".windsurfrules",                     minimal: false },
];

interface AgentInstructionsResult {
  installed: string[];
  preserved: string[];
  skipped_minimal: string[];
}

async function installAgentInstructions(
  targetDir: string,
  minimal: boolean,
): Promise<AgentInstructionsResult> {
  const templatesRoot = join(__dirname, "..", "..", "templates", "agent-instructions");
  const result: AgentInstructionsResult = { installed: [], preserved: [], skipped_minimal: [] };

  if (!existsSync(templatesRoot)) return result;

  for (const spec of AGENT_INSTRUCTIONS) {
    if (minimal && !spec.minimal) {
      result.skipped_minimal.push(spec.displayName);
      continue;
    }
    const srcPath = join(templatesRoot, spec.template);
    if (!existsSync(srcPath)) continue;
    const destPath = join(targetDir, spec.destRel);
    if (existsSync(destPath)) {
      result.preserved.push(spec.displayName);
      continue;
    }
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(srcPath, destPath);
    result.installed.push(spec.displayName);
  }

  return result;
}

export interface InitOptions {
  withCommands?: boolean;
  withAgentInstructions?: boolean;
  minimal?: boolean;
}

export async function initBrain(targetDir: string, options: InitOptions = {}): Promise<string> {
  const withCommands = options.withCommands !== false;
  const withAgentInstructions = options.withAgentInstructions !== false;
  const minimal = options.minimal === true;
  const brainDir = join(targetDir, ".brain");

  const alreadyInitialized = existsSync(brainDir);

  if (!alreadyInitialized) {
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
  }

  let install: InstallResult | null = null;
  if (withCommands) {
    install = await installCommands(targetDir);
  }

  const protocol = await installProtocol(targetDir);
  const agents = await installAgents(targetDir);
  const agentInstructions: AgentInstructionsResult | null = withAgentInstructions
    ? await installAgentInstructions(targetDir, minimal)
    : null;
  const hook = getHookInfo();

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

  const output: string[] = [""];

  if (alreadyInitialized) {
    output.push(`Brain OS already initialized at ${brainDir}`);
  } else {
    output.push("Brain OS initialized.");
    output.push("");
    output.push(`  ${brainDir}/`);
    output.push("    entities/     : entity pulse files");
    output.push("    decisions/    : decision log");
    output.push("    patterns/     : pattern log");
    output.push("    sessions/     : session records");
    output.push("    config.json");
  }

  if (withCommands && install) {
    output.push("");
    if (install.installed.length > 0) {
      output.push(`Slash commands installed (${install.installed.length}):`);
      for (const name of install.installed) output.push(`    ${name}`);
      output.push("");
      output.push("  /brain:* are canonical. Bare /forms are aliases for power users.");
    }
    if (install.preserved.length > 0) {
      output.push("");
      output.push(`Already installed (preserved): ${install.preserved.join(", ")}`);
    }
    if (install.blocked.length > 0) {
      output.push("");
      output.push(`Could not install (path taken by another tool): ${install.blocked.join(", ")}`);
      output.push("  Rename or remove the conflicting file, then re-run init.");
    }
    if (
      install.installed.length === 0 &&
      install.preserved.length === 0 &&
      install.blocked.length === 0
    ) {
      output.push("No command templates available.");
    }
  } else if (!withCommands) {
    output.push("");
    output.push("Slash commands skipped (--no-commands).");
  }

  if (protocol.projectInstalled || protocol.userInstalled || protocol.userPreserved) {
    output.push("");
    output.push("Brain OS Protocol installed:");
    if (protocol.projectInstalled) output.push(`    ${protocol.projectPath}  (project)`);
    if (protocol.userInstalled) output.push(`    ${protocol.userPath}  (user, new)`);
    if (protocol.userPreserved) output.push(`    ${protocol.userPath}  (user, preserved)`);
    output.push("    Routing rules for every Brain OS slash command. Skills read this first.");
  }

  if (agents.installed.length > 0 || agents.preserved.length > 0) {
    output.push("");
    if (agents.installed.length > 0) {
      output.push(`Subagent installed: ${agents.installed.join(", ")}`);
      output.push("    Use when delegating Brain OS work to a subagent (Task tool with subagent_type=brain-os-mode).");
    }
    if (agents.preserved.length > 0) {
      output.push(`Subagent already present (preserved): ${agents.preserved.join(", ")}`);
    }
  }

  if (agentInstructions) {
    output.push("");
    if (agentInstructions.installed.length > 0) {
      output.push(`Agent instructions installed (${agentInstructions.installed.length}):`);
      for (const name of agentInstructions.installed) output.push(`    ${name}`);
      output.push("    AGENTS.md is canonical. Per-client files are thin pointers.");
    }
    if (agentInstructions.preserved.length > 0) {
      output.push("");
      output.push(`Agent instructions preserved (already present): ${agentInstructions.preserved.join(", ")}`);
    }
    if (agentInstructions.skipped_minimal.length > 0) {
      output.push("");
      output.push(`Skipped (--minimal): ${agentInstructions.skipped_minimal.join(", ")}`);
      output.push("    Re-run without --minimal to install pointer files for Copilot / Cursor / Zed / Windsurf.");
    }
  } else {
    output.push("");
    output.push("Agent instructions skipped (--no-agent-instructions).");
  }

  if (hook.available) {
    output.push("");
    output.push("Optional routing-guard hook available (opt-in):");
    output.push(`    ${hook.templatePath}`);
    output.push("    Warns when pulse files are read while a .brain/ workspace exists.");
    output.push("    To enable, add to .claude/settings.local.json:");
    output.push('      { "hooks": { "PreToolUse": [{ "matcher": "Read",');
    output.push(`            "hooks": [{ "type": "command", "command": "python3 ${hook.templatePath}" }] }] } }`);
  }

  output.push("");
  output.push("Add to your Claude Code or Cursor MCP config:");
  output.push("");
  output.push(JSON.stringify(mcpConfig, null, 2));
  output.push("");
  output.push("Then start a session. The agent will have these tools:");
  output.push("  entity_read, entity_update, decision_log, decision_check,");
  output.push("  focus_get, pattern_detect, semantic_recall, audit_log,");
  output.push("  memory_check, memory_commit, plan_set/add/advance/read");
  output.push("");

  return output.join("\n");
}

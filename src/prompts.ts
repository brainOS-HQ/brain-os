import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Check if Brain OS slash commands are already installed as skill files.
// If they exist, MCP Prompts would create duplicates in the command picker.
// Prompts are the fallback for users who connected the MCP server without
// running `brain-os init` — not a duplicate layer for users who did.
function commandsAlreadyInstalled(): boolean {
  const indicators = [
    join(homedir(), ".claude", "commands", "brain", "focus.md"),
    join(homedir(), ".claude", "commands", "brain.md"),
    join(process.cwd(), ".claude", "commands", "brain", "focus.md"),
    join(process.cwd(), ".claude", "commands", "brain.md"),
  ];
  return indicators.some((p) => existsSync(p));
}

async function loadTemplate(name: string): Promise<string> {
  const path = join(__dirname, "..", "templates", "commands", `${name}.md`);
  if (!existsSync(path)) return "";
  return readFile(path, "utf-8");
}

interface PromptSpec {
  name: string;
  title: string;
  description: string;
  templateFile: string;
}

const PROMPTS: PromptSpec[] = [
  {
    name: "brain",
    title: "Brain OS — Project Overview",
    description:
      "Instant project intelligence. See where things are, what's stale, what decisions are pending, and where to go next. Pass a project name for a deep view, or run without arguments for the full overview.",
    templateFile: "brain",
  },
  {
    name: "brain:focus",
    title: "Brain OS — What Should I Work On?",
    description:
      "Get a clear recommendation on what to work on right now, backed by evidence. Pass a project name to focus on one project, or a constraint like 'low energy' or 'only 2 hours'.",
    templateFile: "focus",
  },
  {
    name: "brain:decide",
    title: "Brain OS — Capture a Decision",
    description:
      "Log a strategic decision so it never gets lost or reopened accidentally. Records what was decided, why, what alternatives were rejected, and when to revisit.",
    templateFile: "decide",
  },
  {
    name: "brain:wrap",
    title: "Brain OS — Close This Session",
    description:
      "End the session cleanly. Reviews what happened, asks what to remember in plain language, and saves the notes you approve for next time.",
    templateFile: "wrap",
  },
  {
    name: "brain:retro",
    title: "Brain OS — What Happened This Week?",
    description:
      "Retrospective: what actually moved, what stuck, what you might be avoiding. Not a status report — a mirror.",
    templateFile: "retro",
  },
  {
    name: "brain:patterns",
    title: "Brain OS — What Patterns Are Emerging?",
    description:
      "Detect recurring blockers, stale work, avoidance signals, and theme convergence across your projects.",
    templateFile: "patterns",
  },
  {
    name: "brain:strategy",
    title: "Brain OS — Think Through a Decision",
    description:
      "Strategic thinking partner. Helps you think a decision through before you commit — names the real question, surfaces options, and recommends a direction.",
    templateFile: "strategy",
  },
  {
    name: "brain:graph",
    title: "Brain OS — How Do Projects Connect?",
    description:
      "Show how your projects connect, what they share, and where building one helps another.",
    templateFile: "graph",
  },
];

export function registerPrompts(server: McpServer): void {
  if (commandsAlreadyInstalled()) {
    // Skill files exist — prompts would duplicate the command picker.
    // Users who ran `brain-os init` already have the full workflow files.
    return;
  }

  for (const spec of PROMPTS) {
    server.prompt(
      spec.name,
      spec.description,
      { input: z.string().optional().describe("Project name, constraint, or question") },
      async ({ input }) => {
        const template = await loadTemplate(spec.templateFile);
        const userInput = input || "";
        const instructions = template
          ? template.replace(/\$ARGUMENTS/g, userInput)
          : `Run the Brain OS ${spec.name} workflow.`;

        return {
          messages: [
            {
              role: "assistant" as const,
              content: {
                type: "text" as const,
                text: instructions,
              },
            },
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: userInput
                  ? `/${spec.name} ${userInput}`
                  : `/${spec.name}`,
              },
            },
          ],
        };
      }
    );
  }
}

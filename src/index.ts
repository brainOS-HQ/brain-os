import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerTools } from "./server.js";
import { registerMcpServer, initBrainDir, listFileRoots, findExistingBrainDir, setBrainDir } from "./utils/file-store.js";
import { setupBrain } from "./tools/brain-setup.js";

const CURRENT_VERSION = "0.10.1";

const server = new McpServer({
  name: "brain-os",
  version: CURRENT_VERSION,
});

registerTools(server);
registerMcpServer(server);

// Local-only: writes project files, so it is registered here (stdio) and not in
// registerTools, which other surfaces share.
server.tool(
  "brain_setup",
  "Set up Brain OS in a project folder when no store exists yet (tools return 'No Brain OS store found'). Two steps, never skip the first: (1) call with no confirm — returns the proposed folder, a question for the user, and the exact files that would be created, refreshed, or preserved; nothing is written. It also returns a single-use preview_token. (2) Only after the user explicitly says yes, call again with confirm=true, the same target_dir and options, and that preview_token; writes without a matching token are refused. Existing instruction files are never overwritten; any that need a Brain OS line are listed in plan.needsIntegration — tell the user. Writes nothing outside the project unless include_user_protocol=true. If a store already exists, it reports that and does nothing.",
  {
    target_dir: z.string().optional().describe("Absolute path of the project folder. Required with confirm=true. Must be inside an open workspace folder when the client reports them."),
    confirm: z.boolean().optional().describe("true only after the user approved the folder and plan from the preview call."),
    preview_token: z.string().optional().describe("Token from the preview call. Required with confirm=true; single-use, expires after 15 minutes."),
    minimal: z.boolean().optional().describe("Install only AGENTS.md + CLAUDE.md instruction files, skip Copilot/Cursor/Zed/Windsurf pointers."),
    include_commands: z.boolean().optional().describe("Install Claude Code slash commands into .claude/commands. Default true."),
    include_user_protocol: z.boolean().optional().describe("Also write ~/.claude/brain-os/PROTOCOL.md in the home folder. Default false."),
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    const result = await setupBrain(input, {
      roots: await listFileRoots(),
      existingBrainDir: await findExistingBrainDir(),
      onCreated: setBrainDir,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

// Async resolution of workspace via MCP roots; getBrainDir() has sync fallback for tools that fire before this completes.
initBrainDir().catch(() => {});

// Check for newer version on npm (non-blocking, stderr only).
// Users on cached npx don't see fixes and think Brain OS is broken.
(async () => {
  try {
    const res = await fetch("https://registry.npmjs.org/brain-os/latest");
    if (!res.ok) return;
    const data = await res.json() as { version?: string };
    if (data.version && data.version !== CURRENT_VERSION) {
      console.error(
        `[brain-os] Update available: ${CURRENT_VERSION} → ${data.version}. ` +
        `Run: npx brain-os@latest serve (or clear npx cache with: npx clear-npx-cache)`
      );
    }
  } catch {
    // Network unavailable or registry down — silent, don't block startup.
  }
})();

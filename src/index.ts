import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./server.js";
import { registerMcpServer, initBrainDir } from "./utils/file-store.js";

const CURRENT_VERSION = "0.5.2";

const server = new McpServer({
  name: "brain-os",
  version: CURRENT_VERSION,
});

registerTools(server);
registerMcpServer(server);

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

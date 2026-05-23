import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./server.js";
import { registerMcpServer, initBrainDir } from "./utils/file-store.js";

const server = new McpServer({
  name: "brain-os",
  version: "0.4.3",
});

registerTools(server);
registerMcpServer(server);

const transport = new StdioServerTransport();
await server.connect(transport);

// Async resolution of workspace via MCP roots; getBrainDir() has sync fallback for tools that fire before this completes.
initBrainDir().catch(() => {});

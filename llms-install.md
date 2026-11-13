# Installing BrainOS (for AI agents such as Cline)

BrainOS is one memory for every AI tool: your AI picks up where you left off, with the decisions, plans and next steps already there. It runs as a local MCP server (stdio) and keeps its memory in a `.brain/` folder inside the user's project.

## Steps

1. **Ask the user which project folder BrainOS should remember.** Use its absolute path below as `<PROJECT>`.

2. **Create the memory folder** in that project:

   ```bash
   cd <PROJECT>
   npx -y brain-os init
   ```

   This creates `<PROJECT>/.brain/` and agent instruction files (`AGENTS.md`, plus small pointer files). It never overwrites existing instruction files. Node.js 18 or newer is required.

3. **Add the server to the MCP settings.** For Cline, that is `cline_mcp_settings.json`:

   ```json
   {
     "mcpServers": {
       "brain-os": {
         "command": "npx",
         "args": ["-y", "brain-os", "serve"],
         "env": {
           "BRAIN_DIR": "<PROJECT>/.brain"
         },
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```

   `BRAIN_DIR` is required for Cline and any other client that starts MCP servers outside the project folder. Without it, the server starts but every tool returns "No Brain OS store found", because it can't locate `.brain/`. Use an absolute path.

4. **Verify** by calling the `focus_get` tool. A JSON response with `"scope"` and `"priorities"` means it works. An error that mentions "No Brain OS store found" means `BRAIN_DIR` is missing or wrong.

## Notes

- No API key is needed for the core tools. `semantic_recall` is optional and needs `BRAIN_EMBEDDINGS` (see README).
- For several projects, add one server entry per project, each with its own `BRAIN_DIR`, for example `brain-os-myapp`.
- Everything stays in `<PROJECT>/.brain/` as JSON files. The user can commit it to git to share it with a team.

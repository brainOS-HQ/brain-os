import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readEntity, readAllEntities } from "./tools/entity-read.js";
import { updateEntity } from "./tools/entity-update.js";
import { logDecision } from "./tools/decision-log.js";
import { getFocus } from "./tools/focus-get.js";
import { detectPatterns } from "./tools/pattern-detect.js";
import { commitMemory } from "./tools/memory-commit.js";
import { checkMemory } from "./tools/memory-check.js";
import { recallByMeaning } from "./tools/semantic-recall.js";
import { getProviderInfo } from "./utils/embeddings.js";
import { generateStatusBrief } from "./resources/status.js";

export function registerTools(server: McpServer) {
  // ──────────────────────────────────────────────
  // AUTO-LOADED RESOURCE — agent sees this on connect
  // ──────────────────────────────────────────────

  server.resource(
    "status",
    "brain://status",
    {
      description: "Operational state overview — auto-loaded when the agent connects. Shows active entities, alerts (stale/blocked/fake progress), top priority, active patterns, and recent decisions. No tool call needed.",
      mimeType: "text/plain",
    },
    async () => {
      const brief = await generateStatusBrief();
      return { contents: [{ uri: "brain://status", text: brief, mimeType: "text/plain" }] };
    }
  );

  // ──────────────────────────────────────────────
  // TOOLS — agent calls these on demand
  // ──────────────────────────────────────────────

  server.tool(
    "entity_read",
    "Read operational state of one or all tracked entities. Returns status, momentum, blockers, decisions, staleness, and next actions.",
    {
      entity_id: z.string().optional().describe("Entity ID to read. Omit for all entities."),
    },
    async ({ entity_id }) => {
      const result = entity_id ? await readEntity(entity_id) : await readAllEntities();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "entity_update",
    "Update the operational state of a tracked entity. Use after work is done, a decision is made, a blocker changes, or momentum shifts.",
    {
      entity_id: z.string().describe("Entity to update"),
      updates: z.object({
        status: z.string().optional(),
        mode: z.enum(["active", "parked", "incubating", "archived"]).optional(),
        mode_reason: z.string().optional(),
        momentum: z.enum(["high", "medium", "low", "stalled"]).optional(),
        priority: z.enum(["critical", "high", "medium", "low"]).optional(),
        blocked: z.string().nullable().optional(),
        next_move: z.string().optional(),
        last_decision: z.string().optional(),
        evidence_of_progress: z.string().optional(),
        open_questions: z.array(z.string()).optional(),
        related_entities: z.array(z.string()).optional(),
      }).describe("Fields to update"),
    },
    async ({ entity_id, updates }) => {
      const result = await updateEntity(entity_id, updates);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "decision_log",
    "Log a strategic decision so it persists across sessions. Every decision needs a reason, alternatives, and a proof action.",
    {
      entity_id: z.string().describe("Entity this decision applies to"),
      decision: z.string().describe("What was decided"),
      type: z.enum(["product_direction", "architecture", "scope", "priority", "kill_park", "monetization", "brand"]).optional(),
      why: z.string().describe("The real reason"),
      alternatives: z.array(z.object({
        option: z.string(),
        rejected_because: z.string(),
      })).optional().describe("Options considered"),
      chosen_direction: z.string().optional(),
      proof_action: z.string().describe("One action that validates this decision"),
      review_date: z.string().describe("YYYY-MM-DD — when to revisit"),
    },
    async (args) => {
      const result = await logDecision(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "focus_get",
    "Determine what to work on right now based on urgency, momentum, leverage, staleness, and dependencies. Returns prioritized recommendations.",
    {
      constraints: z.string().optional().describe("Optional: 'only 2 hours', 'low energy', etc."),
      max_results: z.number().optional().describe("Max priorities to return (default 3)"),
    },
    async ({ constraints, max_results }) => {
      const result = await getFocus(constraints, max_results);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "pattern_detect",
    "Analyze patterns across all tracked entities. Detects repeated blockers, stale entities, recurring decisions, theme convergence, and avoidance signals.",
    {
      scope: z.string().optional().describe("'recent' for 7 days, 'deep' for full, or a specific theme"),
    },
    async ({ scope }) => {
      const result = await detectPatterns(scope);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "memory_check",
    "Assess quality and reliability of current memory state. Flags stale data, contradictions, overdue decision reviews, unconfirmed patterns, fake-active entities, and noise. Returns signal classification (strong/weak/noise/dangerous) and recommended cleanup actions. Call this before acting on memory to know what to trust.",
    {
      entity_id: z.string().optional().describe("Check one entity, or omit for full memory audit"),
    },
    async ({ entity_id }) => {
      const result = await checkMemory(entity_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "memory_commit",
    "End-of-session commit. Updates all touched entities, logs decisions, records patterns. Call before ending any work session.",
    {
      session_summary: z.string().describe("Brief summary of what happened"),
      entities_touched: z.array(z.string()).describe("Entity IDs worked on"),
      decisions_made: z.array(z.object({
        entity_id: z.string(),
        decision: z.string(),
        why: z.string(),
      })).optional(),
      patterns_noticed: z.array(z.string()).optional(),
      momentum_changes: z.array(z.object({
        entity_id: z.string(),
        direction: z.enum(["up", "same", "down", "stalled"]),
      })).optional(),
    },
    async (args) => {
      const result = await commitMemory(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "semantic_recall",
    "Search memory by meaning, not just ID. Finds relevant entities, decisions, patterns, and sessions using semantic similarity. Use when the agent needs context but doesn't know the exact entity ID or decision name.",
    {
      query: z.string().describe("Natural language query — e.g. 'that decision about pricing' or 'projects related to memory systems'"),
      source_kind: z.enum(["entity", "decision", "pattern", "session"]).optional().describe("Filter by type. Omit to search everything."),
      max_results: z.number().optional().describe("Max results to return (default 5)"),
    },
    async ({ query, source_kind, max_results }) => {
      const providerInfo = await getProviderInfo();
      const result = await recallByMeaning(query, source_kind, max_results);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ...result, provider: providerInfo.provider }, null, 2),
        }],
      };
    }
  );
}

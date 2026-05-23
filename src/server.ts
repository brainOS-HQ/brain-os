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
import { readAuditLog } from "./tools/audit-read.js";
import { setPlan, advancePlan, addPlanSteps, readPlan } from "./tools/plan-update.js";
import { checkDecision } from "./tools/decision-check.js";
import { refreshDecision } from "./tools/decision-refresh.js";
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
      supersedes: z.array(z.string()).optional().describe("Decision IDs this new decision replaces (e.g. ['dec-007']). Only the IDs you explicitly pass will be marked superseded — there is no auto-deduction from type. Each target must belong to the same entity_id."),
    },
    async (args) => {
      const result = await logDecision(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "decision_check",
    "Check a proposed action against all active decisions. Returns 'clear', 'caution', or 'conflict'. Call this BEFORE taking actions that might contradict prior decisions. If status is 'conflict', do NOT proceed without explicit user confirmation to revisit the decision.",
    {
      proposed_action: z.string().describe("What you're about to do — describe the action clearly"),
      entity_id: z.string().optional().describe("Check against decisions for a specific entity. Omit to check all."),
    },
    async ({ proposed_action, entity_id }) => {
      const result = await checkDecision({ proposed_action, entity_id });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "decision_refresh",
    "Refresh an existing decision's metadata: bump review_date forward, append evidence as the decision continues to hold, or change status (active/superseded/archived). Use INSTEAD of editing decisions.json directly. Does not mutate decision content — for content changes, log a new decision via decision_log.",
    {
      decision_id: z.string().describe("ID of the decision to refresh (e.g. 'dec-002')"),
      review_date: z.string().optional().describe("New review date YYYY-MM-DD"),
      add_evidence: z.string().optional().describe("Evidence note to append (e.g. 'YC submitted, launch landed'). Each call appends a dated entry, never overwrites."),
      status: z.enum(["active", "superseded", "archived"]).optional().describe("New status. Use 'superseded' only when a replacement decision exists — prefer logging the replacement via decision_log with its `supersedes` parameter instead. Transitioning away from 'superseded' automatically clears the dangling superseded_by pointer."),
    },
    async ({ decision_id, review_date, add_evidence, status }) => {
      const result = await refreshDecision({ decision_id, review_date, add_evidence, status });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "focus_get",
    "Determine what to work on right now based on urgency, momentum, leverage, staleness, and dependencies. Returns prioritized recommendations.",
    {
      constraints: z.string().optional().describe("Optional: 'only 2 hours', 'low energy', etc."),
      max_results: z.number().optional().describe("Max priorities to return (default 3)"),
      suppress_default_guidance: z
        .boolean()
        .optional()
        .describe(
          "Set true to omit the built-in 'Do not reorganize…' / 'Do not start new ideas…' lines from do_not_do. " +
          "Default false. Env override: BRAIN_FOCUS_OMIT_DEFAULT_GUIDANCE=1."
        ),
    },
    async ({ constraints, max_results, suppress_default_guidance }) => {
      const result = await getFocus(constraints, max_results, { suppress_default_guidance });
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

  server.tool(
    "audit_log",
    "Read the audit trail of all memory mutations. Shows what changed, when, by which tool, and what the before/after state was. Use to understand history, verify integrity, or debug unexpected state.",
    {
      entity_id: z.string().optional().describe("Filter by entity ID"),
      tool: z.string().optional().describe("Filter by tool name (entity_update, decision_log, memory_commit, plan_update)"),
      last_n: z.number().optional().describe("Number of recent entries to return (default 20)"),
    },
    async ({ entity_id, tool, last_n }) => {
      const result = await readAuditLog({ entity_id, tool, last_n });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ──────────────────────────────────────────────
  // PLAN — ordered work continuity
  // ──────────────────────────────────────────────

  server.tool(
    "plan_set",
    "Set an ordered plan for an entity. Replaces any existing plan. Step 1 becomes the active next_move. Use when committing to a sequence of work — not for brainstorming. Each step should be a concrete, completable action.",
    {
      entity_id: z.string().describe("Entity to set the plan for"),
      steps: z.array(z.string()).min(1).describe("Ordered list of concrete steps. First step becomes active immediately."),
    },
    async ({ entity_id, steps }) => {
      const result = await setPlan({ entity_id, steps });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "plan_advance",
    "Complete or skip the current plan step. Requires evidence (for complete) or reason (for skip). Automatically promotes the next pending step to active and updates next_move. Enforces continuity — you cannot skip without explaining why.",
    {
      entity_id: z.string().describe("Entity whose plan to advance"),
      step_id: z.string().describe("Step ID to complete or skip (e.g. 'step-001')"),
      action: z.enum(["complete", "skip"]).describe("Complete (with evidence) or skip (with reason)"),
      evidence: z.string().optional().describe("Required for complete — what proved this step is done"),
      reason: z.string().optional().describe("Required for skip — why this step is being skipped"),
    },
    async ({ entity_id, step_id, action, evidence, reason }) => {
      const result = await advancePlan({ entity_id, step_id, action, evidence, reason });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "plan_add",
    "Add steps to an existing plan. Use when new work is discovered mid-plan. Steps can be added at the end or immediately after the current active step.",
    {
      entity_id: z.string().describe("Entity to add steps to"),
      steps: z.array(z.string()).min(1).describe("Steps to add"),
      position: z.enum(["end", "after_current"]).optional().describe("Where to insert: 'end' (default) or 'after_current'"),
    },
    async ({ entity_id, steps, position }) => {
      const result = await addPlanSteps({ entity_id, steps, position });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "plan_read",
    "Read the current plan for an entity. Shows all steps, their status, the active step, and overall progress.",
    {
      entity_id: z.string().describe("Entity to read the plan for"),
    },
    async ({ entity_id }) => {
      const result = await readPlan(entity_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}

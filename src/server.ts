import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts.js";
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
import { checkWrapStatus } from "./tools/wrap-check.js";
import { wrapAuto } from "./tools/wrap-auto.js";
import { setPlan, advancePlan, addPlanSteps, readPlan } from "./tools/plan-update.js";
import { checkDecision } from "./tools/decision-check.js";
import { refreshDecision } from "./tools/decision-refresh.js";
import { resolveContext } from "./tools/context-resolve.js";
import { scanProjectEvidence } from "./tools/project-evidence-scan.js";
import { reviewDecisions } from "./tools/decision-review.js";
import { assessRisk } from "./tools/risk-assess.js";
import { guardAction } from "./tools/action-guard.js";
import { getProviderInfo } from "./utils/embeddings.js";
import { generateStatusBrief } from "./resources/status.js";
import { createLocalJsonAdapter } from "./storage/local-json.js";
import type { StorageAdapter, ToolContext } from "./storage/adapter.js";

export function registerTools(server: McpServer, adapter?: StorageAdapter, opts?: { skipPrompts?: boolean; skipTools?: string[] }) {
  const ctx: ToolContext = { storage: adapter ?? createLocalJsonAdapter() };

  // ──────────────────────────────────────────────
  // AUTO-LOADED RESOURCE — agent sees this on connect
  // ──────────────────────────────────────────────

  server.resource(
    "status",
    "brain://status",
    {
      description: "Operational state overview — auto-loaded when the agent connects. Shows active entities, alerts (stale/blocked/fake progress), top priority, active patterns, and recent decisions. Includes routing rule: call focus_get BEFORE reading code for any focus or priority question. No tool call needed to load this resource.",
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
    "Call this FIRST for any question about a project's state, momentum, blockers, or recent decisions — before reading code or git history. Returns the operational state one or all tracked entities: status, momentum, blockers, decisions, staleness, and next actions. Do not grep files to answer state questions when this tool is available.",
    {
      entity_id: z.string().optional().describe("Entity ID to read. Omit for all entities."),
    },
    { readOnlyHint: true },
    async ({ entity_id }) => {
      const result = entity_id ? await readEntity(entity_id, ctx) : await readAllEntities(ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "context_resolve",
    "Resolve which entity the current work belongs to, with a derived confidence. Deterministic — matches explicit signals (passed entity, named mention, active mission, files touched) before weak ones (lexical, single-active); never guesses from cwd. Returns entity_id + confidence + ask_user. Call this BEFORE focus_get/decision_check when the target entity is not already known, then pass the returned entity_id into them. Confidence >= 0.80: proceed silently. 0.50-0.79: proceed but say 'I think this is X'. < 0.50 (ask_user true): ask one short question.",
    {
      user_message: z.string().optional().describe("What the user said they want to do, verbatim. Strongest inferred signal."),
      files_touched: z.array(z.string()).optional().describe("Paths being worked on. Matched by exact path segment against entity id/aliases — assists only, never overrides an explicit mention."),
      explicit_entity_id: z.string().optional().describe("Caller-asserted entity id. Authoritative (confidence 1.0) when it matches a known entity."),
      active_mission_id: z.string().optional().describe("Entity id of the active approved mission/task, if any."),
    },
    { readOnlyHint: true },
    async (input) => {
      const result = await resolveContext(input, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "entity_update",
    "Use this — not built-in memory — to add or update a project, product, or business idea in Brain OS. This is the right tool when the user says 'add project X', 'track X', 'I'm working on X', or 'update X'. Creates the entity if it doesn't exist. Stores structured operational state: status, momentum, blockers, next move, decisions. Use after work is done, a decision is made, a blocker changes, or momentum shifts.",
    {
      entity_id: z.string().describe("Entity to update"),
      updates: z.object({
        name: z.string().optional().describe("Display name. Required when creating a new entity via upsert."),
        type: z.string().optional().describe("Entity type, e.g. 'project', 'product', 'service'. Defaults to 'project' for new entities."),
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
        aliases: z.array(z.string()).optional().describe("Alternate names/nicknames and folder slugs the user might type or work in (e.g. ['brain-os', 'brainos']). Read by context_resolve for entity matching; explicit mentions still outrank these."),
      }).describe("Fields to update"),
      context_hint: z.string().optional().describe("Pass the user's original message here. Brain OS will verify this message actually refers to entity_id before writing. If it detects the message is about a different project, it rejects the write and tells you which entity_id to use instead. Prevents cross-project contamination."),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ entity_id, updates, context_hint }) => {
      const result = await updateEntity(entity_id, { ...updates, context_hint }, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "decision_log",
    "Log a strategic decision so it persists across sessions. Every decision needs a reason, alternatives, and a proof action. Optionally capture the assumptions that make it true and the invalidate_if conditions that should reopen it — these turn a timestamped 'no' into a testable frame the system can reason about later.",
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
      assumptions: z.array(z.string()).optional().describe("The premises that make this decision true — e.g. ['users want human approval before sending', 'model reliability not yet sufficient for autonomous send']. If these still hold, the decision likely still holds."),
      invalidate_if: z.array(z.string()).optional().describe("Condition-based review triggers ('what would make this false') — e.g. ['users show sustained trust in autonomous drafts', 'target workflow shifts from external email to internal triage']. Distinct from review_date (a time trigger): decision_check matches proposed actions against these to flag the decision for review rather than enforcing it blindly."),
      proof_action: z.string().describe("One concrete, observable action that validates this decision — e.g. 'Run npm test and confirm all 41 tests pass'. Placeholders like 'Review in next session', 'TBD', or 'Revisit' are rejected."),
      review_date: z.string().describe("YYYY-MM-DD — when to revisit"),
      supersedes: z.array(z.string()).optional().describe("Decision IDs this new decision replaces (e.g. ['dec-007']). Only the IDs you explicitly pass will be marked superseded — there is no auto-deduction from type. Each target must belong to the same entity_id."),
    },
    { readOnlyHint: false, destructiveHint: false },
    async (args) => {
      const result = await logDecision(args, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "decision_check",
    "Check a proposed action against all active decisions. Returns 'clear', 'caution', or 'conflict', plus a `review_triggered` list. Call this BEFORE taking actions that might contradict prior decisions. If status is 'conflict', do NOT proceed without explicit user confirmation to revisit the decision. `review_triggered` is the opposite signal: the action matches an invalidate_if condition a decision named as a reason to reopen it — surface those decisions to the user for review rather than enforcing them. A decision can be both a conflict and a review trigger (the conflict it anticipated); when so, frame it as a decision review, not a blind violation.",
    {
      proposed_action: z.string().describe("What you're about to do — describe the action clearly"),
      entity_id: z.string().optional().describe("Check against decisions for a specific entity. Omit to check all."),
    },
    { readOnlyHint: true },
    async ({ proposed_action, entity_id }) => {
      const result = await checkDecision({ proposed_action, entity_id }, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "decision_refresh",
    "Refresh an existing decision's metadata: bump review_date forward, append evidence as the decision continues to hold, or change status (active/superseded/archived). Use INSTEAD of editing decisions.json directly. Does not mutate decision content — for content changes, log a new decision via decision_log.",
    {
      decision_id: z.string().describe("ID of the decision to refresh (e.g. 'dec-002')"),
      review_date: z.string().optional().describe("New review date YYYY-MM-DD"),
      add_evidence: z.string().optional().describe("Evidence note to append (e.g. 'shipped v1, onboarded first users'). Each call appends a dated entry, never overwrites."),
      status: z.enum(["active", "superseded", "archived"]).optional().describe("New status. Use 'superseded' only when a replacement decision exists — prefer logging the replacement via decision_log with its `supersedes` parameter instead. Transitioning away from 'superseded' automatically clears the dangling superseded_by pointer."),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ decision_id, review_date, add_evidence, status }) => {
      const result = await refreshDecision({ decision_id, review_date, add_evidence, status }, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "focus_get",
    "CALL THIS FIRST when the user asks what to focus on, what to work on, what their priorities are, or what matters most — before reading any code, files, or git history. Brain OS holds decisions, blockers, and momentum signals that cannot be inferred from the codebase. Returns prioritized recommendations based on urgency, momentum, leverage, staleness, and dependencies. `follow_through_alerts` surfaces active entities that stated a next_move but haven't logged any update in 7+ days — treat these as first-class accountability prompts, same tier as blockers. Pass entity_id to scope focus to a single project.",
    {
      entity_id: z.string().optional().describe("Scope focus to a single entity. When set, returns only that entity. Omit for global cross-project priorities."),
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
    { readOnlyHint: true },
    async ({ entity_id, constraints, max_results, suppress_default_guidance }) => {
      const result = await getFocus(ctx, constraints, max_results, { suppress_default_guidance, entity_id });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "pattern_detect",
    "Call this when the user asks about patterns, recurring blockers, what keeps coming up, theme convergence, or avoidance signals — instead of grepping git logs or reading files to find trends. Analyzes patterns across all tracked entities and returns detected signals with entity context.",
    {
      scope: z.string().optional().describe("'recent' for 7 days, 'deep' for full, or a specific theme"),
    },
    { readOnlyHint: true },
    async ({ scope }) => {
      const result = await detectPatterns(ctx, scope);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "memory_check",
    "Assess quality and reliability of current memory state. Flags stale data, contradictions, overdue decision reviews, unconfirmed patterns, fake-active entities, and noise. Returns signal classification (strong/weak/noise/dangerous) and recommended cleanup actions. Call this before acting on memory to know what to trust.",
    {
      entity_id: z.string().optional().describe("Check one entity, or omit for full memory audit"),
    },
    { readOnlyHint: true },
    async ({ entity_id }) => {
      const result = await checkMemory(ctx, entity_id);
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
    { readOnlyHint: false, destructiveHint: true },
    async (args) => {
      const result = await commitMemory(args, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  if (!opts?.skipTools?.includes("semantic_recall")) {
    server.tool(
      "semantic_recall",
      "Call this when the user asks what changed last session, what happened recently, or needs to find a decision/entity by description rather than exact name. Searches memory by meaning using semantic similarity. Use BEFORE reading git log or commit history for session-level context questions.",
      {
        query: z.string().describe("Natural language query — e.g. 'that decision about pricing' or 'projects related to memory systems'"),
        source_kind: z.enum(["entity", "decision", "pattern", "session"]).optional().describe("Filter by type. Omit to search everything."),
        max_results: z.number().optional().describe("Max results to return (default 5)"),
      },
      { readOnlyHint: true },
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

  server.tool(
    "audit_log",
    "Read the audit trail of all memory mutations. Use this — not semantic_recall — for recency questions: 'what's the latest update?', 'what changed recently?', 'what was the last thing written?', 'show me the most recent entry.' Pass last_n=1 for the single most recent mutation. semantic_recall is for topic-based search; audit_log is for time-ordered history, integrity checks, and debugging unexpected state.",
    {
      entity_id: z.string().optional().describe("Filter by entity ID"),
      tool: z.string().optional().describe("Filter by tool name (entity_update, decision_log, memory_commit, plan_update)"),
      last_n: z.number().optional().describe("Number of recent entries to return (default 20)"),
    },
    { readOnlyHint: true },
    async ({ entity_id, tool, last_n }) => {
      const result = await readAuditLog(ctx, { entity_id, tool, last_n });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "wrap_check",
    "Check how much state-changing work has accumulated since the last wrap. Read-only — never mutates. Tier 1 of auto-wrap: call this when the user signals they are wrapping up or ending a session, or periodically during a long session, to decide whether to proactively offer a /wrap before context is lost to compaction or session end. Returns unwrapped_count, the projects touched, and recommend_wrap. When recommend_wrap is true, offer to wrap; do not auto-wrap silently from this tool.",
    {
      session_id: z.string().optional().describe("Scope the check to one session's activity. Omit to check the whole audit tail."),
      threshold: z.number().optional().describe("Unwrapped-mutation count at/above which a wrap is recommended. Default 5."),
    },
    { readOnlyHint: true },
    async ({ session_id, threshold }) => {
      const result = await checkWrapStatus(ctx, { session_id, threshold });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "wrap_auto",
    "Tier 2 of auto-wrap: persist a session wrap WITHOUT interactive review, when context is about to be lost (compaction, session end) or the user declined to review. Use the normal interactive /wrap when the user is present and reviewing — only reach for this as a safety net. The agent supplies the synthesized wrap; this tool applies LOW-RISK fields (next_move, open_questions, evidence_of_progress) immediately and STAGES high-risk changes (status, mode, blocked, decisions) as an unconfirmed record for /start to surface and the user to confirm. Always logs a session_wrapped marker. Never put a status change or a decision in pending_review expecting it to take effect now — staged items are proposals, not writes.",
    {
      entity_id: z.string().describe("Entity being wrapped."),
      summary: z.string().describe("One-line synthesized summary of what happened this session."),
      next_move: z.string().optional().describe("LOW-RISK, applied now — the concrete next action."),
      evidence_of_progress: z.string().optional().describe("LOW-RISK, appended now — what actually shipped or moved."),
      open_questions: z.array(z.string()).optional().describe("LOW-RISK, merged now — unresolved threads."),
      pending_review: z.object({
        status: z.string().optional(),
        mode: z.enum(["active", "parked", "incubating", "archived"]).optional(),
        mode_reason: z.string().optional(),
        blocked: z.string().nullable().optional(),
        decisions: z.array(z.object({ decision: z.string(), why: z.string() })).optional(),
      }).optional().describe("HIGH-RISK — staged for review, NOT applied. Surfaced at next /start for confirm/edit/discard."),
      session_id: z.string().optional().describe("Host session id, when known."),
      trigger: z.string().optional().describe("What triggered it: precompact | sessionend | manual-no-review."),
    },
    { readOnlyHint: false },
    async (input) => {
      const result = await wrapAuto(input, ctx);
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
    { readOnlyHint: false, destructiveHint: true },
    async ({ entity_id, steps }) => {
      const result = await setPlan({ entity_id, steps }, ctx);
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
    { readOnlyHint: false, destructiveHint: false },
    async ({ entity_id, step_id, action, evidence, reason }) => {
      const result = await advancePlan({ entity_id, step_id, action, evidence, reason }, ctx);
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
    { readOnlyHint: false, destructiveHint: false },
    async ({ entity_id, steps, position }) => {
      const result = await addPlanSteps({ entity_id, steps, position }, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "plan_read",
    "Read the current plan for an entity. Shows all steps, their status, the active step, and overall progress.",
    {
      entity_id: z.string().describe("Entity to read the plan for"),
    },
    { readOnlyHint: true },
    async ({ entity_id }) => {
      const result = await readPlan(entity_id, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "project_evidence_scan",
    "Read-only scan of a repo's native operating state (STATE.md, FLAGS*, HANDOFF*, ROADMAP.md, PLAN*.md, TODO.md, AGENTS.md + recent git activity / dirty files). Returns evidence — human gates, blockers, next moves, do-not-touch, safe parallel work — surfaced as exact lines. Call AFTER context_resolve and BEFORE building a focus answer. Mutates nothing and does no inference: it returns ALL candidate signals; deciding the focus is the agent's job. This is NOT context_resolve — do not use it to pick which project you're in.",
    {
      root_path: z.string().describe("Absolute path to the repo/project root to scan."),
      entity_id: z.string().optional().describe("Optional Brain OS entity this repo maps to (echoed back; does not affect the scan)."),
    },
    { readOnlyHint: true },
    async ({ root_path, entity_id }) => {
      const result = scanProjectEvidence({ root_path, entity_id });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "decision_review",
    "Call this before making new decisions, at session end, or when the user asks if a decision is still valid or what's overdue. Review-debt inbox: buckets overdue decisions into still_true / changed / archive / needs_evidence with a recommended action for each. READ-ONLY — proposes and cites reasons but mutates nothing; confirm, then apply via decision_refresh / decision_log. Auto-detects duplicate stubs. When root_path is provided, matches each decision's invalidate_if conditions against repo scan output.",
    {
      entity_id: z.string().optional().describe("Scope to one entity. Omit to review all entities' overdue decisions."),
      limit: z.number().optional().describe("Max decisions to surface (default 5)."),
      include_parked: z.boolean().optional().describe("Include decisions on parked/archived entities (default false)."),
      root_path: z.string().optional().describe("Absolute path to a project repo. When provided, runs project_evidence_scan and matches invalidate_if conditions against git log and state files. Matched decisions are moved to the 'changed' bucket with the triggering evidence cited."),
    },
    { readOnlyHint: true },
    async ({ entity_id, limit, include_parked, root_path }) => {
      const result = await reviewDecisions({ entity_id, limit, include_parked, root_path }, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ──────────────────────────────────────────────
  // GUARDIAN — risk_assess + action_guard
  // ──────────────────────────────────────────────

  server.tool(
    "risk_assess",
    "Assess the risk of a proposed action before executing it. Runs a pre-filter (returns low/skipped immediately for clearly safe actions) then applies signal detection for: private→public boundary crossings, destructive operations, release/publish actions, external communication, and security-sensitive file access. Call this BEFORE any action in the trigger set: publish, push, force-push, git tag, deploy, delete tracked files, external API writes, billing, roadmap/private state movement. Returns risk_level (low/medium/high/critical), boundary_crossed, reversibility, and risk_reasons. Pass the result to action_guard to get a policy decision (allow/ask/block).",
    {
      proposed_action: z.string().describe("The action about to be taken — describe it clearly, e.g. 'npm publish brain-os@0.9.0' or 'write ROADMAP.md to public repo'."),
      entity_id: z.string().optional().describe("Brain OS entity this action is associated with."),
      diff: z.string().optional().describe("Git diff or content diff of the proposed change."),
      files_touched: z.array(z.string()).optional().describe("File paths the action will read or write."),
      target_visibility: z.enum(["public", "private", "unknown"]).optional().describe("Whether the target destination is public-facing. Pass 'public' when writing to a public repo or publishing to a registry."),
      git_status: z.string().optional().describe("Output of git status, if relevant."),
      package_info: z.object({
        name: z.string(),
        version: z.string(),
        registry: z.string().optional(),
      }).optional().describe("package.json metadata for release actions."),
    },
    { readOnlyHint: true },
    async (input) => {
      const result = await assessRisk(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "action_guard",
    "Apply the Brain OS policy table to a risk assessment. Takes the output of risk_assess plus the concrete action type and returns a policy decision: allow (proceed), ask (stop and get explicit user confirmation), or block (do not proceed). Pure TypeScript — no LLM call. Policies in order: private_to_public → block; critical risk → block; force-push → ask; npm publish → ask; security boundary → ask; irreversible → ask; high risk → ask; hard-to-reverse external → ask; medium + requires_confirmation → ask; else → allow. Always audit what was decided and why.",
    {
      assessment: z.object({
        risk_level: z.enum(["low", "medium", "high", "critical"]),
        boundary_crossed: z.enum(["none", "private_to_public", "local_to_external", "destructive", "release", "security"]),
        reversibility: z.enum(["reversible", "hard_to_reverse", "irreversible"]),
        requires_confirmation: z.boolean(),
        risk_reasons: z.array(z.string()),
        pre_filter_skipped: z.boolean(),
      }).describe("The full output of risk_assess."),
      action_type: z.string().describe("The concrete action being guarded, e.g. 'npm publish', 'git push origin main', 'force push', 'write ROADMAP.md'."),
      entity_id: z.string().optional().describe("Brain OS entity this action is associated with."),
    },
    { readOnlyHint: true },
    async ({ assessment, action_type, entity_id }) => {
      const result = await guardAction({ assessment, action_type, entity_id });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ──────────────────────────────────────────────
  // PROMPTS — guided workflows via prompts/list
  // ──────────────────────────────────────────────

  if (!opts?.skipPrompts) {
    registerPrompts(server);
  }
}

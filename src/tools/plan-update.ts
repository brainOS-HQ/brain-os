import { Entity, PlanStep } from "../schemas/entity.js";
import { readJsonFile, writeJsonFile, getEntitiesDir, assertSafeId } from "../utils/file-store.js";
import { today } from "../utils/staleness.js";
import { audit } from "../utils/audit.js";

interface PlanSetInput {
  entity_id: string;
  steps: string[];
}

interface PlanStepAction {
  entity_id: string;
  step_id: string;
  action: "complete" | "skip";
  evidence?: string;
  reason?: string;
}

interface PlanAddInput {
  entity_id: string;
  steps: string[];
  position?: "end" | "after_current";
}

function nextStepId(plan: PlanStep[]): string {
  const max = plan.reduce((n, s) => {
    const num = parseInt(s.id.replace("step-", ""), 10);
    return num > n ? num : n;
  }, 0);
  return `step-${String(max + 1).padStart(3, "0")}`;
}

function promoteNextStep(entity: Entity): string | null {
  if (!entity.plan || entity.plan.length === 0) return null;

  const existingActive = entity.plan.find((s) => s.status === "active");
  if (existingActive) {
    entity.next_move = existingActive.description;
    return null;
  }

  const nextPending = entity.plan.find((s) => s.status === "pending");
  if (nextPending) {
    nextPending.status = "active";
    entity.next_move = nextPending.description;
    return nextPending.id;
  }

  const allDone = entity.plan.every((s) => s.status === "done" || s.status === "skipped");
  if (allDone) {
    entity.next_move = "Plan complete — define next plan or update status";
    return null;
  }

  return null;
}

export async function setPlan(input: PlanSetInput): Promise<{
  entity_id: string;
  plan: PlanStep[];
  next_move: string;
}> {
  assertSafeId(input.entity_id, "entity_id");
  const path = `${getEntitiesDir()}/${input.entity_id}.json`;
  const entity = await readJsonFile<Entity>(path);
  if (!entity) throw new Error(`Entity "${input.entity_id}" not found.`);

  const before = { plan: entity.plan, next_move: entity.next_move };

  const plan: PlanStep[] = input.steps.map((desc, i) => ({
    id: `step-${String(i + 1).padStart(3, "0")}`,
    description: desc,
    status: i === 0 ? "active" : "pending",
    evidence: null,
    skipped_reason: null,
    completed_at: null,
  }));

  entity.plan = plan;
  entity.next_move = plan[0].description;
  entity.last_updated = today();

  await writeJsonFile(path, entity);

  await audit("plan_update", "set_plan", `Set ${plan.length}-step plan`, {
    entity_id: input.entity_id,
    before,
    after: { plan: entity.plan, next_move: entity.next_move },
  });

  return { entity_id: input.entity_id, plan: entity.plan, next_move: entity.next_move };
}

export async function advancePlan(input: PlanStepAction): Promise<{
  entity_id: string;
  completed_step: string;
  promoted_step: string | null;
  next_move: string;
  plan_progress: string;
}> {
  assertSafeId(input.entity_id, "entity_id");
  assertSafeId(input.step_id, "step_id");
  const path = `${getEntitiesDir()}/${input.entity_id}.json`;
  const entity = await readJsonFile<Entity>(path);
  if (!entity) throw new Error(`Entity "${input.entity_id}" not found.`);
  if (!entity.plan || entity.plan.length === 0) throw new Error(`Entity "${input.entity_id}" has no plan.`);

  const step = entity.plan.find((s) => s.id === input.step_id);
  if (!step) throw new Error(`Step "${input.step_id}" not found.`);
  if (step.status === "done" || step.status === "skipped") {
    throw new Error(`Step "${input.step_id}" is already ${step.status}.`);
  }

  const before = { step: { ...step }, next_move: entity.next_move };

  if (input.action === "complete") {
    if (!input.evidence) throw new Error("Evidence required to complete a step. What proved this is done?");
    step.status = "done";
    step.evidence = input.evidence;
    step.completed_at = today();
  } else {
    if (!input.reason) throw new Error("Reason required to skip a step. Why is it being skipped?");
    step.status = "skipped";
    step.skipped_reason = input.reason;
    step.completed_at = today();
  }

  const promoted = promoteNextStep(entity);
  entity.last_updated = today();

  const done = entity.plan.filter((s) => s.status === "done").length;
  const skipped = entity.plan.filter((s) => s.status === "skipped").length;
  const total = entity.plan.length;
  const plan_progress = `${done}/${total} done${skipped > 0 ? `, ${skipped} skipped` : ""}`;

  await writeJsonFile(path, entity);

  await audit("plan_update", input.action, `${input.action}: ${step.description}`, {
    entity_id: input.entity_id,
    before,
    after: { step: { ...step }, next_move: entity.next_move, promoted },
  });

  return {
    entity_id: input.entity_id,
    completed_step: step.description,
    promoted_step: promoted,
    next_move: entity.next_move,
    plan_progress,
  };
}

export async function addPlanSteps(input: PlanAddInput): Promise<{
  entity_id: string;
  added: PlanStep[];
  plan: PlanStep[];
}> {
  assertSafeId(input.entity_id, "entity_id");
  const path = `${getEntitiesDir()}/${input.entity_id}.json`;
  const entity = await readJsonFile<Entity>(path);
  if (!entity) throw new Error(`Entity "${input.entity_id}" not found.`);

  if (!entity.plan) entity.plan = [];

  const before = { plan: [...entity.plan] };

  const newSteps: PlanStep[] = [];
  for (const desc of input.steps) {
    const id = nextStepId([...entity.plan, ...newSteps]);
    newSteps.push({
      id,
      description: desc,
      status: "pending",
      evidence: null,
      skipped_reason: null,
      completed_at: null,
    });
  }

  if (input.position === "after_current") {
    const activeIdx = entity.plan.findIndex((s) => s.status === "active");
    const insertAt = activeIdx >= 0 ? activeIdx + 1 : 0;
    entity.plan.splice(insertAt, 0, ...newSteps);
  } else {
    entity.plan.push(...newSteps);
  }

  if (!entity.plan.some((s) => s.status === "active")) {
    promoteNextStep(entity);
  }

  entity.last_updated = today();
  await writeJsonFile(path, entity);

  await audit("plan_update", "add_steps", `Added ${newSteps.length} steps`, {
    entity_id: input.entity_id,
    before,
    after: { plan: entity.plan },
  });

  return { entity_id: input.entity_id, added: newSteps, plan: entity.plan };
}

export async function readPlan(entityId: string): Promise<{
  entity_id: string;
  entity_name: string;
  plan: PlanStep[];
  current_step: PlanStep | null;
  progress: string;
  next_move: string;
}> {
  assertSafeId(entityId, "entity_id");
  const path = `${getEntitiesDir()}/${entityId}.json`;
  const entity = await readJsonFile<Entity>(path);
  if (!entity) throw new Error(`Entity "${entityId}" not found.`);

  const plan = entity.plan || [];
  const current = plan.find((s) => s.status === "active") || null;
  const done = plan.filter((s) => s.status === "done").length;
  const total = plan.length;
  const progress = total === 0 ? "No plan set" : `${done}/${total} done`;

  return {
    entity_id: entityId,
    entity_name: entity.name,
    plan,
    current_step: current,
    progress,
    next_move: entity.next_move,
  };
}

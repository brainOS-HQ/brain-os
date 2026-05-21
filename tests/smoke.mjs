import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpBrain = mkdtempSync(join(tmpdir(), "brain-os-test-"));
process.env.BRAIN_DIR = tmpBrain;
delete process.env.BRAIN_EMBEDDINGS;

for (const sub of ["entities", "decisions", "patterns", "sessions", "pulses"]) {
  mkdirSync(join(tmpBrain, sub), { recursive: true });
}

const { logDecision } = await import("../dist/tools/decision-log.js");
const { checkDecision } = await import("../dist/tools/decision-check.js");
const { setPlan, advancePlan } = await import("../dist/tools/plan-update.js");
const { refreshDecision } = await import("../dist/tools/decision-refresh.js");
const { writeJsonFile } = await import("../dist/utils/file-store.js");

async function seedEntity(id, name) {
  await writeJsonFile(join(tmpBrain, "entities", `${id}.json`), {
    id,
    name,
    type: "product",
    status: "test",
    mode: "active",
    momentum: "medium",
    priority: "medium",
    blocked: null,
    next_move: "",
    last_decision: null,
    evidence_of_progress: null,
    open_questions: [],
    related_entities: [],
    plan: [],
    metadata: {},
    created_at: "2026-05-21",
    last_updated: "2026-05-21",
  });
}

process.on("exit", () => {
  rmSync(tmpBrain, { recursive: true, force: true });
});

test("decision_log: does NOT auto-supersede on type collision", async () => {
  await seedEntity("ent-typecollision", "Type Collision Test");

  const dec1 = await logDecision({
    entity_id: "ent-typecollision",
    decision: "Use Postgres for user data",
    type: "architecture",
    why: "Relational schema fits user model",
    proof_action: "Provision postgres instance",
    review_date: "2026-12-31",
  });

  const dec2 = await logDecision({
    entity_id: "ent-typecollision",
    decision: "Use Redis for session cache",
    type: "architecture",
    why: "Unrelated topic — caching layer",
    proof_action: "Add redis client",
    review_date: "2026-12-31",
  });

  assert.equal(dec2.superseded.length, 0, "type collision should not cause supersession");
  assert.equal(dec1.logged.status, "active", "dec1 should remain active");
});

test("decision_log: explicit supersedes marks only specified IDs", async () => {
  await seedEntity("ent-supersede", "Explicit Supersede Test");

  const dec1 = await logDecision({
    entity_id: "ent-supersede",
    decision: "Use REST API",
    type: "architecture",
    why: "Simple",
    proof_action: "Build endpoints",
    review_date: "2026-12-31",
  });

  const dec2 = await logDecision({
    entity_id: "ent-supersede",
    decision: "Switch to GraphQL",
    type: "architecture",
    why: "Better typing",
    proof_action: "Migrate endpoints",
    review_date: "2026-12-31",
    supersedes: [dec1.logged.id],
  });

  assert.deepEqual(dec2.superseded, [dec1.logged.id], "should supersede exactly the specified ID");
});

test("decision_log: rejects supersedes target from different entity", async () => {
  await seedEntity("ent-a", "Entity A");
  await seedEntity("ent-b", "Entity B");

  const decA = await logDecision({
    entity_id: "ent-a",
    decision: "Decision on A",
    why: "test",
    proof_action: "test",
    review_date: "2026-12-31",
  });

  await assert.rejects(
    logDecision({
      entity_id: "ent-b",
      decision: "Try to supersede A's decision from B",
      why: "test",
      proof_action: "test",
      review_date: "2026-12-31",
      supersedes: [decA.logged.id],
    }),
    /belongs to entity/,
    "should reject cross-entity supersession"
  );
});

test("decision_refresh: clears superseded_by when transitioning away from superseded", async () => {
  await seedEntity("ent-refresh", "Refresh Test");

  const dec1 = await logDecision({
    entity_id: "ent-refresh",
    decision: "First call",
    why: "test",
    proof_action: "test",
    review_date: "2026-12-31",
  });

  await logDecision({
    entity_id: "ent-refresh",
    decision: "Second call",
    why: "test",
    proof_action: "test",
    review_date: "2026-12-31",
    supersedes: [dec1.logged.id],
  });

  const refreshed = await refreshDecision({
    decision_id: dec1.logged.id,
    status: "active",
  });

  assert.equal(refreshed.decision.status, "active");
  assert.equal(refreshed.decision.superseded_by, null, "superseded_by should be cleared on reactivation");
});

test("plan_advance: completing non-active step does NOT promote when active step exists", async () => {
  await seedEntity("ent-plan", "Plan Test");

  await setPlan({
    entity_id: "ent-plan",
    steps: ["step one", "step two", "step three", "step four"],
  });

  await advancePlan({
    entity_id: "ent-plan",
    step_id: "step-001",
    action: "complete",
    evidence: "done",
  });

  const result = await advancePlan({
    entity_id: "ent-plan",
    step_id: "step-003",
    action: "complete",
    evidence: "done",
  });

  assert.equal(result.promoted_step, null, "should not promote when active step (step-002) already exists");
});

test("decision_check: keyword-only flag stays caution without embeddings (no false conflict)", async () => {
  await seedEntity("ent-check", "Check Test");

  await logDecision({
    entity_id: "ent-check",
    decision: "Use Postgres database",
    why: "Relational schema fits",
    alternatives: [{ option: "MongoDB", rejected_because: "No transactions" }],
    chosen_direction: "Install Postgres",
    proof_action: "Connect from app",
    review_date: "2026-12-31",
  });

  const result = await checkDecision({
    proposed_action: "let's add MongoDB integration",
    entity_id: "ent-check",
  });

  assert.notEqual(
    result.status,
    "conflict",
    "keyword-only signal should not force STOP without semantic confirmation"
  );
});

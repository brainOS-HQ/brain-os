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
const { updateEntity } = await import("../dist/tools/entity-update.js");
const { getFocus } = await import("../dist/tools/focus-get.js");
const { readAuditLog } = await import("../dist/tools/audit-read.js");
const { semanticRecall, EmbeddingsNotConfiguredError } = await import("../dist/utils/embeddings.js");
const { calculateStaleness, today } = await import("../dist/utils/staleness.js");
const { writeJsonFile, readJsonFile, assertSafeId } = await import("../dist/utils/file-store.js");
const { appendFile, writeFile } = await import("node:fs/promises");

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

test("entity_update: applies field changes and records diff", async () => {
  await seedEntity("ent-update", "Update Test");

  const result = await updateEntity("ent-update", {
    momentum: "high",
    next_move: "Ship the thing",
    blocked: "Waiting on review",
  });

  assert.equal(result.entity.momentum, "high");
  assert.equal(result.entity.next_move, "Ship the thing");
  assert.equal(result.entity.blocked, "Waiting on review");
  assert.ok(result.changes.length >= 3, "should record at least one change per field");
});

test("entity_update: throws when entity does not exist", async () => {
  await assert.rejects(
    updateEntity("ent-does-not-exist", { momentum: "high" }),
    /not found/,
    "should reject updates to missing entity"
  );
});

test("entity_update: requires mode_reason when parking/incubating", async () => {
  await seedEntity("ent-park", "Park Test");

  await assert.rejects(
    updateEntity("ent-park", { mode: "parked" }),
    /mode_reason is required/,
    "should require mode_reason when parking"
  );
});

test("semantic_recall: throws EmbeddingsNotConfiguredError when BRAIN_EMBEDDINGS is not set", async () => {
  await assert.rejects(
    semanticRecall("any query"),
    (err) => err instanceof EmbeddingsNotConfiguredError,
    "should throw EmbeddingsNotConfiguredError, not a generic Error"
  );
});

// v0.5.0 regression — substring false positive in extractNegationConflicts.
// Old code: proposed.includes("add") matched inside "address" → false directional caution.
test("decision_check: word-boundary regex prevents substring false positive (e.g. 'add' inside 'address')", async () => {
  await seedEntity("ent-wordboundary", "Word Boundary Test");

  await logDecision({
    entity_id: "ent-wordboundary",
    decision: "Remove the legacy API",
    why: "deprecation cleanup",
    proof_action: "delete endpoints",
    review_date: "2026-12-31",
  });

  const result = await checkDecision({
    proposed_action: "address the customer feedback survey",
    entity_id: "ent-wordboundary",
  });

  // 'add' must not match inside 'address'; with old .includes() this fired a
  // directional conflict (add/remove pair) and surfaced as a caution.
  assert.equal(
    result.status,
    "clear",
    "substring 'add' inside 'address' should not trigger directional conflict"
  );
});

// v0.5.0 regression — decision_check response shape stays stable when embeddings
// are unset. No embeddings_error field should appear (only for real provider crashes).
test("decision_check: does not surface embeddings_error when BRAIN_EMBEDDINGS is simply unset", async () => {
  await seedEntity("ent-noerror", "No Error Field Test");
  await logDecision({
    entity_id: "ent-noerror",
    decision: "Use SQLite",
    why: "local-first",
    proof_action: "test",
    review_date: "2026-12-31",
  });

  const result = await checkDecision({
    proposed_action: "ship a new feature",
    entity_id: "ent-noerror",
  });

  assert.equal(
    result.embeddings_error,
    undefined,
    "unset BRAIN_EMBEDDINGS is soft and must not populate embeddings_error"
  );
});

// v0.5.0 regression — staleness should never render negative days for
// future-dated entities (timezone edges, placeholder paste-ins).
test("calculateStaleness: future-dated entity clamps to 0 days, not negative", async () => {
  const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const result = calculateStaleness(futureDate);
  assert.ok(result.days >= 0, `days should be clamped at 0, got ${result.days}`);
  assert.equal(result.level, "fresh");
  assert.ok(!result.label.includes("-"), `label should not contain negative number: ${result.label}`);
});

// v0.5.0 regression — today() must return the host's LOCAL date, not UTC.
// Build the expected local date string from raw Date components so this test
// would fail if today() returned UTC and the test runner is far from UTC.
// (Earlier version of this test seeded with today() itself, so both sides
// drifted together and the bug stayed invisible.)
test("today(): returns host-local YYYY-MM-DD, not UTC date", () => {
  const d = new Date();
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(today(), expected, "today() must use host-local date components");
});

// v0.5.0 regression — focus_get overdue check compares YYYY-MM-DD strings
// against the local date. A decision dated today (host-local) must read as
// overdue regardless of timezone offset from UTC.
test("focus_get: decision with review_date == today (host-local) is flagged overdue", async () => {
  await seedEntity("ent-tz-today", "Timezone Today Test");
  const d = new Date();
  const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await logDecision({
    entity_id: "ent-tz-today",
    decision: "TZ test decision",
    why: "test",
    proof_action: "test",
    review_date: localToday,
  });

  const result = await getFocus(undefined, 10);
  const flagged = result.unreviewed_decisions.some(
    (d) => d.entity_id === "ent-tz-today" && d.review_date === localToday
  );
  assert.ok(flagged, `decision dated host-local today (${localToday}) should be flagged as unreviewed/overdue`);
});

// v0.5.0 regression — decision dated TOMORROW (host-local) must NOT be flagged
// as overdue. This is the other half of the timezone safety contract.
test("focus_get: decision with review_date == tomorrow (host-local) is NOT flagged overdue", async () => {
  await seedEntity("ent-tz-tomorrow", "Timezone Tomorrow Test");
  const t = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  await logDecision({
    entity_id: "ent-tz-tomorrow",
    decision: "TZ tomorrow decision",
    why: "test",
    proof_action: "test",
    review_date: tomorrow,
  });

  const result = await getFocus(undefined, 10);
  const flagged = result.unreviewed_decisions.some((d) => d.entity_id === "ent-tz-tomorrow");
  assert.ok(!flagged, `decision dated host-local tomorrow (${tomorrow}) must not be flagged overdue`);
});

// v0.5.0 SECURITY — path traversal via crafted entity_id must be rejected.
// Without assertSafeId, "../../etc/foo" resolves to /etc/foo.json and lets
// entity_update / entity_read clobber or exfiltrate files outside .brain/.
test("assertSafeId: rejects path traversal in entity_id", async () => {
  await assert.rejects(
    updateEntity("../../../etc/passwd", { momentum: "high" }),
    /Invalid entity_id|path traversal/i,
    "entity_id with ../ must be rejected"
  );
  await assert.rejects(
    updateEntity("foo/bar", { momentum: "high" }),
    /Invalid entity_id|path traversal/i,
    "entity_id with / must be rejected"
  );
  await assert.rejects(
    updateEntity(".hidden", { momentum: "high" }),
    /Invalid entity_id|path traversal/i,
    "entity_id starting with . must be rejected"
  );
  await assert.rejects(
    updateEntity("a b", { momentum: "high" }),
    /Invalid entity_id|path traversal/i,
    "entity_id with null byte must be rejected"
  );
});

test("assertSafeId: rejects path traversal in decision_id", async () => {
  await assert.rejects(
    refreshDecision({ decision_id: "../../etc/foo", status: "active" }),
    /Invalid decision_id|path traversal/i,
    "decision_id with ../ must be rejected"
  );
});

test("assertSafeId: rejects path traversal in step_id", async () => {
  await seedEntity("ent-step-traversal", "Step Traversal Test");
  await setPlan({ entity_id: "ent-step-traversal", steps: ["only step"] });
  await assert.rejects(
    advancePlan({
      entity_id: "ent-step-traversal",
      step_id: "../../escape",
      action: "complete",
      evidence: "done",
    }),
    /Invalid step_id|path traversal/i,
    "step_id with ../ must be rejected"
  );
});

test("assertSafeId: accepts normal kebab-case ids", () => {
  // Should not throw on legitimate inputs.
  assertSafeId("tasha-brain", "entity_id");
  assertSafeId("dec-001", "decision_id");
  assertSafeId("step-042", "step_id");
  assertSafeId("under_score_ok", "entity_id");
});

// v0.5.0 — audit_log must survive malformed JSONL lines, not crash.
// Concurrent appendFile from multiple MCP clients can produce broken lines
// when individual writes exceed PIPE_BUF (~4 KB).
test("audit_log: skips malformed JSONL lines and reports count", async () => {
  const auditPath = join(tmpBrain, "audit.jsonl");
  // Seed with one good line, one broken line, one good line
  await writeFile(
    auditPath,
    `{"timestamp":"2026-05-23T10:00:00Z","tool":"test","entity_id":null,"action":"a","summary":"good 1","before":null,"after":null,"session_id":"s1"}\n` +
    `{"timestamp":"2026-05-23T10:00:01Z","tool":"test","entity_id":nu` + // truncated, invalid JSON
    `\n` +
    `{"timestamp":"2026-05-23T10:00:02Z","tool":"test","entity_id":null,"action":"a","summary":"good 2","before":null,"after":null,"session_id":"s1"}\n`,
    "utf-8"
  );

  const result = await readAuditLog({ last_n: 100 });
  assert.equal(result.malformed_lines, 1, "should report one malformed line");
  assert.equal(result.total, 2, "should parse the two good lines");
  assert.ok(result.entries.some((e) => e.summary === "good 1"));
  assert.ok(result.entries.some((e) => e.summary === "good 2"));
});

// v0.5.0 — decision_log must generate unique ids. Tested sequentially (the
// realistic single-MCP-client case). 20 back-to-back calls must each get a
// distinct id AND all must persist to disk.
//
// NOTE: across multiple PROCESSES (e.g. Claude Code in one window + Cursor
// in another) the load-modify-save race on decisions.json can still drop
// writes — that is the deferred v0.5.1 optimistic-locking work. Within a
// single MCP server process, sequential calls are safe.
test("decision_log: 20 sequential calls produce 20 unique ids, all persisted", async () => {
  await seedEntity("ent-id-race", "ID Race Test");
  const ids = [];
  for (let i = 0; i < 20; i++) {
    const r = await logDecision({
      entity_id: "ent-id-race",
      decision: `sequential decision ${i}`,
      why: "race test",
      proof_action: "test",
      review_date: "2026-12-31",
    });
    ids.push(r.logged.id);
  }
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, `all ${ids.length} ids must be unique; duplicates: ${ids.join(", ")}`);

  // Verify all 20 actually landed in decisions.json
  const persisted = await readJsonFile(join(tmpBrain, "decisions", "decisions.json"));
  const persistedForEntity = persisted.filter((d) => d.entity_id === "ent-id-race");
  assert.equal(persistedForEntity.length, 20, "all 20 sequential writes must persist");
});

// v0.5.0 — writeJsonFile uses temp + rename. Verify by checking that a
// write to a path with a non-existent directory throws cleanly (and doesn't
// leave a leftover .tmp file in cwd as evidence of broken cleanup).
test("writeJsonFile: atomic write succeeds for entity update + survives load", async () => {
  await seedEntity("ent-atomic", "Atomic Write Test");
  await updateEntity("ent-atomic", { next_move: "step one" });
  await updateEntity("ent-atomic", { next_move: "step two" });
  await updateEntity("ent-atomic", { next_move: "step three" });
  const entity = await readJsonFile(join(tmpBrain, "entities", "ent-atomic.json"));
  assert.equal(entity.next_move, "step three", "final state should be the last write");
  // Confirm no .tmp- leftover for this entity
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(join(tmpBrain, "entities"));
  const leftovers = files.filter((f) => f.startsWith("ent-atomic.json.tmp-"));
  assert.equal(leftovers.length, 0, `no .tmp leftover; found: ${leftovers.join(", ")}`);
});

// v0.5.0 — focus_get suppress_default_guidance opt-out works.
test("focus_get: suppress_default_guidance omits the built-in 'Do not …' lines", async () => {
  await seedEntity("ent-suppress", "Suppress Defaults Test");

  const withDefaults = await getFocus(undefined, 10);
  const withoutDefaults = await getFocus(undefined, 10, { suppress_default_guidance: true });

  const defaultLine = "Do not reorganize files or restructure projects";
  assert.ok(withDefaults.do_not_do.includes(defaultLine), "default behavior includes hardcoded line");
  assert.ok(
    !withoutDefaults.do_not_do.includes(defaultLine),
    "suppress_default_guidance must omit the hardcoded line"
  );
});

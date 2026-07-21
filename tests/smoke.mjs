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

const { logDecision: _logDecision } = await import("../dist/tools/decision-log.js");
const { checkDecision: _checkDecision } = await import("../dist/tools/decision-check.js");
const { setPlan: _setPlan, advancePlan: _advancePlan } = await import("../dist/tools/plan-update.js");
const { refreshDecision: _refreshDecision } = await import("../dist/tools/decision-refresh.js");
const { updateEntity: _updateEntity } = await import("../dist/tools/entity-update.js");
const { getFocus: _getFocus } = await import("../dist/tools/focus-get.js");
const { resolveContext: _resolveContext } = await import("../dist/tools/context-resolve.js");
const { scanProjectEvidence } = await import("../dist/tools/project-evidence-scan.js");
const { checkMemory: _checkMemory } = await import("../dist/tools/memory-check.js");
const { reviewDecisions: _reviewDecisions } = await import("../dist/tools/decision-review.js");
const { readAuditLog: _readAuditLog } = await import("../dist/tools/audit-read.js");
const { createLocalJsonAdapter } = await import("../dist/storage/local-json.js");

// Single shared adapter for all tests
const ctx = { storage: createLocalJsonAdapter() };

// Context-bound wrappers — preserve old call signatures so test bodies need no changes
const logDecision      = (args) => _logDecision(args, ctx);
const checkDecision    = (args) => _checkDecision(args, ctx);
const refreshDecision  = (args) => _refreshDecision(args, ctx);
const setPlan          = (args) => _setPlan(args, ctx);
const advancePlan      = (args) => _advancePlan(args, ctx);
const updateEntity     = (id, updates) => _updateEntity(id, updates, ctx);
const getFocus         = (constraints, maxResults, options) => _getFocus(ctx, constraints, maxResults, options);
const resolveContext   = (args) => _resolveContext(args, ctx);
const checkMemory      = (entityId) => _checkMemory(ctx, entityId);
const reviewDecisions  = (args) => _reviewDecisions(args, ctx);
const readAuditLog     = (options) => _readAuditLog(ctx, options);
const { semanticRecall, EmbeddingsNotConfiguredError } = await import("../dist/utils/embeddings.js");
const { calculateStaleness, today } = await import("../dist/utils/staleness.js");
const { writeJsonFile, readJsonFile, assertSafeId } = await import("../dist/utils/file-store.js");
const { appendFile, writeFile } = await import("node:fs/promises");

async function seedEntity(id, name, overrides = {}) {
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
    ...overrides,
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

test("entity_update: creates entity via upsert when it does not exist", async () => {
  const result = await updateEntity("ent-upsert-new", { name: "Upsert Test", momentum: "high" });
  assert.equal(result.entity.id, "ent-upsert-new");
  assert.equal(result.entity.name, "Upsert Test");
  assert.equal(result.entity.momentum, "high");
  assert.equal(result.entity.mode, "active", "new entity defaults to active mode");
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
  assertSafeId("my-project", "entity_id");
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

// v0.5.3 regression — explicit project scope must stay strict. Related
// entities are useful for graph/global views, but leaking them into scoped
// focus makes agents answer about projects the user did not ask about.
test("focus_get: explicit entity_id returns only the scoped entity, not related entities", async () => {
  await seedEntity("ent-focus-main", "Focus Main", {
    priority: "critical",
    related_entities: ["ent-focus-related"],
  });
  await seedEntity("ent-focus-related", "Focus Related", {
    priority: "critical",
    momentum: "high",
  });

  const result = await getFocus(undefined, 10, { entity_id: "ent-focus-main" });

  assert.equal(result.scope, "Focus Main");
  assert.deepEqual(
    result.priorities.map((item) => item.entity_id),
    ["ent-focus-main"],
    "scoped focus should not include related entities"
  );
});

// ──────────────────────────────────────────────────────────────────────────
// context_resolve v1 — deterministic context router.
// NOTE: this suite shares one tmpBrain across all tests, so the entity set is
// large by now. Context tests use deliberately unique tokens to avoid
// cross-test mention/lexical collisions.
// ──────────────────────────────────────────────────────────────────────────

test("context_resolve: explicit_entity_id is authoritative (confidence 1.0)", async () => {
  await seedEntity("ctx-explicit", "Ctx Explicit Target");
  const r = await resolveContext({ explicit_entity_id: "ctx-explicit", user_message: "do whatever" });
  assert.equal(r.entity_id, "ctx-explicit");
  assert.equal(r.confidence, 1.0);
  assert.equal(r.signal, "explicit_entity_id");
  assert.equal(r.ask_user, false);
});

test("context_resolve: named mention resolves at 0.95, proceed silently", async () => {
  await seedEntity("ctx-zephyr", "Zephyr Quokka Platform");
  const r = await resolveContext({ user_message: "rewrite the Zephyr Quokka Platform landing page" });
  assert.equal(r.entity_id, "ctx-zephyr");
  assert.equal(r.confidence, 0.95);
  assert.equal(r.signal, "user_mention");
  assert.equal(r.ask_user, false);
});

test("context_resolve: named mention requires token boundaries, not substrings", async () => {
  await seedEntity("ctx-ghost", "Ghost");
  const r = await resolveContext({ user_message: "fix the ghostwriter onboarding copy" });
  assert.notEqual(r.signal, "user_mention", "substring match must not count as explicit mention");
  assert.notEqual(r.entity_id, "ctx-ghost", "ghostwriter must not resolve to Ghost at 0.95");
});

test("context_resolve: alias match resolves the entity", async () => {
  await seedEntity("ctx-vermillion", "Internal Billing Reconciler", { aliases: ["vermillion"] });
  const r = await resolveContext({ user_message: "let's debug vermillion's webhook" });
  assert.equal(r.entity_id, "ctx-vermillion");
  assert.equal(r.signal, "user_mention");
});

test("context_resolve: more specific alias disambiguates shared display names", async () => {
  await seedEntity("ctx-acme-voice", "Ctx Acme", { aliases: ["ctx acme app", "ctx acme voice"] });
  await seedEntity("ctx-acme-life", "Ctx Acme", { aliases: ["ctx acme life", "ctx acme hackathon"] });

  const app = await resolveContext({ user_message: "work on ctx acme app" });
  assert.equal(app.entity_id, "ctx-acme-voice", "specific app alias should beat the shared display name");
  assert.equal(app.signal, "user_mention");

  const hackathon = await resolveContext({ user_message: "work on ctx acme hackathon" });
  assert.equal(hackathon.entity_id, "ctx-acme-life", "specific hackathon alias should beat the shared display name");
  assert.equal(hackathon.signal, "user_mention");

  const bare = await resolveContext({ user_message: "work on Ctx Acme" });
  assert.equal(bare.entity_id, null, "bare shared display name should still ask");
  assert.equal(bare.signal, "user_mention_ambiguous");
  assert.equal(bare.ask_user, true);
});

test("context_resolve: explicit mention OVERRIDES files in another repo", async () => {
  await seedEntity("ctx-landingproj", "Ctx Landing Proj");
  await seedEntity("ctx-otherrepo", "Ctx Other Repo");
  const r = await resolveContext({
    user_message: "rewrite Ctx Landing Proj positioning copy",
    files_touched: ["/Users/x/code/ctx-otherrepo/src/server.ts"],
  });
  assert.equal(r.entity_id, "ctx-landingproj", "mention must win over file location");
  assert.equal(r.signal, "user_mention");
  assert.ok(
    r.evidence.some((e) => e.includes("ctx-otherrepo") && /priority/i.test(e)),
    "should record that files pointed elsewhere but mention took priority"
  );
});

test("context_resolve: generic focus request can still use weak file context", async () => {
  await seedEntity("ctx-folderfocus", "Ctx Folder Focus");
  const r = await resolveContext({
    user_message: "what should I focus on today?",
    files_touched: ["/Users/x/code/ctx-folderfocus"],
  });
  assert.equal(r.entity_id, "ctx-folderfocus");
  assert.equal(r.signal, "files_touched");
  assert.equal(r.ask_user, false);
});

test("context_resolve: ambiguous mention asks instead of guessing", async () => {
  await seedEntity("ctx-mango-alpha", "Mango Alpha Service");
  await seedEntity("ctx-mango-beta", "Mango Beta Service");
  const r = await resolveContext({ user_message: "compare Mango Alpha Service and Mango Beta Service" });
  assert.equal(r.entity_id, null, "ambiguous strong-tier match must not resolve to a guess");
  assert.equal(r.ask_user, true);
  assert.ok(r.confidence < 0.5);
  assert.ok(r.candidates.length >= 2, "should list the competing candidates");
});

test("context_resolve: files_touched resolves at 0.6 when no mention", async () => {
  await seedEntity("ctx-filesonly", "Ctx Files Only");
  const r = await resolveContext({ files_touched: ["/repo/ctx-filesonly/index.ts"] });
  assert.equal(r.entity_id, "ctx-filesonly");
  assert.equal(r.confidence, 0.6);
  assert.equal(r.signal, "files_touched");
  assert.equal(r.ask_user, false);
});

test("context_resolve: no usable signal → ask_user, no guess", async () => {
  const r = await resolveContext({ user_message: "xyzzy plugh frobnicate snorgle" });
  assert.equal(r.entity_id, null);
  assert.equal(r.ask_user, true);
  assert.equal(r.confidence, 0);
});

test("entity_update: can write aliases, and context_resolve then matches them", async () => {
  // Seeded with no aliases — write them through the tool, not the JSON file.
  await seedEntity("ctx-quartz", "Quartz Ledger Service");

  // Before: the folder slug "quartz-svc" does not resolve to the entity.
  const before = await resolveContext({ files_touched: ["/repo/quartz-svc/index.ts"] });
  assert.notEqual(before.entity_id, "ctx-quartz", "slug should not match before aliases are written");

  // Write aliases through entity_update (the gap being closed).
  const result = await updateEntity("ctx-quartz", { aliases: ["quartz-svc", "quartz"] });
  assert.deepEqual(result.entity.aliases, ["quartz-svc", "quartz"], "aliases must persist on the entity");
  assert.ok(
    result.changes.some((c) => c.startsWith("aliases:")),
    "aliases change must be recorded in the audit changes"
  );

  // Persisted to disk.
  const onDisk = await readJsonFile(join(tmpBrain, "entities", "ctx-quartz.json"));
  assert.deepEqual(onDisk.aliases, ["quartz-svc", "quartz"]);

  // After: spoken alias resolves at 0.95, and the folder slug now resolves via files.
  const spoken = await resolveContext({ user_message: "what's blocking quartz right now" });
  assert.equal(spoken.entity_id, "ctx-quartz");
  assert.equal(spoken.signal, "user_mention");

  const byFiles = await resolveContext({ files_touched: ["/repo/quartz-svc/index.ts"] });
  assert.equal(byFiles.entity_id, "ctx-quartz", "written slug alias must now match files_touched");
});

test("project_evidence_scan: extracts next move, human gate, dirty file; mutates nothing", async () => {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, readdirSync } = await import("node:fs");
  const repo = mkdtempSync(join(tmpdir(), "brain-evscan-"));

  writeFileSync(
    join(repo, "STATE.md"),
    "# State\n\nEXACT NEXT MOVE: run /gsd:plan-phase 4.2\nProgress: tasks 1+2 complete.\n",
  );
  writeFileSync(
    join(repo, "HANDOFF_2024-01-15.md"),
    "# Handoff\n\nPhase 7-01 Task 3 is a HUMAN GATE — review the data set.\n" +
      "DO NOT TOUCH shared-core.js from two sessions.\n" +
      "4.2 and 4.1 can run in parallel with Phase 7.\n",
  );

  // Snapshot the ambient repo HEAD (the repo this test process runs inside, or an
  // ambient GIT_DIR). A fixture git op must NEVER touch it — see 2026-07-20.
  const ambientHead = () => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const parentHeadBefore = ambientHead();

  // git repo with one commit + an untracked (dirty) file. Strip inherited GIT_*
  // location vars so -C <repo> is authoritative and the fixture commit cannot leak
  // into the ambient repo (an ambient GIT_DIR would otherwise override -C).
  const gitEnv = { ...process.env };
  delete gitEnv.GIT_DIR;
  delete gitEnv.GIT_WORK_TREE;
  delete gitEnv.GIT_INDEX_FILE;
  const g = (...args) =>
    execFileSync("git", ["-C", repo, "-c", "user.email=t@t.t", "-c", "user.name=test", ...args], {
      stdio: ["ignore", "pipe", "ignore"],
      env: gitEnv,
    });
  g("init", "-q");
  g("add", "STATE.md", "HANDOFF_2024-01-15.md");
  g("commit", "-q", "-m", "seed operating state");
  writeFileSync(join(repo, "scratch.txt"), "uncommitted work\n");

  const repoBefore = readdirSync(repo).sort().join(",");
  const brainBefore = readdirSync(join(tmpBrain, "entities")).length;

  const r = scanProjectEvidence({ root_path: repo, entity_id: "demo" });

  assert.equal(r.entity_id, "demo");
  assert.ok(r.detected_next_moves.some((l) => l.includes("4.2")), "should extract the EXACT NEXT MOVE line");
  assert.ok(r.detected_human_gates.some((l) => /human gate/i.test(l)), "should extract the HUMAN GATE line");
  assert.ok(r.do_not_touch.some((l) => l.includes("shared-core.js")), "should extract DO NOT TOUCH");
  assert.ok(r.safe_parallel_work.some((l) => /parallel/i.test(l)), "should extract the parallel-work line");
  assert.ok(r.dirty_files.some((f) => f.includes("scratch.txt")), "should report the dirty file");
  assert.ok(r.recent_git_activity.length >= 1, "should report recent commits");
  assert.ok(r.current_state_files.includes("STATE.md"), "STATE.md should be listed");
  assert.ok(
    r.evidence_used.includes("STATE.md") && r.evidence_used.some((e) => e.startsWith("git log")),
    "evidence_used should cite both files and git",
  );
  assert.equal(r.warnings.length, 0, "clean repo with evidence should produce no warnings");

  // No mutation: repo top-level files and Brain OS entities are unchanged.
  assert.equal(readdirSync(repo).sort().join(","), repoBefore, "scan must not add/remove repo files");
  assert.equal(readdirSync(join(tmpBrain, "entities")).length, brainBefore, "scan must not write Brain OS state");

  // Leak guard (2026-07-20): neither the fixture nor the scan may commit to the
  // repo this test runs inside — even under an ambient GIT_DIR.
  assert.equal(ambientHead(), parentHeadBefore, "evidence-scan test must not mutate the ambient/parent repo HEAD");

  rmSync(repo, { recursive: true, force: true });
});

test("project_evidence_scan: empty dir → warning, empty arrays, no crash", async () => {
  const empty = mkdtempSync(join(tmpdir(), "brain-evscan-empty-"));
  const r = scanProjectEvidence({ root_path: empty });
  assert.equal(r.current_state_files.length, 0);
  assert.equal(r.detected_next_moves.length, 0);
  assert.equal(r.recent_git_activity.length, 0);
  assert.ok(r.warnings.length >= 1, "should warn when no evidence files and no git history exist");
  rmSync(empty, { recursive: true, force: true });
});

test("decision_review: duplicate stub → archive, pointing at canonical (canonical not surfaced)", async () => {
  await seedEntity("dr-dup", "DR Dup Test", { priority: "high" });
  const canonical = await logDecision({
    entity_id: "dr-dup",
    decision: "Human approval required before all sends in v1",
    why: "Trust positioning",
    alternatives: [{ option: "auto-send", rejected_because: "trust risk" }],
    proof_action: "Draft generation works and never auto-sends",
    review_date: "2026-12-31", // future → canonical, not overdue
  });
  // Stubs can no longer be created via logDecision (validateProofAction rejects placeholders).
  // Write the stub directly to decisions.json to simulate legacy/pre-v0.8.0 data.
  const decisionsPath = join(tmpBrain, "decisions", "decisions.json");
  const existing = await readJsonFile(decisionsPath) ?? [];
  const stubId = `dec-stub-test-${Date.now()}`;
  const stubDate = today();
  const stub = {
    id: stubId,
    date: stubDate,
    entity_id: "dr-dup",
    decision: "Human approval required before all sends in v1",
    why: "duplicate logging noise",
    proof_action: "Review in next session",
    review_date: stubDate, // self-dated (date == review_date == today)
    status: "active",
    superseded_by: null,
  };
  await writeFile(decisionsPath, JSON.stringify([...existing, stub]));
  const stubResult = { logged: stub };

  const r = await reviewDecisions({ entity_id: "dr-dup" });
  assert.equal(r.groups.archive.length, 1, "only the stub should be archive-bucketed");
  const item = r.groups.archive[0];
  assert.equal(item.decision_id, stubResult.logged.id);
  assert.equal(item.duplicate_of, canonical.logged.id, "should point at the canonical decision");
  assert.ok(item.confidence >= 0.9, "duplicate-stub detection is high confidence");
  const allShown = Object.values(r.groups).flat();
  assert.ok(!allShown.some((i) => i.decision_id === canonical.logged.id), "future-dated canonical must not appear as review debt");
});

test("decision_review: overdue decision with no evidence → needs_evidence", async () => {
  await seedEntity("dr-noev", "DR NoEvidence");
  const dec = await logDecision({
    entity_id: "dr-noev",
    decision: "Target support teams under 20 people",
    why: "ICP focus",
    proof_action: "Interview 5 support teams",
    review_date: "2026-01-01", // overdue
  });
  const r = await reviewDecisions({ entity_id: "dr-noev" });
  assert.equal(r.groups.needs_evidence.length, 1);
  assert.equal(r.groups.needs_evidence[0].decision_id, dec.logged.id);
  assert.equal(r.groups.archive.length, 0);
});

test("decision_review: overdue decision with evidence → still_true; mutates nothing", async () => {
  await seedEntity("dr-still", "DR StillTrue");
  const dec = await logDecision({
    entity_id: "dr-still",
    decision: "Gmail first — v1 targets Google Workspace only",
    why: "ship focus",
    proof_action: "Gmail OAuth works",
    review_date: "2026-01-01", // overdue
  });
  await refreshDecision({ decision_id: dec.logged.id, add_evidence: "Gmail OAuth integration shipped" });

  const decisionsPath = join(tmpBrain, "decisions", "decisions.json");
  const before = JSON.stringify(await readJsonFile(decisionsPath));

  const r = await reviewDecisions({ entity_id: "dr-still" });
  assert.equal(r.groups.still_true.length, 1);
  assert.equal(r.groups.still_true[0].decision_id, dec.logged.id);
  assert.ok(r.groups.still_true[0].evidence_count >= 1, "should report the appended evidence");

  const after = JSON.stringify(await readJsonFile(decisionsPath));
  assert.equal(after, before, "decision_review must not mutate decisions.json");
});

test("decision_log: persists assumptions + invalidate_if", async () => {
  await seedEntity("ent-assume", "Assumptions Test");
  const r = await logDecision({
    entity_id: "ent-assume",
    decision: "Do not auto-send replies in v1",
    why: "Trust is the activation bottleneck",
    assumptions: [
      "Users want human approval before sending",
      "Model reliability is not yet sufficient for autonomous send",
    ],
    invalidate_if: [
      "Users show sustained trust in autonomous drafts",
      "Target workflow shifts from external email to internal triage",
    ],
    proof_action: "Draft generation works and never auto-sends",
    review_date: "2026-12-31",
  });
  assert.deepEqual(r.logged.assumptions, [
    "Users want human approval before sending",
    "Model reliability is not yet sufficient for autonomous send",
  ]);
  assert.equal(r.logged.invalidate_if.length, 2);
});

test("decision_check: action matching invalidate_if → review_triggered (keyword, no embeddings)", async () => {
  await seedEntity("ent-invtrig", "Invalidate Trigger Test");
  const dec = await logDecision({
    entity_id: "ent-invtrig",
    decision: "Keep replies draft-only in v1",
    why: "Trust is the activation bottleneck",
    assumptions: ["Users want human approval before sending"],
    invalidate_if: ["Users show sustained trust in autonomous drafts"],
    proof_action: "Drafts never auto-send",
    review_date: "2026-12-31",
  });
  const r = await checkDecision({
    proposed_action: "Users show sustained trust in autonomous drafts so enable autonomous sending",
    entity_id: "ent-invtrig",
  });
  assert.equal(r.review_triggered.length, 1, "should flag the decision whose invalidate_if condition the action matches");
  assert.equal(r.review_triggered[0].decision_id, dec.logged.id);
  assert.equal(r.status, "caution", "a matched invalidation condition should at least caution");
  assert.ok(r.review_triggered[0].matched_condition.includes("sustained trust"));
  assert.equal(r.review_triggered[0].also_conflicts, false);
  assert.deepEqual(
    r.review_triggered[0].assumptions,
    ["Users want human approval before sending"],
    "trigger should carry the decision's assumptions for the plain-language line",
  );
});

test("decision_check: unrelated action against a decision with invalidate_if → clear, no triggers", async () => {
  await seedEntity("ent-invclear", "Invalidate Clear Test");
  await logDecision({
    entity_id: "ent-invclear",
    decision: "Keep replies draft-only in v1",
    why: "Trust",
    invalidate_if: ["Users show sustained trust in autonomous drafts"],
    proof_action: "Drafts never auto-send",
    review_date: "2026-12-31",
  });
  const r = await checkDecision({
    proposed_action: "Switch the marketing site font to Inter",
    entity_id: "ent-invclear",
  });
  assert.equal(r.review_triggered.length, 0);
  assert.equal(r.status, "clear");
});

test("focus_get: overdue decisions surface as review_debt with a /reconcile hint", async () => {
  await seedEntity("fd-debt", "Focus Debt", { momentum: "high", priority: "high", next_move: "ship it" });
  await logDecision({
    entity_id: "fd-debt",
    decision: "Charge per-seat, not per-org",
    why: "aligns price with value",
    proof_action: "3 customers accept per-seat pricing",
    review_date: "2026-01-01", // overdue
  });
  const r = await getFocus(undefined, 3, { entity_id: "fd-debt" });
  assert.ok(r.review_debt, "review_debt should be present when overdue decisions exist");
  assert.equal(r.review_debt.count, 1);
  assert.ok(r.review_debt.hint.includes("/reconcile"), "hint should point at /reconcile");
});

test("focus_get: no overdue decisions → review_debt is null", async () => {
  await seedEntity("fd-clean", "Focus Clean", { momentum: "high", priority: "high", next_move: "ship it" });
  await logDecision({
    entity_id: "fd-clean",
    decision: "Use Postgres",
    why: "team knows it",
    proof_action: "schema migrated",
    review_date: "2099-01-01", // future
  });
  const r = await getFocus(undefined, 3, { entity_id: "fd-clean" });
  assert.equal(r.review_debt, null);
});

// v0.8.0 — memory_check scope leak. A scoped call must not bleed overdue
// decision reviews from entities the caller did not ask about.
test("memory_check: scoped entity_id does not leak overdue_reviews from other entities", async () => {
  await seedEntity("mc-scope-a", "MC Scope A");
  await seedEntity("mc-scope-b", "MC Scope B");

  await logDecision({
    entity_id: "mc-scope-a",
    decision: "Entity A uses REST",
    why: "simplicity",
    proof_action: "ship endpoints",
    review_date: "2026-01-01", // overdue
  });

  const r = await checkMemory("mc-scope-b");
  assert.equal(
    r.overdue_reviews.filter((d) => d.entity_id === "mc-scope-a").length,
    0,
    "scoped memory_check must not leak overdue_reviews from another entity"
  );
});

// v0.8.0 — decision_check conflict escalation. A semantic-only rejected hit
// (no keyword flag) must return status "conflict" when it clearly dominates
// the chosen-facet match. Without embeddings this path is not reachable, so
// we verify the fall-through contract: keyword hit stays caution when both
// facets exist and chosen ≥ rejected (i.e. no dominant rejected edge).
test("decision_check: keyword-only signal stays caution when embeddings are absent, never 'conflict'", async () => {
  await seedEntity("mc-semconf", "Semantic Conflict Gate Test");

  await logDecision({
    entity_id: "mc-semconf",
    decision: "Use REST API",
    why: "simplicity",
    alternatives: [{ option: "GraphQL", rejected_because: "too complex for v1" }],
    chosen_direction: "Build REST endpoints",
    proof_action: "ship REST layer",
    review_date: "2026-12-31",
  });

  // No embeddings → semantic promotion path is unreachable. The keyword flag
  // on "GraphQL" must stay caution, not escalate to conflict.
  const r = await checkDecision({
    proposed_action: "add GraphQL schema layer",
    entity_id: "mc-semconf",
  });
  assert.notEqual(r.status, "conflict", "keyword-only hit must never escalate to conflict without embeddings");
});

test("decision_review: surfaces assumptions + invalidate_if and prompts to test conditions", async () => {
  await seedEntity("dr-frame", "DR Frame");
  const dec = await logDecision({
    entity_id: "dr-frame",
    decision: "Target support teams under 20 people",
    why: "ICP focus",
    assumptions: ["Small teams feel the pain most"],
    invalidate_if: ["Enterprise inbound exceeds SMB demand"],
    proof_action: "Interview 5 teams",
    review_date: "2026-01-01", // overdue
  });
  const r = await reviewDecisions({ entity_id: "dr-frame" });
  const item = Object.values(r.groups).flat().find((i) => i.decision_id === dec.logged.id);
  assert.ok(item, "decision should surface as review debt");
  assert.deepEqual(item.assumptions, ["Small teams feel the pain most"]);
  assert.deepEqual(item.invalidate_if, ["Enterprise inbound exceeds SMB demand"]);
  assert.ok(r.notes.some((n) => n.includes("invalidate_if")), "should prompt the reviewer to test invalidation conditions");
});

// ── Auto-wrap: wrap_check + wrap_auto (v0.9.0) ──
const { checkWrapStatus } = await import("../dist/tools/wrap-check.js");
const { wrapAuto: _wrapAuto } = await import("../dist/tools/wrap-auto.js");
const { setSessionId } = await import("../dist/utils/audit.js");
const wrapAuto = (input) => _wrapAuto(input, ctx);

test("wrap_check: detects unwrapped activity and resets after a wrap marker", async () => {
  setSessionId("wrapcheck-test");
  const before = await checkWrapStatus(ctx, { session_id: "wrapcheck-test" });
  assert.equal(before.unwrapped_count, 0);
  assert.equal(before.recommend_wrap, false);

  for (let i = 0; i < 5; i++) {
    await updateEntity(`wcheck-ent-${i}`, { name: `WC ${i}`, next_move: "do x" });
  }
  const after = await checkWrapStatus(ctx, { session_id: "wrapcheck-test", threshold: 5 });
  assert.ok(after.unwrapped_count >= 5, `expected >=5, got ${after.unwrapped_count}`);
  assert.equal(after.recommend_wrap, true);

  // a session_wrapped marker (logged by wrap_auto) moves the boundary forward
  await wrapAuto({ entity_id: "wcheck-ent-0", summary: "auto wrap", session_id: "wrapcheck-test", next_move: "next" });
  const reset = await checkWrapStatus(ctx, { session_id: "wrapcheck-test" });
  assert.equal(reset.unwrapped_count, 0, `expected reset to 0, got ${reset.unwrapped_count}`);
});

test("wrap_auto: applies low-risk fields, stages high-risk for review, trusts nothing unseen", async () => {
  await updateEntity("wauto-ent", { name: "WAuto", status: "active", mode: "active" });

  const res = await wrapAuto({
    entity_id: "wauto-ent",
    summary: "did some work",
    next_move: "ship the thing",
    evidence_of_progress: "built Y",
    open_questions: ["is X done?"],
    pending_review: {
      status: "blocked on review",
      mode: "parked",
      mode_reason: "waiting",
      decisions: [{ decision: "use Z", why: "faster" }],
    },
    trigger: "sessionend",
  });

  assert.equal(res.confirmed, false);
  assert.ok(res.applied.length >= 1, "low-risk changes should be applied");
  assert.ok(res.staged.length >= 1, "high-risk items should be staged");
  assert.ok(res.pending_id, "a pending record id should be returned");

  // low-risk applied to the live entity
  const ent = await ctx.storage.getEntity("wauto-ent");
  assert.equal(ent.next_move, "ship the thing");
  assert.ok(ent.evidence_of_progress.includes("built Y"));
  assert.ok(ent.open_questions.some((q) => q.includes("is X done")));

  // high-risk NOT applied — status/mode stay as they were
  assert.equal(ent.mode, "active", "mode must NOT be auto-changed to parked");
  assert.equal(ent.status, "active", "status must NOT be auto-changed");

  // staged record persisted as unconfirmed
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(join(tmpBrain, "sessions", `${res.pending_id}.json`), "utf-8");
  const staged = JSON.parse(raw);
  assert.equal(staged.confirmed, false);
  assert.equal(staged.type, "auto_wrap");
  assert.equal(staged.pending_review.mode, "parked");
  assert.deepEqual(staged.pending_review.decisions, [{ decision: "use Z", why: "faster" }]);
});

test("entity_update: status-only update applies even when the new value is shorter", async () => {
  const longStatus = "Long historical status that should not block a current concise replacement. ".repeat(4);
  await seedEntity("ent-status-shorter", "Status Shorter", { status: longStatus });

  const result = await updateEntity("ent-status-shorter", { status: "current concise status" });
  const entity = await ctx.storage.getEntity("ent-status-shorter");

  assert.equal(entity.status, "current concise status");
  assert.ok(result.changes.some((c) => c.startsWith("status")), "status change should be reported");
});

test("entity_update: guarded ranking downgrade is visible, not silent", async () => {
  await seedEntity("ent-ranking-visible", "Ranking Visible", { momentum: "high" });

  const result = await updateEntity("ent-ranking-visible", { momentum: "low" });
  const entity = await ctx.storage.getEntity("ent-ranking-visible");

  assert.equal(entity.momentum, "high", "downgrade protection should still hold");
  assert.ok(
    result.changes.some((c) => c.includes("momentum") && c.includes("kept")),
    "guarded skip should be visible to the caller",
  );
});

test("store resolution fails closed: no silent .brain/ creation in a storeless cwd", async () => {
  const { execFileSync } = await import("node:child_process");
  const { existsSync } = await import("node:fs");
  const storelessCwd = mkdtempSync(join(tmpdir(), "brain-os-storeless-"));
  const distFileStore = join(process.cwd(), "dist", "utils", "file-store.js");

  const script = `
    const { getBrainDir } = await import(${JSON.stringify(distFileStore)});
    try {
      const dir = getBrainDir();
      console.log("RESOLVED:" + dir);
    } catch (e) {
      console.log("THREW:" + e.name + ":" + e.message);
    }
  `;

  const env = { ...process.env };
  delete env.BRAIN_DIR;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: storelessCwd,
    env,
    encoding: "utf-8",
  }).trim();

  assert.ok(out.startsWith("THREW:BrainStoreNotFoundError:"), `expected fail-closed throw, got: ${out}`);
  assert.ok(out.includes("BRAIN_DIR"));
  assert.ok(out.includes("brain-os init"));
  assert.ok(!existsSync(join(storelessCwd, ".brain")), "no .brain/ may be created implicitly");

  rmSync(storelessCwd, { recursive: true, force: true });
});

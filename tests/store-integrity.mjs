// Store integrity (local MCP review 2026-11-02, F1 + F3).
// F1: an unreadable store file used to read as "empty", and the next write
// replaced it, silently dropping every row. Now reads throw and the file keeps
// its original bytes.
// F3: decision_log(supersedes) reported success but never saved the old
// decision as superseded.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRAIN = mkdtempSync(join(tmpdir(), "brain-integrity-"));
process.env.BRAIN_DIR = BRAIN;
delete process.env.BRAIN_EMBEDDINGS;

const { logDecision } = await import("../dist/tools/decision-log.js");
const { updateEntity } = await import("../dist/tools/entity-update.js");
const { createLocalJsonAdapter } = await import("../dist/storage/local-json.js");
const { readJsonFile, BrainStoreCorruptError } = await import("../dist/utils/file-store.js");
const ctx = { storage: createLocalJsonAdapter() };

const DECISIONS = join(BRAIN, "decisions", "decisions.json");
const entityFile = (id) => join(BRAIN, "entities", `${id}.json`);

function dec(id, entity, extra = {}) {
  return {
    id, date: "2026-10-01", entity_id: entity, type: "strategic",
    decision: `decision ${id}`, why: "x", proof_action: "x", review_date: "2027-01-01",
    status: "active", superseded_by: null, ...extra,
  };
}
const input = (extra = {}) => ({
  entity_id: "proj", type: "strategic", decision: "new direction", why: "because",
  proof_action: "check it in a week", review_date: "2027-02-01", ...extra,
});
const readDecisions = () => JSON.parse(readFileSync(DECISIONS, "utf8"));

beforeEach(() => {
  rmSync(BRAIN, { recursive: true, force: true });
  for (const d of ["decisions", "entities", "sessions", "patterns"]) mkdirSync(join(BRAIN, d), { recursive: true });
});
after(() => rmSync(BRAIN, { recursive: true, force: true }));

// ── F1 ────────────────────────────────────────────────────────────────────────

test("F1: a missing file still reads as null (fresh stores keep working)", async () => {
  assert.equal(await readJsonFile(join(BRAIN, "nope.json")), null);
});

test("F1: truncated decisions.json blocks decision_log and keeps the original bytes", async () => {
  const bytes = JSON.stringify([dec("dec-a", "proj"), dec("dec-b", "proj")]).slice(0, 60);
  writeFileSync(DECISIONS, bytes);
  await assert.rejects(logDecision(input(), ctx), (e) => e instanceof BrainStoreCorruptError && /brain_store_unreadable/.test(e.message));
  assert.equal(readFileSync(DECISIONS, "utf8"), bytes, "file untouched");
});

test("F1: a truncated entity file is not rebuilt with defaults by entity_update", async () => {
  const bytes = `{"id":"proj","name":"Proj","status":"shipping","next_move":"ship it","blo`;
  writeFileSync(entityFile("proj"), bytes);
  await assert.rejects(updateEntity("proj", { next_move: "something else" }, ctx), BrainStoreCorruptError);
  assert.equal(readFileSync(entityFile("proj"), "utf8"), bytes, "file untouched");
});

test("F1: a file containing literal null is treated as unreadable, not empty", async () => {
  writeFileSync(DECISIONS, "null");
  await assert.rejects(logDecision(input(), ctx), BrainStoreCorruptError);
  assert.equal(readFileSync(DECISIONS, "utf8"), "null");
});

test("F1: healthy files still read and write normally", async () => {
  writeFileSync(DECISIONS, JSON.stringify([dec("dec-a", "proj")]));
  await logDecision(input(), ctx);
  assert.equal(readDecisions().length, 2);
});

// ── F3 ────────────────────────────────────────────────────────────────────────

test("F3: supersedes is saved: the old decision is superseded and points to the new one", async () => {
  writeFileSync(DECISIONS, JSON.stringify([dec("dec-old", "proj"), dec("dec-other", "proj")]));
  const r = await logDecision(input({ supersedes: ["dec-old"] }), ctx);
  const onDisk = readDecisions();
  const old = onDisk.find((d) => d.id === "dec-old");
  assert.equal(old.status, "superseded", "persisted, not only reported");
  assert.equal(old.superseded_by, r.logged.id);
  assert.equal(onDisk.find((d) => d.id === "dec-other").status, "active", "untargeted rows unchanged");
  assert.equal(onDisk.find((d) => d.id === r.logged.id).status, "active");
  assert.equal(onDisk.length, 3, "no duplicate rows");
});

test("F3: superseding several decisions saves all of them", async () => {
  writeFileSync(DECISIONS, JSON.stringify([dec("dec-1", "proj"), dec("dec-2", "proj")]));
  const r = await logDecision(input({ supersedes: ["dec-1", "dec-2"] }), ctx);
  for (const id of ["dec-1", "dec-2"]) {
    const d = readDecisions().find((x) => x.id === id);
    assert.equal(d.status, "superseded");
    assert.equal(d.superseded_by, r.logged.id);
  }
});

test("F3: another entity's decision is still refused and nothing is written", async () => {
  writeFileSync(DECISIONS, JSON.stringify([dec("dec-x", "other")]));
  await assert.rejects(logDecision(input({ supersedes: ["dec-x"] }), ctx), /belongs to entity "other"/);
  await assert.rejects(logDecision(input({ supersedes: ["dec-missing"] }), ctx), /decision not found/);
  const onDisk = readDecisions();
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].status, "active");
});

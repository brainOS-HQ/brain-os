import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated synthetic store. No real corpus, no network, no SDK.
const tmpBrain = mkdtempSync(join(tmpdir(), "brain-os-recall-"));
process.env.BRAIN_DIR = tmpBrain;
delete process.env.BRAIN_EMBEDDINGS;
delete process.env.OPENAI_API_KEY;
for (const sub of ["entities", "decisions", "patterns", "sessions", "memories"]) {
  mkdirSync(join(tmpBrain, sub), { recursive: true });
}
process.on("exit", () => rmSync(tmpBrain, { recursive: true, force: true }));

const { recallByMeaning, RESPONSE_BYTE_BUDGET, MAX_RESULTS_CAP } = await import("../dist/tools/semantic-recall.js");
const { createLocalJsonAdapter } = await import("../dist/storage/local-json.js");
const emb = await import("../dist/utils/embeddings.js");
const { rebuildEmbeddingsIndex, planRebuild } = await import("../dist/recall/rebuild.js");
const { reciprocalRankFusion } = await import("../dist/recall/fusion.js");
const { rankLexical } = await import("../dist/recall/lexical.js");
const { writeJsonFile } = await import("../dist/utils/file-store.js");
const { checkDecision } = await import("../dist/tools/decision-check.js");

const ctx = { storage: createLocalJsonAdapter() };
const embeddingsPath = join(tmpBrain, "embeddings.json");
const recall = (input) => recallByMeaning(input, ctx);
const tmpFiles = () => readdirSync(tmpBrain).filter((f) => f.startsWith("embeddings.json.tmp-"));

// ---------- synthetic corpus (generic names only) ----------

async function seedEntity(id, name, overrides = {}) {
  await writeJsonFile(join(tmpBrain, "entities", `${id}.json`), {
    id, name, type: "product", status: "building", mode: "active", momentum: "medium", priority: "medium",
    blocked: null, next_move: "", last_decision: null, evidence_of_progress: null, open_questions: [],
    related_entities: [], plan: [], metadata: {}, created_at: "2026-09-01", last_updated: "2026-09-30",
    ...overrides,
  });
}

await seedEntity("widget-api", "Widget API", {
  next_move: "Add rate limiting to the public endpoint",
  open_questions: ["Should rate limiting be per key or per IP?"],
});
await seedEntity("docs-site", "Docs Site", {
  next_move: "Publish the onboarding guide",
  evidence_of_progress: "Migrated docs to the new static generator",
});
await seedEntity("sleep-tracker", "Sleep Tracker", {
  next_move: "Ship the nap logging screen",
});
await seedEntity("night-mode", "Night Mode (archived)", {
  mode: "archived", mode_reason: "shelved",
  next_move: "Rate limiting for the archived thing — must never surface",
});

await writeJsonFile(join(tmpBrain, "decisions", "decisions.json"), [
  { id: "dec-001", date: "2026-09-10", entity_id: "widget-api", decision: "Use token-bucket rate limiting per API key",
    why: "Per-IP limits punish shared NAT users", review_date: "2026-12-01", status: "active" },
  { id: "dec-002", date: "2026-08-01", entity_id: "widget-api", decision: "Fixed-window rate limiting (superseded)",
    why: "superseded", review_date: "2026-12-01", status: "superseded", superseded_by: "dec-001" },
  { id: "dec-003", date: "2026-09-12", entity_id: "docs-site", decision: "Adopt a static site generator for docs",
    why: "Versioned docs beat a wiki", review_date: "2026-12-01", status: "active",
    alternatives: [{ option: "Keep the wiki", rejected_because: "no versioning" }],
    invalidate_if: ["docs move to a hosted platform"] },
  { id: "dec-004", date: "2026-07-01", entity_id: "widget-api", decision: "Archived rate limiting experiment",
    why: "archived", review_date: "2026-12-01", status: "archived" },
]);

await writeJsonFile(join(tmpBrain, "patterns", "patterns.json"), [
  { id: "pat-001", first_detected: "2026-09-01", name: "Rate limit incidents recur after deploys",
    entities_affected: ["widget-api"], evidence: ["three incidents"], interpretation: "deploys reset counters",
    risk: "outage", recommendation: "persist counters", status: "active" },
  { id: "pat-002", first_detected: "2026-09-01", name: "Rate limiting false positive pattern",
    entities_affected: [], evidence: [], interpretation: "", risk: "", recommendation: "", status: "false_positive" },
  { id: "pat-003", first_detected: "2026-09-01", name: "Resolved rate limiting pattern",
    entities_affected: [], evidence: [], interpretation: "", risk: "", recommendation: "", status: "resolved" },
]);

// A memory-shaped file: public core has no memories store, but the recall
// surface must never read one even if a private layout is present on disk.
await writeJsonFile(join(tmpBrain, "memories", "mem-001.json"), {
  id: "mem-001", content: "rate limiting memory that must never leak through semantic_recall", status: "active",
});

// ---------- fake credential fragments ----------
// Assembled at runtime so no key-shaped literal exists in this file (the repo's
// secret gate blocks those). The assembled values have the real shape.
const fakeKey = (tag) => ["sk", "proj", `${tag}${"0".repeat(24)}`].join("-");
const FAKE_KEY_ENV = fakeKey("envtest");
const FAKE_KEY_MASKED = ["sk", "proj", "abcdefghijklmnop****XjAA"].join("-");
const FAKE_KEY_LEAK = fakeKey("shouldnotleak");

// ---------- fake provider: deterministic synonym-bucket vectors ----------

const DIMS = 16;
const SYNONYMS = [
  ["sleep", "nap", "napping", "doze", "dozing", "rest", "resting"],
  ["rate", "limit", "limiting", "throttle", "throttling"],
  ["docs", "documentation", "guide", "onboarding"],
  ["deploy", "deploys", "release", "ship"],
];
function fakeVector(text) {
  const v = new Array(DIMS).fill(0);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const bucket = SYNONYMS.findIndex((group) => group.includes(tok));
    if (bucket >= 0) { v[bucket] += 1; continue; }
    let h = 0; for (const c of tok) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[4 + (h % (DIMS - 4))] += 0.25;
  }
  return v;
}
const okProvider = { name: "openai", model: "text-embedding-3-small", dimensions: DIMS, embed: async (t) => fakeVector(t) };
const authFailProvider = {
  ...okProvider,
  embed: async () => {
    const e = new Error(`401 Incorrect API key provided: ${FAKE_KEY_MASKED}. You can find your API key at https://platform.openai.com/account/api-keys.`);
    e.status = 401;
    throw e;
  },
};
const timeoutProvider = {
  ...okProvider,
  embed: async () => { const e = new Error(`Request timed out. ${FAKE_KEY_LEAK}`); e.name = "APIConnectionTimeoutError"; throw e; },
};

function assertNoKeyFragment(obj) {
  const text = JSON.stringify(obj);
  assert.doesNotMatch(text, /sk-[A-Za-z0-9*_-]{4,}/, "response must not echo credential fragments");
}

// ---------- tests ----------

test("no provider: lexical results with truthful degraded metadata", async () => {
  emb.setEmbeddingsProviderOverride(undefined);
  emb.resetEmbeddingsProviderForTests();
  const res = await recall({ query: "rate limiting", max_results: 10 });
  assert.equal(res.mode, "lexical");
  assert.equal(res.degraded, true);
  assert.equal(res.fallback_reason, "not_configured");
  assert.deepEqual(res.provider, { configured: false, ready: false, name: "none", model: null });
  const ids = res.results.map((r) => `${r.source_kind}/${r.source_id}`);
  assert.ok(ids.includes("decision/dec-001"), `expected dec-001 in ${ids}`);
  assert.ok(ids.includes("entity/widget-api"));
  assert.ok(ids.includes("pattern/pat-001"));
  for (const r of res.results) {
    assert.equal(r.semantic_rank, null);
    assert.equal(typeof r.lexical_rank, "number");
    assert.ok(r.snippet.length <= 201, "snippet bounded");
    assert.ok(Number.isFinite(r.score));
  }
  assert.equal(res.count, res.results.length);
  assertNoKeyFragment(res);
});

test("archived/superseded/terminal records and memories never leak (lexical)", async () => {
  emb.setEmbeddingsProviderOverride(undefined);
  emb.resetEmbeddingsProviderForTests();
  const res = await recall({ query: "rate limiting archived superseded false positive resolved memory leak", max_results: 20 });
  const ids = res.results.map((r) => `${r.source_kind}/${r.source_id}`);
  assert.ok(!ids.includes("entity/night-mode"), "archived entity leaked");
  assert.ok(!ids.includes("decision/dec-002"), "superseded decision leaked");
  assert.ok(!ids.includes("decision/dec-004"), "archived decision leaked");
  assert.ok(!ids.includes("pattern/pat-002"), "false_positive pattern leaked");
  assert.ok(!ids.includes("pattern/pat-003"), "resolved pattern leaked");
  assert.ok(!ids.some((id) => id.startsWith("memory/")), "memory leaked");
  assert.ok(!JSON.stringify(res).includes("must never leak"));
});

test("local mode: lexical fallback, no vulnerable provider loaded", async () => {
  emb.setEmbeddingsProviderOverride(undefined);
  process.env.BRAIN_EMBEDDINGS = "local";
  emb.resetEmbeddingsProviderForTests();
  try {
    const res = await recall({ query: "rate limiting" });
    assert.equal(res.mode, "lexical");
    assert.equal(res.degraded, true);
    assert.equal(res.fallback_reason, "local_provider_unavailable");
    assert.equal(res.provider.configured, true);
    assert.equal(res.provider.ready, false);
    assert.ok(res.results.length > 0);
    // The former local dependency chain must not be reachable from the build.
    const src = readFileSync(new URL("../dist/utils/embeddings.js", import.meta.url), "utf-8");
    assert.doesNotMatch(src, /import\(\s*["']@huggingface/);
    assert.doesNotMatch(src, /from\s+["']@huggingface/);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        assert.doesNotMatch(name, /huggingface|onnxruntime|^sharp$/, `${field} must not include ${name}`);
      }
    }
  } finally {
    delete process.env.BRAIN_EMBEDDINGS;
    emb.resetEmbeddingsProviderForTests();
  }
});

test("openai mode without the optional package: lexical fallback, no external request", async () => {
  emb.setEmbeddingsProviderOverride(undefined);
  process.env.BRAIN_EMBEDDINGS = "openai";
  process.env.OPENAI_API_KEY = FAKE_KEY_ENV;
  emb.resetEmbeddingsProviderForTests();
  try {
    const res = await recall({ query: "rate limiting" });
    assert.equal(res.mode, "lexical");
    assert.equal(res.fallback_reason, "optional_package_missing");
    assert.equal(res.provider.configured, true);
    assert.ok(res.results.length > 0);
    assertNoKeyFragment(res);
  } finally {
    delete process.env.BRAIN_EMBEDDINGS;
    delete process.env.OPENAI_API_KEY;
    emb.resetEmbeddingsProviderForTests();
  }
});

test("rebuild --dry-run performs no writes and shows the plan; rebuild writes atomically", async () => {
  if (existsSync(embeddingsPath)) unlinkSync(embeddingsPath);
  emb.setEmbeddingsProviderOverride(null);
  const dry = await rebuildEmbeddingsIndex(ctx, { dryRun: true });
  assert.equal(dry.dry_run, true);
  assert.equal(dry.written, false);
  assert.equal(existsSync(embeddingsPath), false, "dry run must not create the index");
  assert.deepEqual(tmpFiles(), []);
  // archived entity, superseded/archived decisions, terminal patterns excluded
  assert.deepEqual(dry.plan, { entities: 3, decisions: 2, decision_facets: 4, patterns: 1, total: 8 });

  // Real rebuild without a ready provider: no API call, no write.
  const noProvider = await rebuildEmbeddingsIndex(ctx, { dryRun: false });
  assert.equal(noProvider.written, false);
  assert.equal(existsSync(embeddingsPath), false);

  // Real rebuild with the mocked provider.
  let calls = 0;
  emb.setEmbeddingsProviderOverride({ ...okProvider, embed: async (t) => { calls += 1; return fakeVector(t); } });
  const real = await rebuildEmbeddingsIndex(ctx, { dryRun: false });
  assert.equal(real.written, true);
  assert.equal(real.embedded, 8);
  assert.equal(calls, 8, "one provider call per planned item");
  assert.deepEqual(tmpFiles(), [], "no temp files left behind");
  const stored = JSON.parse(readFileSync(embeddingsPath, "utf-8"));
  assert.equal(stored.length, 8);
  for (const e of stored) {
    assert.equal(e.provider, "openai");
    assert.equal(e.model, "text-embedding-3-small");
    assert.equal(e.dimensions, DIMS);
    assert.equal(e.vector.length, DIMS);
  }
  assert.ok(!stored.some((e) => e.source_id === "dec-002" || e.source_id === "night-mode" || e.source_id === "dec-004"));

  // A failing provider mid-rebuild aborts and leaves the old index byte-identical.
  const before = readFileSync(embeddingsPath, "utf-8");
  emb.setEmbeddingsProviderOverride(authFailProvider);
  const failed = await rebuildEmbeddingsIndex(ctx, { dryRun: false });
  assert.equal(failed.written, false);
  assert.equal(readFileSync(embeddingsPath, "utf-8"), before);
  assertNoKeyFragment(failed);
  assert.deepEqual(tmpFiles(), []);
});

test("mocked semantic success: paraphrase-only result appears; fusion is deterministic", async () => {
  emb.setEmbeddingsProviderOverride(okProvider);
  const a = await recall({ query: "dozing", max_results: 5 });
  assert.equal(a.mode, "hybrid");
  assert.equal(a.degraded, false);
  assert.equal(a.fallback_reason, undefined);
  assert.deepEqual(a.provider, { configured: true, ready: true, name: "openai", model: "text-embedding-3-small" });
  assert.equal(a.index.coverage.indexed, a.index.coverage.expected);
  const hit = a.results.find((r) => r.source_id === "sleep-tracker");
  assert.ok(hit, `paraphrase hit missing: ${JSON.stringify(a.results)}`);
  assert.equal(hit.lexical_rank, null, "no lexical overlap between 'dozing' and 'nap'");
  assert.equal(hit.semantic_rank, 1);
  assert.ok(hit.similarity > 0.3);
  const b = await recall({ query: "dozing", max_results: 5 });
  assert.deepEqual(a, b, "same input must produce identical output");
});

test("duplicate lexical/semantic hits merge once with both ranks", async () => {
  emb.setEmbeddingsProviderOverride(okProvider);
  const res = await recall({ query: "rate limiting", max_results: 10 });
  assert.equal(res.mode, "hybrid");
  const keys = res.results.map((r) => `${r.source_kind}/${r.source_id}`);
  assert.equal(new Set(keys).size, keys.length, "duplicates in fused results");
  const dec = res.results.find((r) => r.source_id === "dec-001");
  assert.ok(dec);
  assert.equal(typeof dec.lexical_rank, "number");
  assert.equal(typeof dec.semantic_rank, "number");
  assert.ok(!keys.includes("decision/dec-002") && !keys.includes("entity/night-mode"));
  assert.ok(!JSON.stringify(res).includes("must never leak"));
});

test("mocked OpenAI 401: lexical results survive, reason auth_failed, no key fragment anywhere", async () => {
  emb.setEmbeddingsProviderOverride(authFailProvider);
  const res = await recall({ query: "rate limiting" });
  assert.equal(res.mode, "lexical");
  assert.equal(res.degraded, true);
  assert.equal(res.fallback_reason, "auth_failed");
  assert.equal(res.provider.ready, true, "provider initialized but the call was rejected");
  assert.ok(res.results.length > 0, "lexical results must survive a provider failure");
  assert.ok(res.index.compatible > 0, "index stats still reported when the provider call fails");
  assertNoKeyFragment(res);

  // decision_check records provider errors in its response; it must get the sanitized form.
  const dc = await checkDecision({ proposed_action: "switch to fixed-window rate limiting" }, ctx);
  assert.ok(dc.embeddings_error, "decision_check reports the degraded provider");
  assertNoKeyFragment(dc);
});

test("mocked OpenAI timeout: lexical results survive, reason provider_error", async () => {
  emb.setEmbeddingsProviderOverride(timeoutProvider);
  const res = await recall({ query: "rate limiting" });
  assert.equal(res.mode, "lexical");
  assert.equal(res.fallback_reason, "provider_error");
  assert.ok(res.results.length > 0);
  assertNoKeyFragment(res);
  assert.doesNotMatch(res.message ?? "", /shouldnotleak/);
});

test("source_kind and max_results are enforced", async () => {
  emb.setEmbeddingsProviderOverride(okProvider);
  const decisions = await recall({ query: "rate limiting docs", source_kind: "decision", max_results: 10 });
  assert.ok(decisions.results.length > 0);
  assert.ok(decisions.results.every((r) => r.source_kind === "decision"));
  const one = await recall({ query: "rate limiting", max_results: 1 });
  assert.equal(one.count, 1);
  assert.equal(one.results.length, 1);
  const capped = await recall({ query: "rate limiting docs sleep", max_results: 500 });
  assert.ok(capped.results.length <= MAX_RESULTS_CAP);
  const sessions = await recall({ query: "rate limiting", source_kind: "session" });
  assert.equal(sessions.results.length, 0, "no session vectors seeded; nothing lexical for sessions");
  await assert.rejects(() => recall({ query: "x", source_kind: "memory" }), /Invalid source_kind/);
});

test("stale and wrong-dimension vectors are ignored without NaN or crash; counts reported", async () => {
  const stored = JSON.parse(readFileSync(embeddingsPath, "utf-8"));
  const good = stored.find((e) => e.source_id === "widget-api");
  const corrupted = [
    good,
    { ...good, id: "entity-ghost", source_id: "ghost" }, // deleted source → stale
    { ...good, id: "decision-dec-002-chosen", source_kind: "decision", source_id: "dec-002" }, // superseded → stale
    { ...good, id: "entity-docs-site", source_id: "docs-site", vector: [1, 2, 3] }, // wrong dimension
    { ...good, id: "entity-sleep-tracker", source_id: "sleep-tracker", vector: good.vector.map(() => NaN) }, // non-finite
    { ...good, id: "decision-dec-001-chosen", source_kind: "decision", source_id: "dec-001", provider: "local" }, // wrong provider
    { ...good, id: "pattern-pat-001", source_kind: "pattern", source_id: "pat-001", model: "text-embedding-3-large" }, // wrong model
    { ...good, id: "decision-dec-003-chosen", source_kind: "decision", source_id: "dec-003", dimensions: 1536 }, // metadata mismatch
    "not-an-object",
  ];
  await emb.replaceEmbeddingsIndex(corrupted);
  emb.setEmbeddingsProviderOverride(okProvider);
  const res = await recall({ query: "rate limiting", max_results: 10 });
  assert.equal(res.mode, "hybrid");
  assert.equal(res.index.stale, 2);
  assert.equal(res.index.incompatible, 5);
  assert.equal(res.index.compatible, 1);
  assert.equal(res.fallback_reason, "index_incomplete");
  assert.equal(res.degraded, true);
  assert.ok(res.index.coverage.indexed < res.index.coverage.expected);
  assert.ok(!res.results.some((r) => r.source_id === "ghost"));
  for (const r of res.results) {
    assert.ok(Number.isFinite(r.score));
    if (r.similarity !== null) assert.ok(Number.isFinite(r.similarity));
  }
  assert.ok(!JSON.stringify(res).includes("NaN"));
  // restore a complete index for later tests
  await rebuildEmbeddingsIndex(ctx, { dryRun: false });
});

test("credential rotation alone never invalidates the index; legacy entries validate by vector length", () => {
  const active = { name: "openai", model: "text-embedding-3-small", dimensions: 384 };
  const vec = new Array(384).fill(0.1);
  const modern = { id: "x", source_kind: "entity", source_id: "a", content: "", vector: vec, provider: "openai", model: "text-embedding-3-small", dimensions: 384, created_at: "" };
  assert.equal(emb.classifyEntry(modern, active), "compatible");
  // The key is not part of the entry or the provider descriptor — nothing to compare.
  const legacy = { id: "y", source_kind: "entity", source_id: "b", content: "", vector: vec, provider: "openai", created_at: "" };
  assert.equal(emb.classifyEntry(legacy, active), "compatible");
  assert.equal(emb.classifyEntry(legacy, { ...active, dimensions: 16 }), "incompatible");
  assert.equal(emb.classifyEntry(legacy, { ...active, model: "text-embedding-3-large" }), "incompatible");
  assert.equal(emb.classifyEntry({ ...legacy, provider: "local" }, active), "incompatible");
});

test("sanitizeProviderError keeps class name and status only", () => {
  const e401 = new Error(`401 Incorrect API key provided: ${FAKE_KEY_MASKED}`);
  e401.status = 401;
  const s1 = emb.sanitizeProviderError(e401);
  assert.equal(s1.reason, "auth_failed");
  assert.doesNotMatch(s1.message, /sk-/);
  const eTimeout = new Error(`timed out ${FAKE_KEY_LEAK}`); eTimeout.name = "APIConnectionTimeoutError";
  const s2 = emb.sanitizeProviderError(eTimeout);
  assert.equal(s2.reason, "provider_error");
  assert.match(s2.message, /APIConnectionTimeoutError/);
  assert.doesNotMatch(s2.message, /sk-/);
  const sNamed = emb.sanitizeProviderError(Object.assign(new Error("x"), { name: "AuthenticationError" }));
  assert.equal(sNamed.reason, "auth_failed");
  assert.equal(emb.sanitizeProviderError("string error").reason, "provider_error");
});

test("reciprocal-rank fusion is deterministic with a total tie-break", () => {
  const A = ["a", "b", "c"].map((k) => ({ key: k, item: k }));
  const B = ["c", "a", "d"].map((k) => ({ key: k, item: k }));
  const f1 = reciprocalRankFusion([A, B]);
  const f2 = reciprocalRankFusion([A, B]);
  assert.deepEqual(f1, f2);
  assert.deepEqual(f1.map((x) => x.key), ["a", "c", "b", "d"]);
  assert.deepEqual(f1[0].ranks, [1, 2]);
  assert.ok(f1[0].score > f1[2].score);
  // ties: same single-list rank → key order
  const T1 = [{ key: "z", item: 1 }];
  const T2 = [{ key: "y", item: 2 }];
  assert.deepEqual(reciprocalRankFusion([T1, T2]).map((x) => x.key), ["y", "z"]);
});

test("lexical ranking is stable: identical scores order by kind then id", () => {
  const records = [
    { source_kind: "pattern", source_id: "p-1", title: "alpha", fields: ["alpha"] },
    { source_kind: "entity", source_id: "e-2", title: "alpha", fields: ["alpha"] },
    { source_kind: "entity", source_id: "e-1", title: "alpha", fields: ["alpha"] },
    { source_kind: "decision", source_id: "d-1", title: "alpha", fields: ["alpha"] },
  ];
  const ranked = rankLexical(records, "alpha", 10).map((c) => `${c.source_kind}/${c.source_id}`);
  assert.deepEqual(ranked, ["entity/e-1", "entity/e-2", "decision/d-1", "pattern/p-1"]);
  assert.deepEqual(rankLexical(records, "the of and", 10), [], "stopword-only query matches nothing");
});

test("response stays below 16KB even with many long matches", async () => {
  emb.setEmbeddingsProviderOverride(undefined);
  emb.resetEmbeddingsProviderForTests();
  const ids = [];
  for (let i = 0; i < 40; i++) {
    const id = `bulk-${String(i).padStart(2, "0")}`;
    ids.push(id);
    await seedEntity(id, `Bulk payload ${i}`, {
      next_move: `payload ${"x".repeat(1500)} payload`,
      evidence_of_progress: "payload ".repeat(300),
      open_questions: Array.from({ length: 10 }, (_, j) => `payload question ${j} ${"y".repeat(200)}`),
    });
  }
  try {
    const res = await recall({ query: "payload", max_results: 20 });
    const bytes = Buffer.byteLength(JSON.stringify(res, null, 2), "utf-8");
    assert.ok(bytes < RESPONSE_BYTE_BUDGET, `response ${bytes} bytes exceeds ${RESPONSE_BYTE_BUDGET}`);
    assert.ok(res.results.length > 0);
    assert.ok(res.results.every((r) => r.snippet.length <= 201 && (r.title ?? "").length <= 121));
  } finally {
    for (const id of ids) unlinkSync(join(tmpBrain, "entities", `${id}.json`));
  }
});

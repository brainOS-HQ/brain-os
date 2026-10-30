#!/usr/bin/env node
// Synthetic recall eval for semantic_recall. Runs in two modes against a
// throwaway store (generic names only — never the private corpus):
//   lexical : no provider configured
//   hybrid  : mocked provider (deterministic synonym-bucket vectors) + rebuild
// Reports hit@3 and MRR per mode and fails if thresholds are not met.
//
// Usage: node tests/recall-eval.mjs   (after `npm run build`)

import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpBrain = mkdtempSync(join(tmpdir(), "brain-os-recall-eval-"));
process.env.BRAIN_DIR = tmpBrain;
delete process.env.BRAIN_EMBEDDINGS;
delete process.env.OPENAI_API_KEY;
for (const sub of ["entities", "decisions", "patterns", "sessions"]) mkdirSync(join(tmpBrain, sub), { recursive: true });
process.on("exit", () => rmSync(tmpBrain, { recursive: true, force: true }));

const { recallByMeaning } = await import("../dist/tools/semantic-recall.js");
const { createLocalJsonAdapter } = await import("../dist/storage/local-json.js");
const emb = await import("../dist/utils/embeddings.js");
const { rebuildEmbeddingsIndex } = await import("../dist/recall/rebuild.js");
const { writeJsonFile } = await import("../dist/utils/file-store.js");
const ctx = { storage: createLocalJsonAdapter() };

// ---------- corpus ----------
const entities = [
  ["widget-api", "Widget API", { next_move: "Add rate limiting to the public endpoint", open_questions: ["per key or per IP?"] }],
  ["docs-site", "Docs Site", { next_move: "Publish the onboarding guide", evidence_of_progress: "Migrated docs to a static generator" }],
  ["sleep-tracker", "Sleep Tracker", { next_move: "Ship the nap logging screen" }],
  ["billing-core", "Billing Core", { next_move: "Reconcile invoices nightly", blocked: "waiting on payment provider sandbox" }],
  ["mobile-shell", "Mobile Shell", { next_move: "Fix the crash on cold start", open_questions: ["is the crash specific to older devices?"] }],
  ["search-index", "Search Index", { next_move: "Rebuild the inverted index incrementally" }],
  ["mailer", "Mailer", { next_move: "Add bounce handling for transactional email" }],
  ["auth-gateway", "Auth Gateway", { next_move: "Rotate signing keys quarterly", last_decision: "Use short-lived tokens" }],
  ["old-dashboard", "Old Dashboard", { mode: "archived", mode_reason: "replaced", next_move: "rate limiting crash invoices — archived noise" }],
];
for (const [id, name, o] of entities) {
  await writeJsonFile(join(tmpBrain, "entities", `${id}.json`), {
    id, name, type: "product", status: "building", mode: "active", momentum: "medium", priority: "medium",
    blocked: null, next_move: "", last_decision: null, evidence_of_progress: null, open_questions: [],
    related_entities: [], plan: [], metadata: {}, created_at: "2026-09-01", last_updated: "2026-09-30", ...o,
  });
}
await writeJsonFile(join(tmpBrain, "decisions", "decisions.json"), [
  { id: "dec-rate", date: "2026-09-10", entity_id: "widget-api", decision: "Use token-bucket rate limiting per API key", why: "per-IP punishes NAT users", review_date: "2026-12-01", status: "active" },
  { id: "dec-docs", date: "2026-09-12", entity_id: "docs-site", decision: "Adopt a static site generator for documentation", why: "versioned docs", review_date: "2026-12-01", status: "active", alternatives: [{ option: "Keep the wiki", rejected_because: "no versioning" }] },
  { id: "dec-tokens", date: "2026-09-13", entity_id: "auth-gateway", decision: "Use short-lived access tokens with refresh rotation", why: "limits blast radius of a leaked token", review_date: "2026-12-01", status: "active" },
  { id: "dec-invoice", date: "2026-09-14", entity_id: "billing-core", decision: "Reconcile invoices nightly instead of in real time", why: "provider webhooks are unreliable", review_date: "2026-12-01", status: "active" },
  { id: "dec-crash", date: "2026-09-15", entity_id: "mobile-shell", decision: "Block the release until the cold-start crash is fixed", why: "crash rate above threshold", review_date: "2026-12-01", status: "active" },
  { id: "dec-old", date: "2026-07-01", entity_id: "widget-api", decision: "Fixed-window rate limiting", why: "superseded", review_date: "2026-12-01", status: "superseded", superseded_by: "dec-rate" },
]);
await writeJsonFile(join(tmpBrain, "patterns", "patterns.json"), [
  { id: "pat-deploy", first_detected: "2026-09-01", name: "Incidents cluster after Friday deploys", entities_affected: ["widget-api"], evidence: ["three incidents"], interpretation: "deploys reset counters", risk: "outage", recommendation: "freeze Friday deploys", status: "active" },
  { id: "pat-stale", first_detected: "2026-09-01", name: "Entities go stale when blocked on vendors", entities_affected: ["billing-core"], evidence: [], interpretation: "external dependency", risk: "drift", recommendation: "set vendor follow-up dates", status: "monitoring" },
]);

// ---------- queries: [query, expected ids (any hit counts), kind] ----------
const QUERIES = [
  ["rate limiting", ["decision/dec-rate", "entity/widget-api"], "lexical"],
  ["onboarding guide docs", ["entity/docs-site", "decision/dec-docs"], "lexical"],
  ["invoice reconciliation", ["decision/dec-invoice", "entity/billing-core"], "lexical"],
  ["cold start crash", ["entity/mobile-shell", "decision/dec-crash"], "lexical"],
  ["signing key rotation", ["entity/auth-gateway"], "lexical"],
  ["bounce handling", ["entity/mailer"], "lexical"],
  ["friday deploys incidents", ["pattern/pat-deploy"], "lexical"],
  ["vendor blocked stale", ["pattern/pat-stale"], "lexical"],
  ["dozing", ["entity/sleep-tracker"], "paraphrase"],
  ["throttling", ["decision/dec-rate", "entity/widget-api"], "paraphrase"],
  ["release freeze", ["pattern/pat-deploy", "decision/dec-crash"], "paraphrase"],
  ["bill settlement", ["decision/dec-invoice", "entity/billing-core"], "paraphrase"],
];

// ---------- mocked provider (deterministic synonym buckets) ----------
const DIMS = 24;
const SYNONYMS = [
  ["sleep", "nap", "napping", "doze", "dozing", "rest"],
  ["rate", "limit", "limiting", "throttle", "throttling"],
  ["docs", "documentation", "guide", "onboarding"],
  ["deploy", "deploys", "release", "ship", "freeze"],
  ["invoice", "invoices", "bill", "billing", "settlement", "reconcile"],
  ["crash", "cold", "start"],
];
function fakeVector(text) {
  const v = new Array(DIMS).fill(0);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const bucket = SYNONYMS.findIndex((g) => g.includes(tok));
    if (bucket >= 0) { v[bucket] += 1; continue; }
    let h = 0; for (const c of tok) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[SYNONYMS.length + (h % (DIMS - SYNONYMS.length))] += 0.2;
  }
  return v;
}

async function evaluate(label) {
  let hits = 0, rr = 0;
  const rows = [];
  for (const [q, expected, kind] of QUERIES) {
    const res = await recallByMeaning({ query: q, max_results: 5 }, ctx);
    const got = res.results.map((r) => `${r.source_kind}/${r.source_id}`);
    const rank = got.findIndex((id) => expected.includes(id));
    const hit3 = rank >= 0 && rank < 3;
    if (hit3) hits += 1;
    if (rank >= 0) rr += 1 / (rank + 1);
    if (got.includes("entity/old-dashboard") || got.includes("decision/dec-old")) throw new Error(`terminal record leaked for "${q}"`);
    rows.push({ query: q, kind, mode: res.mode, rank: rank < 0 ? "-" : rank + 1, top: got.slice(0, 3).join(", ") });
  }
  const n = QUERIES.length;
  console.log(`\n== ${label} ==`);
  console.table(rows);
  const summary = { hit_at_3: hits / n, mrr: rr / n };
  console.log(`hit@3 = ${summary.hit_at_3.toFixed(3)}   MRR = ${summary.mrr.toFixed(3)}`);
  return summary;
}

emb.setEmbeddingsProviderOverride(undefined);
emb.resetEmbeddingsProviderForTests();
const lexical = await evaluate("lexical (no provider)");

emb.setEmbeddingsProviderOverride({ name: "openai", model: "text-embedding-3-small", dimensions: DIMS, embed: async (t) => fakeVector(t) });
const rebuilt = await rebuildEmbeddingsIndex(ctx, { dryRun: false });
if (!rebuilt.written) throw new Error(`rebuild failed: ${rebuilt.message}`);
const hybrid = await evaluate("hybrid (mocked provider)");

const failures = [];
if (lexical.hit_at_3 < 0.65) failures.push(`lexical hit@3 ${lexical.hit_at_3.toFixed(3)} < 0.65`);
if (hybrid.hit_at_3 < 0.9) failures.push(`hybrid hit@3 ${hybrid.hit_at_3.toFixed(3)} < 0.90`);
if (hybrid.hit_at_3 < lexical.hit_at_3) failures.push("hybrid must not regress lexical hit@3");
if (hybrid.mrr < lexical.mrr) failures.push("hybrid must not regress lexical MRR");
if (failures.length) {
  console.error(`\nrecall-eval FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nrecall-eval PASSED");

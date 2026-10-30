import type { StorageAdapter } from "../storage/adapter.js";
import type { Entity } from "../schemas/entity.js";
import type { Decision } from "../schemas/decision.js";
import type { Pattern } from "../schemas/pattern.js";

/**
 * Adapter-backed lexical recall over CURRENT canonical state.
 *
 * Searches entities, decisions, and patterns through the StorageAdapter —
 * never the embeddings index and never memories (memory_recall is their only
 * surface). Archived entities, superseded/archived decisions, and resolved /
 * false-positive patterns are excluded before scoring.
 *
 * Scoring is deterministic: token hits weighted by field, coverage of the query
 * vocabulary, a phrase-containment bonus, and a stable tie-break
 * (score desc → kind order → id asc). No randomness, no time dependence.
 */

export type LexicalSourceKind = "entity" | "decision" | "pattern";

export interface CanonicalRecord {
  source_kind: LexicalSourceKind;
  source_id: string;
  title: string;
  /** Searchable fields in priority order (title first). */
  fields: string[];
}

export interface LexicalCandidate {
  source_kind: LexicalSourceKind;
  source_id: string;
  title: string;
  snippet: string;
  score: number;
  matched_tokens: string[];
}

export const SNIPPET_MAX_CHARS = 200;
export const TITLE_MAX_CHARS = 120;

const KIND_ORDER: Record<LexicalSourceKind, number> = { entity: 0, decision: 1, pattern: 2 };

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with", "at", "by", "from",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "has", "have", "had",
  "it", "its", "this", "that", "these", "those", "there", "here", "as", "if", "so", "than", "then",
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his", "she", "her", "they", "them", "their",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  "about", "into", "over", "under", "up", "down", "out", "off", "any", "some", "all", "no", "not", "yes",
  "can", "could", "should", "would", "will", "shall", "may", "might", "must",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

function queryTokens(query: string): string[] {
  const raw = tokenize(query);
  const filtered = raw.filter((t) => !STOPWORDS.has(t));
  const chosen = filtered.length ? filtered : raw;
  return Array.from(new Set(chosen));
}

function normalize(text: string): string {
  return tokenize(text).join(" ");
}

function clip(text: string, max: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// --- Canonical record projection (what is searchable, per kind) ---

export function entityRecord(e: Entity): CanonicalRecord {
  const planSteps = (e.plan ?? [])
    .filter((s) => s.status === "active" || s.status === "pending")
    .map((s) => s.description);
  return {
    source_kind: "entity",
    source_id: e.id,
    title: e.name || e.id,
    fields: [
      [e.name, e.id, ...(e.aliases ?? [])].filter(Boolean).join(" "),
      str(e.next_move),
      str(e.blocked),
      str(e.last_decision),
      // evidence_of_progress is deliberately NOT searched: it is an append-only
      // history field. Current-state recall must not surface stale history
      // noise or pay for scanning it; history belongs to audit_log / activity /
      // progress surfaces.
      strs(e.open_questions).join(" | "),
      planSteps.join(" | "),
      [e.type, e.status, e.mode_reason].filter(Boolean).join(" "),
    ],
  };
}

export function decisionRecord(d: Decision): CanonicalRecord {
  const alternatives = (d.alternatives ?? []).map((a) => `${a.option}: ${a.rejected_because}`);
  return {
    source_kind: "decision",
    source_id: d.id,
    title: clip(d.decision, TITLE_MAX_CHARS),
    fields: [
      str(d.decision),
      str(d.why),
      str(d.chosen_direction),
      strs(d.assumptions).join(" | "),
      strs(d.invalidate_if).join(" | "),
      str(d.proof_action),
      alternatives.join(" | "),
      [d.entity_id, d.type].filter(Boolean).join(" "),
    ],
  };
}

export function patternRecord(p: Pattern): CanonicalRecord {
  return {
    source_kind: "pattern",
    source_id: p.id,
    title: p.name || p.id,
    fields: [
      str(p.name),
      str(p.interpretation),
      str(p.risk),
      str(p.recommendation),
      strs(p.evidence).join(" | "),
      strs(p.entities_affected).join(" "),
    ],
  };
}

export function isCurrentEntity(e: Entity): boolean {
  return e.mode !== "archived";
}

export function isCurrentDecision(d: Decision): boolean {
  return d.status === "active";
}

export function isCurrentPattern(p: Pattern): boolean {
  return p.status === "active" || p.status === "monitoring";
}

/**
 * Load the current canonical records for the requested kinds through the
 * adapter. `kinds` omitted = all three.
 */
export async function loadCanonicalRecords(
  storage: StorageAdapter,
  kinds?: LexicalSourceKind[],
): Promise<CanonicalRecord[]> {
  const want = new Set<LexicalSourceKind>(kinds ?? ["entity", "decision", "pattern"]);
  const records: CanonicalRecord[] = [];
  if (want.has("entity")) {
    for (const e of await storage.listEntities()) {
      if (e && typeof e.id === "string" && isCurrentEntity(e)) records.push(entityRecord(e));
    }
  }
  if (want.has("decision")) {
    for (const d of await storage.getDecisions()) {
      if (d && typeof d.id === "string" && isCurrentDecision(d)) records.push(decisionRecord(d));
    }
  }
  if (want.has("pattern")) {
    for (const p of await storage.getPatterns()) {
      if (p && typeof p.id === "string" && isCurrentPattern(p)) records.push(patternRecord(p));
    }
  }
  return records;
}

// --- Scoring ---

const TITLE_HIT = 3;
const BODY_HIT = 2;
const PREFIX_HIT = 1;
const PHRASE_BONUS = 4;
const COVERAGE_WEIGHT = 10;

interface FieldIndex {
  text: string;
  normalized: string;
  tokens: Set<string>;
}

function indexField(text: string): FieldIndex {
  return { text, normalized: normalize(text), tokens: new Set(tokenize(text)) };
}

function prefixMatch(token: string, fieldTokens: Set<string>): boolean {
  if (token.length < 4) return false;
  for (const ft of fieldTokens) {
    if (ft.length < 4) continue;
    if (ft.startsWith(token) || token.startsWith(ft)) return true;
  }
  return false;
}

function snippetFor(field: FieldIndex, matched: string[]): string {
  const lower = field.text.toLowerCase();
  let at = -1;
  for (const t of matched) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return clip(field.text, SNIPPET_MAX_CHARS);
  const start = Math.max(0, at - Math.floor(SNIPPET_MAX_CHARS / 3));
  const window = field.text.slice(start, start + SNIPPET_MAX_CHARS);
  return (start > 0 ? "…" : "") + clip(window, SNIPPET_MAX_CHARS);
}

export function scoreRecord(record: CanonicalRecord, qTokens: string[], phrase: string): LexicalCandidate | null {
  if (qTokens.length === 0) return null;
  const fields = record.fields.map(indexField);
  const matched = new Set<string>();
  let hits = 0;
  let bestField = 0;
  let bestFieldHits = -1;
  const perField = new Array<number>(fields.length).fill(0);

  for (const token of qTokens) {
    let tokenScore = 0;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      let s = 0;
      if (f.tokens.has(token)) s = i === 0 ? TITLE_HIT : BODY_HIT;
      else if (prefixMatch(token, f.tokens)) s = PREFIX_HIT;
      if (s > 0) {
        perField[i] += 1;
        if (s > tokenScore) tokenScore = s;
      }
    }
    if (tokenScore > 0) {
      matched.add(token);
      hits += tokenScore;
    }
  }
  if (matched.size === 0) return null;

  for (let i = 0; i < fields.length; i++) {
    if (perField[i] > bestFieldHits) {
      bestFieldHits = perField[i];
      bestField = i;
    }
  }

  const coverage = matched.size / qTokens.length;
  let score = coverage * COVERAGE_WEIGHT + hits;
  if (phrase && qTokens.length > 1 && fields.some((f) => f.normalized.includes(phrase))) score += PHRASE_BONUS;

  const matchedList = Array.from(matched).sort();
  return {
    source_kind: record.source_kind,
    source_id: record.source_id,
    title: clip(record.title, TITLE_MAX_CHARS),
    snippet: snippetFor(fields[bestField], matchedList),
    score: Math.round(score * 1000) / 1000,
    matched_tokens: matchedList,
  };
}

export function compareCandidates(a: LexicalCandidate, b: LexicalCandidate): number {
  return b.score - a.score
    || KIND_ORDER[a.source_kind] - KIND_ORDER[b.source_kind]
    || (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0);
}

/** Rank the given canonical records against the query. Pure and deterministic. */
export function rankLexical(records: CanonicalRecord[], query: string, limit: number): LexicalCandidate[] {
  const qTokens = queryTokens(query);
  const phrase = qTokens.join(" ");
  const scored: LexicalCandidate[] = [];
  for (const r of records) {
    const c = scoreRecord(r, qTokens, phrase);
    if (c) scored.push(c);
  }
  scored.sort(compareCandidates);
  return scored.slice(0, Math.max(0, limit));
}

/** Adapter-backed lexical recall: load current records, then rank. */
export async function lexicalRecall(
  storage: StorageAdapter,
  query: string,
  options: { kinds?: LexicalSourceKind[]; limit: number },
): Promise<{ candidates: LexicalCandidate[]; records: CanonicalRecord[] }> {
  const records = await loadCanonicalRecords(storage, options.kinds);
  return { candidates: rankLexical(records, query, options.limit), records };
}

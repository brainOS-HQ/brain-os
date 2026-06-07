import { Entity } from "../schemas/entity.js";
import { audit } from "../utils/audit.js";
import type { ToolContext } from "../storage/adapter.js";

// ──────────────────────────────────────────────────────────────────────────
// context_resolve — v1
//
// Turns a fuzzy "what am I working on right now" into a concrete entity_id with
// a DERIVED confidence number. It is the missing front of the context pipeline
// whose back half (focus_get(entity_id), decision_check(action, entity_id))
// already exists.
//
// Design rules (locked, see .brain/notes/context-resolver.md):
//   - DETERMINISTIC. No LLM, no embeddings, no cwd inference. Confidence is a
//     function of WHICH SIGNAL TIER fired, not a model's vibe.
//   - Explicit signals win; weak signals only assist. Resolution is an ordered
//     cascade — the first tier that yields a unique entity wins, and its tier
//     value IS the confidence. We never let a weak tier override a strong one.
//   - This is a routing/gating function, so a wrong guess is expensive (it
//     hands the wrong project's decisions to the agent). When the strongest
//     firing tier is ambiguous, we ASK rather than drop to a weaker guess.
//
// NOT in v1 (deferred to v2): ContextSnapshot persistence, session_id
// threading, relevance tiers (required/supporting/background), repo_paths.
// ──────────────────────────────────────────────────────────────────────────

export interface ContextResolveInput {
  user_message?: string;
  files_touched?: string[];
  explicit_entity_id?: string;
  active_mission_id?: string;
}

export interface ContextResolveResult {
  entity_id: string | null;
  entity_name: string | null;
  confidence: number; // 0..1, derived from the firing signal tier
  signal: string | null; // which tier resolved it
  ask_user: boolean;
  reason: string;
  evidence: string[];
  ambiguity: string[];
  candidates: Array<{ entity_id: string; name: string }>;
  // Set when the message names something that isn't a tracked entity.
  // Agents should prompt the user to create it rather than silently dropping it.
  unregistered_candidate?: string;
}

// Confidence behavior bands (see note):
//   >= 0.80  proceed silently
//   0.50-0.79 proceed but hedge ("I think this is X")
//   < 0.50   ask one short question
const ASK_THRESHOLD = 0.5;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}

// The strings we'll try to spot inside a user message for a given entity:
// its display name, any aliases, and the de-slugified id ("atlas-inbox" →
// "atlas inbox") so resolution works even on entities that predate `aliases`.
function mentionForms(entity: Entity): string[] {
  const forms = new Set<string>();
  if (entity.name) forms.add(entity.name.toLowerCase().trim());
  for (const a of entity.aliases ?? []) {
    if (a && a.trim()) forms.add(a.toLowerCase().trim());
  }
  forms.add(entity.id.toLowerCase());
  forms.add(entity.id.replace(/[-_]+/g, " ").toLowerCase());
  return [...forms].filter(Boolean);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageMentionsForm(message: string, form: string): boolean {
  const normalized = form.toLowerCase().trim();
  if (!normalized) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}(?=$|[^a-z0-9])`).test(message);
}

function formSpecificity(form: string): number {
  // Filter single-char tokens (e.g. the "s" from "Acme's" splitting on apostrophe)
  // so possessives don't inflate specificity over clean two-word names.
  const tokens = form.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
  // Phrase length is the real disambiguator ("acme hackathon" beats "acme").
  // Equal-length names stay ambiguous; this is a router, not a guesser.
  return tokens.length;
}

interface MentionHit {
  entity: Entity;
  form: string;
  specificity: number;
}

function mentionHits(entities: Entity[], message: string): MentionHit[] {
  return entities.flatMap((entity) => {
    const matched = mentionForms(entity)
      .filter((form) => messageMentionsForm(message, form))
      .sort((a, b) => formSpecificity(b) - formSpecificity(a));
    const form = matched[0];
    return form ? [{ entity, form, specificity: formSpecificity(form) }] : [];
  });
}

function isActive(e: Entity): boolean {
  return e.mode === "active" || e.mode === "incubating";
}

function resolved(
  entity: Entity,
  confidence: number,
  signal: string,
  reason: string,
  evidence: string[],
  ambiguity: string[] = [],
): ContextResolveResult {
  return {
    entity_id: entity.id,
    entity_name: entity.name,
    confidence: Math.round(confidence * 100) / 100,
    signal,
    ask_user: confidence < ASK_THRESHOLD,
    reason,
    evidence,
    ambiguity,
    candidates: [],
  };
}

export async function resolveContext(
  input: ContextResolveInput,
  ctx: ToolContext,
): Promise<ContextResolveResult> {
  const entities: Entity[] = await ctx.storage.listEntities();
  const byId = new Map(entities.map((e) => [e.id, e]));
  const evidence: string[] = [];
  const ambiguity: string[] = [];
  const message = (input.user_message ?? "").toLowerCase();

  // What do the files point at? Computed up front so it can both resolve (when
  // no mention exists) and serve as confirmation/contradiction evidence (when a
  // mention already won). Match path SEGMENTS exactly against id/aliases — this
  // is explicit data the caller passed, not cwd guessing.
  const fileMatches = new Set<string>();
  for (const path of input.files_touched ?? []) {
    const segs = path.toLowerCase().split(/[/\\.]+/).filter(Boolean);
    const segSet = new Set(segs);
    for (const e of entities) {
      const keys = [e.id.toLowerCase(), ...(e.aliases ?? []).map((a) => a.toLowerCase())];
      if (keys.some((k) => segSet.has(k))) fileMatches.add(e.id);
    }
  }

  let result: ContextResolveResult | null = null;

  // ── TIER 1: explicit_entity_id (caller asserts it) ────────────────────────
  if (input.explicit_entity_id) {
    const e = byId.get(input.explicit_entity_id);
    if (e) {
      evidence.push(`Caller passed explicit_entity_id="${e.id}".`);
      result = resolved(e, 1.0, "explicit_entity_id", `Caller explicitly set entity to ${e.name}.`, evidence);

      // Contradiction check: if the message also mentions a DIFFERENT entity,
      // surface it in ambiguity so calling agents can detect mid-session pivots.
      if (message) {
        const hits = mentionHits(entities, message);
        const conflicting = hits.filter(h => h.entity.id !== e.id);
        for (const hit of conflicting) {
          ambiguity.push(
            `Message mentions "${hit.entity.name}" (${hit.entity.id}) but explicit_entity_id="${e.id}" was asserted. ` +
            `If the user pivoted mid-session, update entity_id before writing.`
          );
        }
      }
    } else {
      ambiguity.push(`explicit_entity_id="${input.explicit_entity_id}" does not match any entity.`);
    }
  }

  // ── TIER 2: explicit user mention (strongest inferred signal) ─────────────
  if (!result && message) {
    const hits = mentionHits(entities, message);
    if (hits.length === 1) {
      const e = hits[0].entity;
      evidence.push(`User message mentions "${e.name}" via "${hits[0].form}".`);
      // Confirmation / contradiction from files — mention OVERRIDES files.
      if (fileMatches.size && !fileMatches.has(e.id)) {
        evidence.push(
          `files_touched point at [${[...fileMatches].join(", ")}], but the explicit mention takes priority over file location.`,
        );
      }
      result = resolved(e, 0.95, "user_mention", `User mentioned ${e.name} by name.`, evidence);
    } else if (hits.length > 1) {
      const ranked = [...hits].sort((a, b) => b.specificity - a.specificity);
      const top = ranked[0];
      const tied = ranked.filter((hit) => hit.specificity === top.specificity);
      if (tied.length === 1) {
        const e = top.entity;
        evidence.push(`User message mentions "${e.name}" via the most specific form "${top.form}".`);
        if (fileMatches.size && !fileMatches.has(e.id)) {
          evidence.push(
            `files_touched point at [${[...fileMatches].join(", ")}], but the explicit mention takes priority over file location.`,
          );
        }
        result = resolved(e, 0.95, "user_mention", `User mentioned ${e.name} by a more specific name.`, evidence);
      } else {
        // Ambiguous at a STRONG tier → ask, don't drop to a weaker guess.
        for (const hit of tied) ambiguity.push(`Message also matches "${hit.entity.name}" via "${hit.form}".`);
        result = {
          entity_id: null,
          entity_name: null,
          confidence: 0.4,
          signal: "user_mention_ambiguous",
          ask_user: true,
          reason: `Message names ${tied.length} entities with equal specificity. Which one?`,
          evidence,
          ambiguity,
          candidates: tied.map((hit) => ({ entity_id: hit.entity.id, name: hit.entity.name })),
        };
      }
    }
  }

  // ── TIER 3: active mission / approved task ────────────────────────────────
  if (!result && input.active_mission_id) {
    const e = byId.get(input.active_mission_id);
    if (e) {
      evidence.push(`active_mission_id="${e.id}".`);
      result = resolved(e, 0.9, "active_mission", `Active mission is on ${e.name}.`, evidence);
    } else {
      ambiguity.push(`active_mission_id="${input.active_mission_id}" does not match any entity.`);
    }
  }

  // ── TIER 4: files touched / repo metadata ─────────────────────────────────
  if (!result && fileMatches.size === 1) {
    const e = byId.get([...fileMatches][0])!;
    evidence.push(`files_touched resolve to ${e.name} by path segment.`);
    result = resolved(e, 0.6, "files_touched", `No explicit mention; files point at ${e.name}.`, evidence);
  } else if (!result && fileMatches.size > 1) {
    for (const id of fileMatches) ambiguity.push(`files_touched also match "${byId.get(id)?.name ?? id}".`);
  }

  // ── TIER 7: lexical similarity (weakest — capped below "proceed silently") ─
  if (!result && message) {
    const msgTokens = new Set(tokenize(message));
    const scored = entities
      .map((e) => {
        const entTokens = new Set(mentionForms(e).flatMap(tokenize));
        let score = 0;
        for (const t of msgTokens) if (entTokens.has(t)) score++;
        return { e, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length) {
      const top = scored[0];
      const second = scored[1]?.score ?? 0;
      if (top.score > second) {
        // Margin-scaled, capped at 0.75 so a weak signal can never "proceed silently".
        const conf = Math.min(0.75, 0.5 + 0.05 * top.score + 0.1 * (top.score - second));
        evidence.push(`Lexical overlap with "${top.e.name}" (${top.score} shared term(s)).`);
        result = resolved(top.e, conf, "lexical", `No explicit mention; best lexical match is ${top.e.name}.`, evidence);
      } else {
        // Tie at the weak tier → ask.
        const tied = scored.filter((s) => s.score === top.score);
        for (const s of tied) ambiguity.push(`Lexical tie with "${s.e.name}".`);
        result = {
          entity_id: null,
          entity_name: null,
          confidence: 0.4,
          signal: "lexical_tie",
          ask_user: true,
          reason: "Weak lexical match with no clear winner. Which entity?",
          evidence,
          ambiguity,
          candidates: tied.map((s) => ({ entity_id: s.e.id, name: s.e.name })),
        };
      }
    }
  }

  // ── Fallback: exactly one active entity in play ───────────────────────────
  if (!result) {
    const active = entities.filter(isActive);
    if (active.length === 1) {
      evidence.push("No message/file signal, but exactly one active entity exists.");
      result = resolved(active[0], 0.7, "single_active", `Only one active entity (${active[0].name}).`, evidence);
    }
  }

  // ── Nothing resolved ──────────────────────────────────────────────────────
  if (!result) {
    // Unregistered entity detection: if the message contains a capitalised phrase
    // that looks like a project name but matched nothing, surface it as a candidate
    // so agents can prompt creation rather than silently dropping it.
    let unregistered_candidate: string | undefined;
    if (message) {
      // Extract sequences of title-case words (e.g. "Terra Data", "Project Alpha")
      const titlePhrases = message.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) ?? [];
      // Also grab CamelCase tokens
      const camelTokens = message.match(/\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/g) ?? [];
      const candidates = [...new Set([...titlePhrases, ...camelTokens])];
      // Filter out known entity names and common English words
      const knownNames = new Set(entities.flatMap(e => mentionForms(e).map(f => f.toLowerCase())));
      const commonWords = new Set(["The", "This", "That", "What", "When", "Where", "How", "Why"]);
      const unrecognised = candidates.filter(c =>
        !commonWords.has(c) && !knownNames.has(c.toLowerCase())
      );
      if (unrecognised.length > 0) {
        unregistered_candidate = unrecognised[0];
      }
    }

    result = {
      entity_id: null,
      entity_name: null,
      confidence: 0,
      signal: null,
      ask_user: true,
      reason: unregistered_candidate
        ? `"${unregistered_candidate}" isn't a tracked entity. Create it first, or clarify which project this is.`
        : "No signal strong enough to resolve context. Ask the user which entity this is.",
      evidence,
      ambiguity,
      candidates: [],
      ...(unregistered_candidate ? { unregistered_candidate } : {}),
    };
  }

  await audit("context_resolve", "resolve", `${result.signal ?? "unresolved"} → ${result.entity_id ?? "none"} (${result.confidence})`, {
    entity_id: result.entity_id ?? undefined,
    before: null,
    after: { confidence: result.confidence, signal: result.signal, ask_user: result.ask_user },
    storage: ctx.storage,
  });

  return result;
}

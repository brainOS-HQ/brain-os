export type FreshnessLevel = "fresh" | "aging" | "stale" | "dormant";

export function calculateStaleness(lastUpdated: string): {
  level: FreshnessLevel;
  days: number;
  label: string;
} {
  const updated = new Date(lastUpdated);
  const now = new Date();
  // Clamp at 0 — a future-dated entity (e.g. a timezone edge case or a
  // pasted-in placeholder date) should read as Fresh, not "Fresh (-5d ago)".
  const days = Math.max(
    0,
    Math.floor((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24)),
  );

  let level: FreshnessLevel;
  let label: string;

  if (days <= 7) {
    level = "fresh";
    label = `Fresh (${days}d ago)`;
  } else if (days <= 21) {
    level = "aging";
    label = `Aging (${days}d ago)`;
  } else if (days <= 45) {
    level = "stale";
    label = `Stale (${days}d ago)`;
  } else {
    level = "dormant";
    label = `Dormant (${days}d ago)`;
  }

  return { level, days, label };
}

export function today(): string {
  // Return today's date in the host's local timezone as YYYY-MM-DD.
  // Do NOT use new Date().toISOString().split("T")[0] — that's the UTC date,
  // which gives the wrong day to anyone west of UTC in the evening or east
  // of UTC in the early morning. All Brain OS day-boundary comparisons
  // (overdue decisions, review_date checks, daily metrics) should use this
  // helper so the user sees "today" as their wall-clock today.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

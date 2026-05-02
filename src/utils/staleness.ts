export type FreshnessLevel = "fresh" | "aging" | "stale" | "dormant";

export function calculateStaleness(lastUpdated: string): {
  level: FreshnessLevel;
  days: number;
  label: string;
} {
  const updated = new Date(lastUpdated);
  const now = new Date();
  const days = Math.floor((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24));

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
  return new Date().toISOString().split("T")[0];
}

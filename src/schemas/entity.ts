export interface Entity {
  id: string;
  name: string;
  type: string;
  status: string;
  mode: "active" | "parked" | "incubating" | "archived";
  mode_reason?: string | null;
  momentum: "high" | "medium" | "low" | "stalled";
  priority: "critical" | "high" | "medium" | "low";
  blocked: string | null;
  next_move: string;
  last_decision: string | null;
  evidence_of_progress: string | null;
  open_questions: string[];
  related_entities: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  last_updated: string;
}

export interface EntitySummary {
  id: string;
  name: string;
  type: string;
  mode: string;
  momentum: string;
  priority: string;
  blocked: string | null;
  next_move: string;
  staleness: string;
  last_updated: string;
}

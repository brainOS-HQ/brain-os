export interface Decision {
  id: string;
  date: string;
  entity_id: string;
  type?: "product_direction" | "architecture" | "scope" | "priority" | "kill_park" | "monetization" | "brand";
  decision: string;
  why: string;
  alternatives?: Array<{
    option: string;
    rejected_because: string;
  }>;
  chosen_direction?: string;
  // The conditions that made this decision true. A decision is only usable over
  // time if the system knows the premises behind it — if the assumptions still
  // hold, the decision likely still holds.
  assumptions?: string[];
  // Condition-based review triggers ("what would make this false"). Distinct from
  // review_date (a time trigger): these are the situations that should reopen the
  // decision. decision_check matches proposed actions against these to nominate a
  // decision for review rather than blindly enforcing it.
  invalidate_if?: string[];
  proof_action: string;
  review_date: string;
  status: "active" | "superseded" | "archived";
  superseded_by?: string | null;
  evidence_appended?: Array<{
    date: string;
    note: string;
  }>;
}

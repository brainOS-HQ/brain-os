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
  proof_action: string;
  review_date: string;
  status: "active" | "superseded" | "archived";
  superseded_by?: string | null;
}

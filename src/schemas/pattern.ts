export interface Pattern {
  id: string;
  first_detected: string;
  name: string;
  entities_affected: string[];
  evidence: string[];
  interpretation: string;
  risk: string;
  recommendation: string;
  status: "active" | "monitoring" | "resolved" | "false_positive";
  last_confirmed?: string | null;
}

// Mirrors backend/src/interview_review/models.py. Keep the two in step by hand; there are ~10 shapes.

export type Status = "processing" | "ready" | "failed";
export type Family = "timing" | "delivery" | "content" | "visual" | "canary";
export type Confidence = "low" | "medium" | "high";

export interface Feedback {
  useful: boolean;
  reason: string;
  at: string;
}

export interface Interview {
  id: string;
  candidate_label: string;
  status: Status;
  stage: string;
  progress: number;
  context_flags: Record<string, boolean>;
  files: Record<string, string>;
  summary: { flag_count?: number; cv_finding_count?: number; skipped_count?: number; duration_sec?: number };
  feedback: Record<string, Feedback>;
  error: string | null;
  created_at: string;
}

export interface Signal {
  unit_id: string;
  family: Family;
  name: string;
  value: number;
  baseline_value: number | null;
  deviation: number;
  anomalous: boolean;
  strong: boolean;
  evidence: { start: number; end: number; note: string };
}

export interface Flag {
  id: string;
  unit_id: string;
  start: number;
  end: number;
  confidence: Confidence;
  families: Family[];
  signals: Signal[];
  explanation: string;
  alternative_explanations: string[];
  verification_prompt: string;
}

export interface CvFinding {
  claim: string;
  unit_id: string | null;
  cv_evidence: string;
  classification: "contradiction" | "unsupported";
}

export interface UnitView {
  id: string;
  parent_id: string | null;
  type: string;
  difficulty: string;
  is_baseline: boolean;
  question: string;
  answer: string;
  question_start: number;
  answer_start: number;
  answer_end: number;
}

export interface Report {
  units: UnitView[];
  candidate_speaker: string;
  flags: Flag[];
  cv_findings: CvFinding[];
  skipped: { signal: string; reason: string; unit_id: string | null }[];
  adapters: Record<string, string>;
  pipeline_version: string;
}

export interface Word {
  text: string;
  start: number;
  end: number;
  speaker: string;
}

export interface Transcript {
  words: Word[];
  duration: number;
}

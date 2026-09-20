// Mirrors backend/src/interview_review/models.py. Keep the two in step by hand; there are ~10 shapes.

export type Status = "processing" | "ready" | "failed";
export type Family = "timing" | "delivery" | "content" | "visual" | "canary";
export type Confidence = "low" | "medium" | "high";
export type AiTextClass = "human" | "mixed" | "ai";
export type DeliveryClass = "normal" | "medium" | "abnormal";
export type AlignmentLevel = "high" | "medium" | "low";

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
  consent?: { attested_by: string; attested_at: string; text_version: string };
  /** Live rooms only: when the interview is planned to happen. */
  scheduled_for?: string | null;
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
  classification: "contradiction";
  transcript_quote: string;
  start: number | null;
  end: number | null;
}

export interface SentenceAiScore {
  text: string;
  start: number;
  end: number;
  score: number;
  cls: AiTextClass;
}

export interface UnitAiText {
  unit_id: string;
  overall_class: AiTextClass;
  overall_score: number;
  sentences: SentenceAiScore[];
}

export interface AiTextSummary {
  dominant_class: AiTextClass;
  counts: Record<string, number>;
  analyzed_count: number;
}

export interface CvAlignment {
  level: AlignmentLevel;
  contradiction_count: number;
  checked_count: number;
}

export interface DeliveryPattern {
  overall_class: DeliveryClass;
  description: string;
}

export interface UnitHiddenPrompt {
  unit_id: string;
  followed: boolean;
  rationale: string;
  start: number | null;
  end: number | null;
}

/** How many answers carried out the instruction hidden on the candidate's screen. */
export interface HiddenPromptResult {
  instruction: string;
  /** false: an uploaded recording, checked against the standard prompt it was never shown. */
  shown_to_candidate?: boolean;
  checked_count: number;
  matched_count: number;
  units: UnitHiddenPrompt[];
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
  signals: Signal[];
  flags: Flag[];
  cv_findings: CvFinding[];
  skipped: { signal: string; reason: string; unit_id: string | null }[];
  adapters: Record<string, string>;
  pipeline_version: string;
  ai_text_summary: AiTextSummary | null;
  ai_text: UnitAiText[];
  cv_alignment: CvAlignment | null;
  delivery_pattern: DeliveryPattern | null;
  hidden_prompt?: HiddenPromptResult | null;
  summary_note: string;
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

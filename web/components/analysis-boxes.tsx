"use client";

import type { AiTextClass, DeliveryClass, AlignmentLevel, Report } from "@/lib/types";

export type HighlightMode = "ai" | "cv" | "delivery";

const AI_CLASS_HELP: Record<AiTextClass, string> = {
  human: "Human: no AI-text markers found in this wording.",
  mixed: "Mixed: some wording resembles AI-generated phrasing.",
  ai: "AI-generated: this wording closely matches AI-generated text.",
};

const DELIVERY_HELP: Record<DeliveryClass, string> = {
  normal: "Pauses, fillers, and rhythm were within this candidate's own normal range.",
  medium: "Some pauses, fillers, or pacing deviated from this candidate's own normal range.",
  abnormal: "Pauses, fillers, or pacing deviated strongly from this candidate's own normal range.",
};

const ALIGNMENT_HELP: Record<AlignmentLevel, string> = {
  high: "No contradictions found between what was said and the CV.",
  medium: "One contradiction found between what was said and the CV.",
  low: "Multiple contradictions found between what was said and the CV.",
};

interface Props {
  report: Report;
  active: HighlightMode | null;
  onToggle: (mode: HighlightMode) => void;
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="cursor-help rounded-full border border-border px-2.5 py-0.5 text-xs capitalize">
      {children}
    </span>
  );
}

export function AnalysisBoxes({ report, active, onToggle }: Props) {
  const box = (mode: HighlightMode) =>
    `rounded-lg border p-4 text-left transition-colors hover:bg-bg ${
      active === mode
        ? mode === "ai"
          ? "border-hl-ai ring-2 ring-hl-ai/40"
          : "border-mark-strong ring-2 ring-mark-strong/40"
        : "border-border bg-surface"
    }`;

  const ai = report.ai_text_summary;
  const cv = report.cv_alignment ?? { level: "high" as const, contradiction_count: 0, checked_count: 0 };
  const delivery = report.delivery_pattern;

  return (
    <div className="grid grid-cols-1 gap-3">
      {ai ? (
        <button type="button" onClick={() => onToggle("ai")} className={box("ai")}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">AI-text detection</p>
          <div className="mt-2">
            <Badge title={AI_CLASS_HELP[ai.dominant_class]}>{ai.dominant_class}</Badge>
          </div>
          <p className="mt-2 text-xs text-muted">
            {ai.counts.human ?? 0} human · {ai.counts.mixed ?? 0} mixed · {ai.counts.ai ?? 0} ai, across {ai.analyzed_count} answer
            {ai.analyzed_count === 1 ? "" : "s"}
          </p>
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-4 opacity-60">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">AI-text detection</p>
          <p className="mt-2 text-sm text-muted">Not analyzed.</p>
        </div>
      )}

      <button type="button" onClick={() => onToggle("cv")} className={box("cv")} disabled={cv.checked_count === 0}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">CV alignment</p>
        <div className="mt-2">
          {cv.checked_count > 0 ? (
            <Badge title={ALIGNMENT_HELP[cv.level]}>{cv.level}</Badge>
          ) : (
            <span className="text-sm text-muted">Not analyzed</span>
          )}
        </div>
        {cv.checked_count > 0 && (
          <p className="mt-2 text-xs text-muted">
            {cv.contradiction_count} contradiction{cv.contradiction_count === 1 ? "" : "s"} across {cv.checked_count} answer
            {cv.checked_count === 1 ? "" : "s"} checked
          </p>
        )}
      </button>

      {delivery ? (
        <button type="button" onClick={() => onToggle("delivery")} className={box("delivery")}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Delivery &amp; rhythm</p>
          <div className="mt-2">
            <Badge title={DELIVERY_HELP[delivery.overall_class]}>{delivery.overall_class}</Badge>
          </div>
          <p className="mt-2 text-xs text-muted">{delivery.description}</p>
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-4 opacity-60">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Delivery &amp; rhythm</p>
          <p className="mt-2 text-sm text-muted">Not analyzed.</p>
        </div>
      )}
    </div>
  );
}

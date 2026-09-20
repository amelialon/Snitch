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
    <span title={title} className="inline-flex h-6 cursor-help items-center rounded-full border border-border bg-surface px-2.5 text-[12.5px] capitalize">
      {children}
    </span>
  );
}

export function AnalysisBoxes({ report, active, onToggle }: Props) {
  const box = (mode: HighlightMode) =>
    `w-full rounded-[10px] border bg-surface px-4 py-3.5 text-left transition-colors hover:bg-bg disabled:cursor-default disabled:hover:bg-surface ${
      active === mode ? "border-accent ring-2 ring-flag-ai" : "border-border"
    }`;

  const ai = report.ai_text_summary;
  const cv = report.cv_alignment ?? { level: "high" as const, contradiction_count: 0, checked_count: 0 };
  const delivery = report.delivery_pattern;

  return (
    <div className="grid grid-cols-1 gap-2.5">
      {ai ? (
        <button type="button" onClick={() => onToggle("ai")} className={box("ai")}>
          <p className="eyebrow">AI-text detection</p>
          <div className="mt-2">
            <Badge title={AI_CLASS_HELP[ai.dominant_class]}>{ai.dominant_class}</Badge>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            {ai.counts.human ?? 0} human · {ai.counts.mixed ?? 0} mixed · {ai.counts.ai ?? 0} ai, across {ai.analyzed_count} answer
            {ai.analyzed_count === 1 ? "" : "s"}
          </p>
        </button>
      ) : (
        <div className="rounded-[10px] border border-border bg-surface px-4 py-3.5 opacity-60">
          <p className="eyebrow">AI-text detection</p>
          <p className="mt-2 text-sm text-muted">Not analyzed.</p>
        </div>
      )}

      <button type="button" onClick={() => onToggle("cv")} className={box("cv")} disabled={cv.checked_count === 0}>
        <p className="eyebrow">CV alignment</p>
        <div className="mt-2">
          {cv.checked_count > 0 ? (
            <Badge title={ALIGNMENT_HELP[cv.level]}>{cv.level}</Badge>
          ) : (
            <span className="text-sm text-muted">Not analyzed</span>
          )}
        </div>
        {cv.checked_count > 0 && (
          <p className="mt-2 text-[12.5px] text-muted">
            {cv.contradiction_count} contradiction{cv.contradiction_count === 1 ? "" : "s"} across {cv.checked_count} answer
            {cv.checked_count === 1 ? "" : "s"} checked
          </p>
        )}
      </button>

      {delivery ? (
        <button type="button" onClick={() => onToggle("delivery")} className={box("delivery")}>
          <p className="eyebrow">Delivery &amp; rhythm</p>
          <div className="mt-2">
            <Badge title={DELIVERY_HELP[delivery.overall_class]}>{delivery.overall_class}</Badge>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">{delivery.description}</p>
        </button>
      ) : (
        <div className="rounded-[10px] border border-border bg-surface px-4 py-3.5 opacity-60">
          <p className="eyebrow">Delivery &amp; rhythm</p>
          <p className="mt-2 text-sm text-muted">Not analyzed.</p>
        </div>
      )}
    </div>
  );
}

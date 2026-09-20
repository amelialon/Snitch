"use client";

import { clock } from "@/lib/api";
import type { AiTextClass, DeliveryClass, AlignmentLevel, Flag, Report } from "@/lib/types";

export type HighlightMode = "ai" | "cv" | "hidden" | "delivery";

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

const HIDDEN_PROMPT_HELP =
  "An answer matches when it carries out the instruction that was hidden, nearly invisibly, on the candidate's screen. One signal, never proof on its own.";

interface Props {
  report: Report;
  active: HighlightMode | null;
  onToggle: (mode: HighlightMode) => void;
  /** Hovering (or focusing) a box previews its highlights; null when the pointer leaves. */
  onHover: (mode: HighlightMode | null) => void;
  onJumpToFlag: (flag: Flag) => void;
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-6 cursor-help items-center rounded-full border border-border bg-surface px-2.5 text-[12.5px] capitalize">
      {children}
    </span>
  );
}

export function AnalysisBoxes({ report, active, onToggle, onHover, onJumpToFlag }: Props) {
  const hover = (mode: HighlightMode) => ({
    onMouseEnter: () => onHover(mode),
    onMouseLeave: () => onHover(null),
    onFocus: () => onHover(mode),
    onBlur: () => onHover(null),
  });
  // Every box highlights in red, so whichever one is showing gets a red frame.
  const frame = (mode: HighlightMode) => (active === mode ? "border-ai-red ring-2 ring-ai-red/25" : "border-border");
  const box = (mode: HighlightMode) =>
    `w-full rounded-[10px] border bg-surface px-4 py-3.5 text-left transition-colors hover:bg-bg disabled:cursor-default disabled:hover:bg-surface ${frame(mode)}`;
  const idle = "rounded-[10px] border border-border bg-surface px-4 py-3.5 opacity-60";

  const ai = report.ai_text_summary;
  const cv = report.cv_alignment ?? { level: "high" as const, contradiction_count: 0, checked_count: 0 };
  const hidden = report.hidden_prompt;
  const delivery = report.delivery_pattern;

  return (
    <div className="grid grid-cols-1 gap-2.5">
      {/* AI-text detection, with the flagged time ranges. Chips are buttons, so they sit beside the toggle, not inside it. */}
      <div className={`rounded-[10px] border bg-surface ${frame("ai")}`} {...hover("ai")}>
        {ai ? (
          <button type="button" onClick={() => onToggle("ai")} className="w-full rounded-[10px] px-4 py-3.5 text-left transition-colors hover:bg-bg">
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
          <div className="px-4 py-3.5 opacity-60">
            <p className="eyebrow">AI-text detection</p>
            <p className="mt-2 text-sm text-muted">Not analyzed.</p>
          </div>
        )}
        {report.flags.length > 0 && (
          <div className="border-t border-border px-4 pb-3.5 pt-3">
            <p className="eyebrow">Flagged moments</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {report.flags.map((flag) => (
                <button
                  key={flag.id}
                  type="button"
                  onClick={() => onJumpToFlag(flag)}
                  title="Jump to this moment"
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-ai-red-soft px-2.5 font-mono text-[12.5px] font-medium text-ai-red-text hover:brightness-95"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
                  {clock(flag.start)} - {clock(flag.end)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button type="button" onClick={() => onToggle("cv")} {...hover("cv")} className={box("cv")} disabled={cv.checked_count === 0}>
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

      {hidden ? (
        <button
          type="button"
          onClick={() => onToggle("hidden")}
          {...hover("hidden")}
          className={box("hidden")}
          disabled={hidden.matched_count === 0}
          title={HIDDEN_PROMPT_HELP}
        >
          <p className="eyebrow">Hidden prompt</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-[26px] font-semibold leading-none ${hidden.matched_count > 0 ? "text-ai-red" : ""}`}>
              {hidden.matched_count}
            </span>
            <span className="text-[13px] text-muted">
              of {hidden.checked_count} question{hidden.checked_count === 1 ? "" : "s"} matched
            </span>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            {hidden.matched_count === 0
              ? "No answer carried out the instruction hidden on the candidate's screen."
              : `Answered as the hidden instruction asked (${hidden.instruction}).`}
          </p>
          {hidden.shown_to_candidate === false && (
            <p className="mt-1 text-[12.5px] text-muted">
              Not a live-room recording: the candidate was not shown this instruction, so a match here is not evidence of assistance.
            </p>
          )}
        </button>
      ) : (
        <div className={idle}>
          <p className="eyebrow">Hidden prompt</p>
          <p className="mt-2 text-sm text-muted">
            {report.skipped.find((s) => s.signal === "hidden_prompt")?.reason ?? "Not analyzed."}
          </p>
        </div>
      )}

      {delivery ? (
        <button type="button" onClick={() => onToggle("delivery")} {...hover("delivery")} className={box("delivery")}>
          <p className="eyebrow">Delivery &amp; rhythm</p>
          <div className="mt-2">
            <Badge title={DELIVERY_HELP[delivery.overall_class]}>{delivery.overall_class}</Badge>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">{delivery.description}</p>
        </button>
      ) : (
        <div className={idle}>
          <p className="eyebrow">Delivery &amp; rhythm</p>
          <p className="mt-2 text-sm text-muted">Not analyzed.</p>
        </div>
      )}
    </div>
  );
}

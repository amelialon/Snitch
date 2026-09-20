"use client";

import { useState } from "react";
import type { Family, Feedback, Flag } from "@/lib/types";

const FAMILY_LABEL: Record<Family, string> = {
  timing: "Timing",
  delivery: "Delivery",
  content: "Content",
  visual: "Visual",
  canary: "Canary",
};

const CONFIDENCE_HELP = {
  low: "Two kinds of evidence agree, at moderate strength.",
  medium: "Two kinds of evidence agree strongly, or three kinds agree.",
  high: "Three or more kinds of evidence agree, including one that is hard to explain otherwise.",
};

interface Props {
  flag: Flag;
  selected: boolean;
  feedback?: Feedback;
  onFeedback: (useful: boolean, reason: string) => Promise<void>;
}

/** A flagged moment: just its short summary. The ordinary explanations, the verification question, the
 *  measurements and the feedback controls stay one click away, because every flag must carry them. */
export function FlagCard({ flag, selected, feedback, onFeedback }: Props) {
  const [reason, setReason] = useState(feedback?.reason ?? "");
  const [saving, setSaving] = useState(false);

  const families = flag.families.map((family) => ({
    family,
    notes: flag.signals.filter((s) => s.family === family).map((s) => s.evidence.note),
  }));

  async function send(useful: boolean) {
    setSaving(true);
    await onFeedback(useful, reason).finally(() => setSaving(false));
  }

  const choice = (useful: boolean) =>
    `btn h-8 px-3 text-[13px] ${feedback?.useful === useful ? "btn-primary" : "btn-ghost"}`;

  return (
    <article
      id={flag.id}
      className={`space-y-3 rounded-[10px] border bg-surface p-[18px] ${selected ? "border-ai-red ring-2 ring-ai-red/25" : "border-border"}`}
    >
      <p className="text-[14.5px] leading-relaxed">{flag.explanation}</p>

      <details className="text-sm">
        <summary className="eyebrow cursor-pointer">More detail</summary>
        <div className="mt-3 space-y-4">
          <p className="text-[13.5px] text-muted">
            <span className="font-medium capitalize text-text">{flag.confidence} confidence.</span> {CONFIDENCE_HELP[flag.confidence]}
          </p>

          <div>
            <p className="eyebrow">What was measured</p>
            <dl className="mt-2 space-y-2">
              {families.map(({ family, notes }) => (
                <div key={family}>
                  <dt className="text-xs font-medium">{FAMILY_LABEL[family]}</dt>
                  {notes.map((note) => (
                    <dd key={note} className="text-sm text-muted">
                      {note}
                    </dd>
                  ))}
                </div>
              ))}
            </dl>
          </div>

          <div>
            <p className="eyebrow">Ordinary explanations to rule out</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-normal text-muted">
              {flag.alternative_explanations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-flag-ai bg-mark px-3.5 py-3">
            <p className="eyebrow text-mark-text">How to check</p>
            <p className="mt-1.5 text-[14.5px] leading-normal">{flag.verification_prompt}</p>
          </div>

          <footer className="flex flex-wrap items-center gap-2.5 border-t border-border pt-3.5">
            <span className="text-[13px] text-muted">Was this worth your time?</span>
            <button type="button" disabled={saving} onClick={() => send(true)} className={choice(true)}>
              Useful
            </button>
            <button type="button" disabled={saving} onClick={() => send(false)} className={choice(false)}>
              Not useful
            </button>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why? (optional)"
              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13.5px] outline-none placeholder:text-muted focus:border-accent"
            />
          </footer>
        </div>
      </details>
    </article>
  );
}

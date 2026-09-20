"use client";

import { useState } from "react";
import { clock } from "@/lib/api";
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
  question: string;
  selected: boolean;
  feedback?: Feedback;
  onJump: () => void;
  onFeedback: (useful: boolean, reason: string) => Promise<void>;
}

export function FlagCard({ flag, question, selected, feedback, onJump, onFeedback }: Props) {
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
      className={`space-y-3.5 rounded-[10px] border bg-surface p-[18px] ${selected ? "border-mark-strong ring-2 ring-flag-ai" : "border-flag-ai"}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onJump}
          className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-flag-ai px-2.5 font-mono text-[12.5px] font-medium text-mark-text hover:bg-mark-strong/30"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
          {clock(flag.start)} - {clock(flag.end)}
        </button>
        <span title={CONFIDENCE_HELP[flag.confidence]} className="inline-flex h-6 cursor-help items-center rounded-full border border-border bg-surface px-2.5 text-[12.5px] capitalize">
          {flag.confidence} confidence
        </span>
        {flag.families.map((f) => (
          <span key={f} className="inline-flex h-6 items-center rounded-full bg-bg px-2.5 text-[12.5px] text-muted">
            {FAMILY_LABEL[f]}
          </span>
        ))}
      </header>

      <div>
        <p className="eyebrow">Question</p>
        <p className="mt-1.5 text-[14.5px] leading-normal">{question}</p>
      </div>

      <p className="text-[14.5px] leading-relaxed">{flag.explanation}</p>

      <details className="text-sm">
        <summary className="eyebrow cursor-pointer">What was measured</summary>
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
      </details>

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
    </article>
  );
}

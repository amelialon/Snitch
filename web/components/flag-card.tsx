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
    `rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
      feedback?.useful === useful ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-bg"
    }`;

  return (
    <article
      id={flag.id}
      className={`rounded-lg border bg-surface p-5 ${selected ? "border-mark-strong ring-2 ring-mark-strong/40" : "border-border"}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onJump}
          className="rounded-md bg-mark px-2 py-1 font-mono text-xs font-medium text-mark-text hover:bg-mark-strong/50"
        >
          ▶ {clock(flag.start)} – {clock(flag.end)}
        </button>
        <span title={CONFIDENCE_HELP[flag.confidence]} className="cursor-help rounded-full border border-border px-2.5 py-0.5 text-xs capitalize">
          {flag.confidence} confidence
        </span>
        {flag.families.map((f) => (
          <span key={f} className="rounded-full bg-bg px-2.5 py-0.5 text-xs text-muted">
            {FAMILY_LABEL[f]}
          </span>
        ))}
      </header>

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Question</p>
      <p className="mt-1 text-sm">{question}</p>

      <p className="mt-4 text-sm leading-relaxed">{flag.explanation}</p>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">What was measured</summary>
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

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Ordinary explanations to rule out</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
          {flag.alternative_explanations.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4 rounded-md border border-border bg-bg p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">How to check</p>
        <p className="mt-1 text-sm">{flag.verification_prompt}</p>
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <span className="text-xs text-muted">Was this worth your time?</span>
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
          className="min-w-40 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
        />
      </footer>
    </article>
  );
}

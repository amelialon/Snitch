"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createInterview } from "@/lib/api";

const CONTEXT_FLAGS = [
  ["notes_permitted", "Notes were permitted", "Reading-style delivery is not counted."],
  ["open_book", "Open-book interview", ""],
  ["take_home_discussed", "A take-home was discussed", "Prepared, polished answers are expected."],
  ["interpreter_present", "An interpreter or third person was present", ""],
] as const;

const CONSENT_TEXT =
  "The candidate was told this interview would be recorded and analysed by automated tools, and agreed to both.";

/** A form row: heading and reason on the left, the fields on the right. */
function Section({ title, why, accent, children }: { title: string; why?: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid grid-cols-[220px_minmax(0,1fr)] gap-8 border-t py-7 ${accent ? "border-accent" : "border-border"}`}>
      <div>
        <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
        {why && <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{why}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function NewReview() {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const flags = Object.fromEntries(CONTEXT_FLAGS.map(([key]) => [key, form.get(key) === "on"]));
    CONTEXT_FLAGS.forEach(([key]) => form.delete(key));
    form.set("context_flags", JSON.stringify(flags));
    form.set("consent_attested", String(consent));
    for (const optional of ["cv", "cover_letter"]) {
      const file = form.get(optional);
      if (file instanceof File && file.size === 0) form.delete(optional);
    }

    setError("");
    setProgress(0);
    try {
      const interview = await createInterview(form, setProgress);
      router.push(`/i/${interview.id}`);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  }

  const busy = progress !== null;
  // The progress bar measures browser → API only. At 100% the API is still copying the recording
  // into storage, which can take minutes on a slow network, so say that instead of a stuck "100%".
  const storing = progress !== null && progress >= 1;
  const field =
    "h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14.5px] outline-none placeholder:text-muted focus:border-accent focus:ring-[3px] focus:ring-mark";
  const file =
    "block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text";
  const check = "flex items-start gap-3 text-[14.5px] leading-snug";
  const box = "mt-1 size-4 shrink-0 accent-(--accent)";

  return (
    <form onSubmit={submit} className="max-w-[860px]">
      <header className="max-w-[760px] space-y-2.5 pb-7">
        <h1 className="text-[38px] leading-none">New review</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Upload a recorded interview. You get back a few moments worth a second look, with the evidence for each, and you make the call.
        </p>
      </header>

      <Section title="Candidate">
        <input name="candidate_label" required placeholder="Name or reference" aria-label="Candidate" className={`${field} max-w-[420px]`} />
      </Section>

      <Section title="Recording" why="Video or audio, up to 2 GB. Without a speech-to-text key configured, upload a transcript .json instead.">
        <input name="recording" type="file" required accept=".mp4,.webm,.mov,.mkv,.m4v,.mp3,.wav,.m4a,.ogg,.json" className={file} />
      </Section>

      <Section title="Documents" why="Optional. Used only to compare spoken claims with what the CV says.">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[13px] font-medium">
            CV
            <input name="cv" type="file" accept=".pdf,.txt,.md" className={`${file} mt-1.5`} />
          </label>
          <label className="block text-[13px] font-medium">
            Cover letter
            <input name="cover_letter" type="file" accept=".pdf,.txt,.md" className={`${file} mt-1.5`} />
          </label>
        </div>
      </Section>

      <Section title="Conditions" why="These change what counts as evidence, so nobody is penalised for allowed behaviour.">
        <div className="space-y-3.5">
          {CONTEXT_FLAGS.map(([key, label, hint]) => (
            <label key={key} className={check}>
              <input type="checkbox" name={key} className={box} />
              <span>
                {label}
                {hint && <span className="block text-[13px] text-muted">{hint}</span>}
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Consent" why="Required before anything is uploaded." accent>
        <div className="space-y-4">
          <label className={check}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className={box} />
            <span>{CONSENT_TEXT}</span>
          </label>
          <label className="block max-w-[420px] text-[13px] font-medium">
            Attested by
            <input name="attested_by" required placeholder="Your name or email" className={`${field} mt-1.5 font-normal`} />
          </label>
        </div>
      </Section>

      {error && <p className="pb-4 text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-5 border-t border-border pt-7">
        <button type="submit" disabled={!consent || busy} className="btn btn-primary">
          {storing ? "Storing recording…" : busy ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : "Upload and review"}
        </button>
        <span className="text-[13.5px] text-muted">
          {storing
            ? "Received. Saving the recording to storage can take a few minutes on a slow connection. Keep this tab open."
            : !consent
              ? "Consent is required before anything is uploaded."
              : "Takes about as long as the recording. Files stay in your workspace and can be deleted at any time."}
        </span>
      </div>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createInterview } from "@/lib/api";

const CONTEXT_FLAGS = [
  ["notes_permitted", "Notes were permitted", "Reading-style delivery will not be counted as evidence."],
  ["open_book", "Open-book interview", "Looking things up was allowed."],
  ["take_home_discussed", "A take-home was discussed", "Prepared, polished answers are expected."],
  ["interpreter_present", "An interpreter or third person was present", ""],
] as const;

const CONSENT_TEXT =
  "I confirm the candidate was told this interview would be recorded and analyzed by automated tools, and agreed to both.";

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
  const field = "mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm";
  const file =
    "mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text";

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New review</h1>
        <p className="mt-1 text-sm text-muted">
          Upload a recorded interview. You will get back a few moments worth a second look, with the evidence for each.
        </p>
      </div>

      <section className="space-y-4">
        <label className="block text-sm font-medium">
          Candidate
          <input name="candidate_label" required placeholder="Name or reference" className={field} />
        </label>
        <label className="block text-sm font-medium">
          Recording
          <input name="recording" type="file" required accept=".mp4,.webm,.mov,.mkv,.m4v,.mp3,.wav,.m4a,.ogg,.json" className={file} />
          <span className="mt-1 block text-xs font-normal text-muted">
            Video or audio. Without a speech-to-text key configured, upload a transcript .json instead.
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            CV <span className="font-normal text-muted">(optional)</span>
            <input name="cv" type="file" accept=".pdf,.txt,.md" className={file} />
          </label>
          <label className="block text-sm font-medium">
            Cover letter <span className="font-normal text-muted">(optional)</span>
            <input name="cover_letter" type="file" accept=".pdf,.txt,.md" className={file} />
          </label>
        </div>
      </section>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Interview conditions</legend>
        <p className="text-xs text-muted">These change what counts as evidence, so honest candidates are not penalized for allowed behaviour.</p>
        {CONTEXT_FLAGS.map(([key, label, hint]) => (
          <label key={key} className="flex items-start gap-3 text-sm">
            <input type="checkbox" name={key} className="mt-0.5 size-4 accent-(--accent)" />
            <span>
              {label}
              {hint && <span className="block text-xs text-muted">{hint}</span>}
            </span>
          </label>
        ))}
      </fieldset>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Consent</h2>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-4 accent-(--accent)"
          />
          <span>{CONSENT_TEXT}</span>
        </label>
        <label className="block text-sm font-medium">
          Your name or email
          <input name="attested_by" required placeholder="Recorded with the attestation" className={field} />
        </label>
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={!consent || busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {storing ? "Storing recording…" : busy ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : "Upload and review"}
        </button>
        {!consent && <span className="text-xs text-muted">Consent is required before anything is uploaded.</span>}
        {storing && (
          <span className="text-xs text-muted">Received. Saving the recording to storage can take a few minutes on a slow connection — keep this tab open.</span>
        )}
      </div>
    </form>
  );
}

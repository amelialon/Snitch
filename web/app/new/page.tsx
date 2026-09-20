"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createInterview, getInterview, uploadLiveRecording } from "@/lib/api";
import { recoverRecording, removeRecording, type SavedRecording } from "@/lib/recording-store";

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

export default function NewReviewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <NewReview />
    </Suspense>
  );
}

/** A recording that came from the live room, kept in this browser until the review is created. */
interface LiveRecording {
  session: SavedRecording;
  blob: Blob;
}

function NewReview() {
  const router = useRouter();
  // /new?live=<id>: the interview was just filmed in the live room. The form is pre-filled from
  // the room and its recording, and submitting starts the review on that same interview.
  const live = useSearchParams().get("live");
  const [label, setLabel] = useState("");
  const [attestedBy, setAttestedBy] = useState("");
  const [recording, setRecording] = useState<LiveRecording | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [notice, setNotice] = useState("");
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!live) return;
    let stop = false;
    getInterview(live)
      .then(({ interview }) => {
        if (stop) return;
        setLabel(interview.candidate_label);
        setAttestedBy(interview.consent?.attested_by ?? "");
      })
      .catch((e: Error) => !stop && setError(e.message));
    recoverRecording(live)
      .then((found) => {
        if (stop) return;
        if (found && found.blob.size) setRecording(found);
        else setNotice("No recording from this room is saved in this browser. Choose the recording file to upload instead.");
      })
      .catch(() => !stop && setNotice("Could not read the saved recording from this browser. Choose the recording file to upload instead."));
    return () => {
      stop = true;
    };
  }, [live]);

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
      const chosen = form.get("recording");
      const useSaved = !!live && !!recording && !(chosen instanceof File && chosen.size > 0);
      if (live && (useSaved || chosen instanceof File)) {
        // The live room's interview becomes the review: same id, so the list carries on from "live".
        form.delete("candidate_label");
        const blob = useSaved ? recording!.blob : (chosen as File);
        if (useSaved) form.delete("recording");
        const reviewId = await uploadLiveRecording(live, recording?.session.id ?? crypto.randomUUID(), blob, setProgress, form);
        if (recording) await removeRecording(recording.session.id).catch(() => {});
        router.push(`/i/${reviewId}`);
        return;
      }
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
          {live
            ? "The interview has been recorded. Add anything else that should go into the review, then start it."
            : "Upload a recorded interview. You get back a few moments worth a second look, with the evidence for each, and you make the call."}
        </p>
        {notice && <p className="text-[13.5px] text-danger">{notice}</p>}
      </header>

      <Section title="Candidate" why={live ? "From the live room." : undefined}>
        <input
          name="candidate_label"
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          readOnly={!!live}
          placeholder="Name or reference"
          aria-label="Candidate"
          className={`${field} max-w-[420px] ${live ? "text-muted" : ""}`}
        />
      </Section>

      <Section title="Recording" why={recording ? "Recorded in the live room and kept in this browser until the review starts." : "Video or audio, up to 2 GB. Without a speech-to-text key configured, upload a transcript .json instead."}>
        {recording && !replacing ? (
          <div className="flex items-center gap-4 rounded-lg border border-dashed border-border bg-surface px-4 py-3.5">
            <div className="flex-1">
              <p className="text-[14.5px] font-medium">
                interview-{live}.{recording.blob.type.includes("mp4") ? "mp4" : "webm"}
              </p>
              <p className="font-mono text-[12.5px] text-muted">{(recording.blob.size / 1_000_000).toFixed(1)} MB</p>
            </div>
            <button type="button" onClick={() => setReplacing(true)} className="btn btn-ghost h-[34px] px-3 text-[13px]">
              Replace
            </button>
          </div>
        ) : (
          <input name="recording" type="file" required={!recording} accept=".mp4,.webm,.mov,.mkv,.m4v,.mp3,.wav,.m4a,.ogg,.json" className={file} />
        )}
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
            <input
              name="attested_by"
              required
              value={attestedBy}
              onChange={(e) => setAttestedBy(e.target.value)}
              placeholder="Your name or email"
              className={`${field} mt-1.5 font-normal`}
            />
          </label>
        </div>
      </Section>

      {error && <p className="pb-4 text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-5 border-t border-border pt-7">
        <button type="submit" disabled={!consent || busy} className="btn btn-primary">
          {storing ? "Storing recording…" : busy ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : live ? "Start review" : "Upload and review"}
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

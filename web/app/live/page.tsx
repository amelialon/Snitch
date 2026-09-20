"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createLiveInterview, listInterviews } from "@/lib/api";
import type { Interview } from "@/lib/types";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** A scheduled room is upcoming until its time passes; then it is simply open, like any other. */
const upcoming = (i: Interview) => i.stage === "live" && !!i.scheduled_for && new Date(i.scheduled_for).getTime() > Date.now();

/** What the rooms list says about one interview that started as a live room. */
function roomState(i: Interview): { text: string; live: boolean } {
  if (upcoming(i)) return { text: "Scheduled", live: false };
  if (i.stage === "live") return { text: "Room open", live: true };
  if (i.status === "ready") return { text: "Ended, review ready", live: false };
  if (i.status === "processing") return { text: `Ended, ${i.stage}`, live: false };
  return { text: "Ended", live: false };
}

/** Upcoming rooms first, soonest at the top; everything else newest first. */
function byRoomOrder(a: Interview, b: Interview): number {
  const ua = upcoming(a), ub = upcoming(b);
  if (ua !== ub) return ua ? -1 : 1;
  if (ua && ub) return new Date(a.scheduled_for!).getTime() - new Date(b.scheduled_for!).getTime();
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

/** datetime-local gives a wall-clock string with no zone; make it an instant in the user's zone. */
const toInstant = (local: string) => (local ? new Date(local).toISOString() : null);

/** The wall-clock form datetime-local expects, in the user's zone. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Next full hour, as a default for the picker. */
function nextHour(): string {
  const d = new Date(Date.now() + 3600_000);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d);
}

export default function LiveInterviews() {
  const router = useRouter();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [label, setLabel] = useState("");
  const [attestedBy, setAttestedBy] = useState("");
  const [consent, setConsent] = useState(false);
  const [later, setLater] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    listInterviews().then(setInterviews).catch(e => setError(e.message)).finally(() => setLoaded(true));
  }, []);

  const field =
    "h-10 w-full max-w-[380px] rounded-lg border border-border bg-surface px-3 text-[14.5px] outline-none placeholder:text-muted focus:border-accent focus:ring-[3px] focus:ring-mark";
  const section = "grid grid-cols-[220px_minmax(0,1fr)] gap-8 border-t border-border py-7";

  return <div className="flex gap-[72px]">
    <form className="w-[640px]" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try {
        const interview = await createLiveInterview(label, attestedBy, consent, later ? toInstant(scheduledFor) : null);
        if (later) { setInterviews(rooms => [interview, ...rooms]); setLabel(""); setBusy(false); }
        else router.push(`/live/${interview.id}`);
      }
      catch (e) { setError((e as Error).message); setBusy(false); }
    }}>
      <header className="space-y-2.5 pb-7">
        <h1 className="text-[38px] leading-none">Live interviews</h1>
        <p className="text-[15px] leading-relaxed text-muted">Meet, share a screen, and record here. Ending the interview creates the review on its own.</p>
      </header>
      {error && <p role="alert" className="pb-4 text-sm text-danger">{error}</p>}

      <div className={section}>
        <h2 className="text-[15px] font-semibold">Candidate</h2>
        <input required maxLength={200} value={label} onChange={e => setLabel(e.target.value)} placeholder="Name or reference" aria-label="Candidate" className={field} />
      </div>

      <div className={section}>
        <div>
          <h2 className="text-[15px] font-semibold">When</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">The room is ready either way; scheduling just keeps it listed until then.</p>
        </div>
        <div className="space-y-3">
          <div role="radiogroup" aria-label="When" className="flex gap-[22px] text-[14.5px]">
            {([false, true] as const).map(v => (
              <label key={String(v)} className="flex items-center gap-2">
                <input type="radio" name="when" checked={later === v} onChange={() => { setLater(v); if (v && !scheduledFor) setScheduledFor(nextHour()); }} className="size-4 accent-(--accent)" />
                {v ? "Schedule for later" : "Right now"}
              </label>
            ))}
          </div>
          {later && (
            <input type="datetime-local" required value={scheduledFor} min={toLocalInput(new Date())} onChange={e => setScheduledFor(e.target.value)} aria-label="Scheduled time" className={field} />
          )}
        </div>
      </div>

      <div className={section}>
        <div>
          <h2 className="text-[15px] font-semibold">Attested by</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">Recorded with the consent confirmation.</p>
        </div>
        <div className="space-y-4">
          <input required maxLength={200} value={attestedBy} onChange={e => setAttestedBy(e.target.value)} placeholder="Your name or email" aria-label="Attested by" className={field} />
          <label className="flex items-start gap-3 text-[14.5px] leading-snug">
            <input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 size-4 shrink-0 accent-(--accent)" />
            The candidate has consented to recording this interview and to automated review.
          </label>
        </div>
      </div>

      <div className="flex items-center gap-5 border-t border-border pt-7">
        <button disabled={busy || !consent} className="btn btn-primary">{busy ? "Creating…" : later ? "Schedule interview" : "Open live room"}</button>
        <span className="text-[13.5px] text-muted">
          {later
            ? "The room appears under Rooms. Open it any time to copy the invitation link for the candidate."
            : "You get an invitation link to send the candidate. Consent is confirmed again in the room before recording starts."}
        </span>
      </div>
    </form>

    <section className="min-w-0 flex-1 pt-[88px]">
      <div className="flex items-baseline justify-between pb-2.5">
        <h2 className="text-[15px] font-semibold">Rooms</h2>
        <span className="text-[12.5px] text-muted">Upcoming first. Open a room to rejoin, or to retry a saved upload.</span>
      </div>
      {!loaded && <p className="border-t border-border py-4 text-sm text-muted">Loading rooms…</p>}
      {loaded && !interviews.length && <p className="border-t border-border py-4 text-sm text-muted">No interviews yet. Create your first room.</p>}
      {[...interviews].sort(byRoomOrder).map(i => {
        const state = roomState(i);
        return (
          <Link key={i.id} href={i.stage === "live" ? `/live/${i.id}` : `/i/${i.id}`} className="group grid grid-cols-[minmax(0,1fr)_170px_170px] items-center gap-6 border-t border-border py-4">
            <span className="truncate text-[15px] font-medium transition-colors group-hover:text-accent">{i.candidate_label}</span>
            <span className={`font-mono text-[13px] ${upcoming(i) ? "text-text" : "text-muted"}`}>{when(i.scheduled_for && i.stage === "live" ? i.scheduled_for : i.created_at)}</span>
            <span className={`inline-flex items-center gap-2 text-sm ${state.live ? "text-accent" : "text-muted"}`}>
              {state.live && <span className="size-2 rounded-full bg-accent" />}
              {state.text}
            </span>
          </Link>
        );
      })}
      {!!interviews.length && <div className="border-t border-border" />}
    </section>
  </div>;
}

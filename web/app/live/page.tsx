"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createLiveInterview, listInterviews } from "@/lib/api";
import type { Interview } from "@/lib/types";

export default function LiveInterviews() {
  const router = useRouter();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [label, setLabel] = useState("");
  const [attestedBy, setAttestedBy] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    listInterviews().then(setInterviews).catch(e => setError(e.message)).finally(() => setLoaded(true));
  }, []);
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Live interviews</h1>
      <p className="mt-2 text-sm text-muted">Meet, share your screen, and record the interview here. End the interview to automatically create a review.</p></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <form className="max-w-xl space-y-4 rounded-lg border border-border bg-surface p-5" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try { const interview = await createLiveInterview(label, attestedBy, consent); router.push(`/live/${interview.id}`); }
      catch (e) { setError((e as Error).message); setBusy(false); }
    }}>
      <h2 className="font-semibold">Start an interview</h2>
      <label className="block text-sm">Candidate label<input required maxLength={200} value={label} onChange={e => setLabel(e.target.value)} className="mt-1 block w-full rounded border border-border bg-bg p-2" /></label>
      <label className="block text-sm">Your name or email<input required maxLength={200} value={attestedBy} onChange={e => setAttestedBy(e.target.value)} className="mt-1 block w-full rounded border border-border bg-bg p-2" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1" />The candidate has consented to recording this interview and automated review.</label>
      <button disabled={busy || !consent} className="rounded-md bg-accent px-4 py-2 text-sm text-accent-fg disabled:opacity-40">{busy ? "Creating…" : "Open live room"}</button>
    </form>
    <section className="space-y-3"><h2 className="font-semibold">Interview rooms</h2>
      {!loaded && <p className="text-sm text-muted">Loading rooms…</p>}
      {loaded && !interviews.length && <p className="text-sm text-muted">No interviews yet. Create your first room above.</p>}
      {interviews.map(i => <Link key={i.id} href={`/live/${i.id}`} className="flex justify-between rounded-lg border border-border bg-surface p-4 text-sm"><span>{i.candidate_label}</span><span className="text-accent">Open room →</span></Link>)}
    </section>
  </div>;
}

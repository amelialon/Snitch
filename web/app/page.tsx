"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { clock, deleteInterview, listInterviews } from "@/lib/api";
import type { Interview } from "@/lib/types";

type Filter = "all" | "week" | "moments" | "processing";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["week", "This week"],
  ["moments", "Flagged"],
  ["processing", "Processing"],
];

function matches(interview: Interview, filter: Filter): boolean {
  switch (filter) {
    case "week":
      return Date.now() - new Date(interview.created_at).getTime() < 7 * 86400_000;
    case "moments":
      return interview.status === "ready" && (interview.summary.flag_count ?? 0) > 0;
    case "processing":
      return interview.stage === "live" || interview.status === "processing";
    default:
      return true;
  }
}

/** What the To review column says for one interview. A count when there is one; never a score. */
function moments(interview: Interview): { text: string; strong: boolean } {
  if (interview.stage === "live") return { text: "In the live room", strong: true };
  if (interview.status === "processing") return { text: `${interview.stage}, ${Math.round(interview.progress * 100)}%`, strong: false };
  if (interview.status === "failed") return { text: "Failed", strong: false };
  const n = interview.summary.flag_count ?? 0;
  return n > 0 ? { text: String(n), strong: true } : { text: "None", strong: false };
}

export default function InterviewList() {
  const [interviews, setInterviews] = useState<Interview[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(interview: Interview) {
    if (!confirm(`Delete ${interview.candidate_label} and everything recorded for them? This cannot be undone.`)) return;
    setDeleting(interview.id);
    try {
      await deleteInterview(interview.id);
      setInterviews((prev) => prev?.filter((i) => i.id !== interview.id) ?? prev);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => {
    let stop = false;
    const load = () =>
      listInterviews()
        .then((found) => !stop && (setInterviews(found), setError("")))
        .catch((e: Error) => !stop && setError(e.message));
    load();
    const timer = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const shown = useMemo(
    () =>
      (interviews ?? []).filter(
        (i) => matches(i, filter) && i.candidate_label.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [interviews, filter, query],
  );

  return (
    <div>
      <header className="flex items-end justify-between gap-6 pb-7">
        <div className="space-y-2.5">
          <h1 className="text-[38px] leading-none">Interviews</h1>
          <p className="text-[15px] text-muted">All your candidate interviews, in one place.</p>
        </div>
        <Link href="/new" className="btn btn-primary">
          New review
        </Link>
      </header>

      {error && <p className="mb-6 text-sm text-danger">{error}</p>}

      <div className="flex items-end justify-between gap-6 pb-1">
        <div className="flex gap-[22px]">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`border-b-2 pb-1.5 text-sm transition-colors ${filter === key ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search candidates"
          aria-label="Search candidates"
          className="w-64 border-b border-border bg-transparent pb-1.5 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_170px_100px_150px] gap-6 py-3 text-[12.5px] text-muted">
        <div>Candidate</div>
        <div>Interviewed</div>
        <div>Length</div>
        <div>To review</div>
      </div>

      {interviews?.length === 0 && (
        <div className="border-t border-border py-10 text-sm text-muted">
          No interviews yet.{" "}
          <Link href="/new" className="text-accent hover:underline">
            Upload the first one
          </Link>
          .
        </div>
      )}

      {shown.map((interview) => {
        const m = moments(interview);
        const busy = deleting === interview.id;
        return (
          <div key={interview.id} className={`group relative border-t border-border transition-opacity ${busy ? "opacity-40" : ""}`}>
            <Link
              href={`/${interview.stage === "live" ? "live" : "i"}/${interview.id}`}
              className="grid grid-cols-[minmax(0,1fr)_170px_100px_150px] items-center gap-6 py-[18px] pr-20"
            >
              <div className="truncate text-[15.5px] font-medium transition-colors group-hover:text-accent">{interview.candidate_label}</div>
              <div className="font-mono text-[13px] text-muted">
                {new Date(interview.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
              <div className="font-mono text-[13px] text-muted">{interview.summary.duration_sec ? clock(interview.summary.duration_sec) : ""}</div>
              <div className={m.strong ? "text-[14.5px] font-medium text-accent" : "text-sm text-muted"}>{m.text}</div>
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => remove(interview)}
              aria-label={`Delete ${interview.candidate_label}`}
              className="absolute right-0 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1.5 text-[13px] text-muted opacity-0 transition-[opacity,color] duration-150 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        );
      })}
      {!!interviews?.length && <div className="border-t border-border" />}
    </div>
  );
}

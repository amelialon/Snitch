"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listInterviews } from "@/lib/api";
import type { Interview } from "@/lib/types";
import { StatusChip } from "@/components/status-chip";

export default function InterviewList() {
  const [interviews, setInterviews] = useState<Interview[] | null>(null);
  const [error, setError] = useState("");

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

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Interviews</h1>
      <p className="mt-1 text-sm text-muted">Newest first. Interviews are never ranked against each other.</p>

      {error && <p className="mt-6 rounded-md border border-border bg-surface p-4 text-sm text-danger">{error}</p>}

      {interviews?.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted">No interviews yet.</p>
          <Link href="/new" className="mt-3 inline-block text-sm font-medium text-accent underline underline-offset-4">
            Upload the first one
          </Link>
        </div>
      )}

      {!!interviews?.length && (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {interviews.map((interview) => (
            <li key={interview.id}>
              <Link href={`/${interview.stage === "live" ? "live" : "i"}/${interview.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-bg">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{interview.candidate_label}</p>
                  <p className="text-xs text-muted">{new Date(interview.created_at).toLocaleString()}</p>
                </div>
                {interview.status === "ready" && (
                  <span className="hidden text-xs text-muted sm:block">
                    {interview.summary.flag_count === 0
                      ? "Nothing to review"
                      : `${interview.summary.flag_count} moment${interview.summary.flag_count === 1 ? "" : "s"} to review`}
                  </span>
                )}
                <StatusChip interview={interview} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clock,
  deleteInterview,
  getInterview,
  getTranscript,
  mediaUrl,
  rerunInterview,
  sendFeedback,
} from "@/lib/api";
import type { Interview, Report, Transcript } from "@/lib/types";
import { FlagCard } from "@/components/flag-card";
import { Timeline } from "@/components/timeline";
import { TranscriptPane } from "@/components/transcript-pane";

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [interview, setInterview] = useState<Interview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      getInterview(id)
        .then(({ interview, report }) => {
          if (stop) return;
          setInterview(interview);
          setReport(report);
          if (report && !transcript) getTranscript(id).then((t) => !stop && setTranscript(t)).catch(() => {});
        })
        .catch((e: Error) => !stop && setError(e.message));
    load();
    const timer = setInterval(() => {
      if (interview?.status === "processing" || !interview) load();
    }, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, interview?.status]);

  const seek = useCallback((seconds: number) => {
    const el = video.current;
    if (el) {
      el.currentTime = seconds;
      el.play().catch(() => {});
    }
    setCurrent(seconds);
  }, []);

  const jumpToFlag = useCallback(
    (flagId: string, start: number) => {
      setSelected(flagId);
      seek(Math.max(0, start - 5)); // start before the question, so the reviewer hears it
    },
    [seek],
  );

  if (error) return <p className="rounded-md border border-border bg-surface p-4 text-sm text-danger">{error}</p>;
  if (!interview) return <p className="text-sm text-muted">Loading…</p>;

  const duration = interview.summary.duration_sec ?? transcript?.duration ?? 0;
  const flagCount = report?.flags.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-muted hover:underline">
            ← All interviews
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{interview.candidate_label}</h1>
        </div>
        <div className="flex gap-2">
          <Link href={`/live/${id}`} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface">
            Live room
          </Link>
          <button
            onClick={() => rerunInterview(id).then(() => setReport(null))}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface"
          >
            Re-run
          </button>
          <button
            onClick={() => {
              if (confirm("Delete this interview and its files?")) deleteInterview(id).then(() => (location.href = "/"));
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-danger hover:bg-surface"
          >
            Delete
          </button>
        </div>
      </div>

      {interview.status === "processing" && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="text-sm font-medium capitalize">{interview.stage}…</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(interview.progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">This page updates on its own.</p>
        </div>
      )}

      {interview.status === "failed" && (
        <div className="rounded-lg border border-danger/40 bg-surface p-6">
          <p className="text-sm font-medium text-danger">This review could not be completed.</p>
          <p className="mt-1 text-sm text-muted">{interview.error}</p>
        </div>
      )}

      {interview.status === "ready" && report && (
        <>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm">
              {flagCount === 0 ? (
                <>No moments were flagged for a second look. That is a normal result.</>
              ) : (
                <>
                  <strong>{flagCount}</strong> moment{flagCount === 1 ? "" : "s"} worth a second look. Each needs your
                  judgement; nothing here is a conclusion.
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-muted">Analyzed by: {Object.entries(report.adapters).map(([k, v]) => `${k}=${v}`).join(", ")}</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,420px)]">
            <div className="space-y-4">
              <video
                ref={video}
                src={mediaUrl(id)}
                controls
                onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
                className="w-full rounded-lg border border-border bg-black"
              />
              {duration > 0 && (
                <Timeline
                  duration={duration}
                  current={current}
                  flags={report.flags}
                  selected={selected}
                  onSeek={seek}
                  onSelect={(f) => jumpToFlag(f.id, f.start)}
                />
              )}
              {transcript && (
                <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border bg-surface p-3">
                  <TranscriptPane
                    units={report.units}
                    words={transcript.words}
                    flags={report.flags}
                    candidate={report.candidate_speaker}
                    current={current}
                    canSeek
                    onSeek={seek}
                  />
                </div>
              )}
            </div>

            <div className="space-y-4">
              <section className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Moments to review</h2>
                {report.flags.length === 0 && <p className="text-sm text-muted">None.</p>}
                {report.flags.map((flag) => {
                  const unit = report.units.find((u) => u.id === flag.unit_id);
                  return (
                    <FlagCard
                      key={flag.id}
                      flag={flag}
                      question={unit?.question ?? ""}
                      selected={selected === flag.id}
                      feedback={interview.feedback[flag.id]}
                      onJump={() => jumpToFlag(flag.id, flag.start)}
                      onFeedback={async (useful, reason) => {
                        await sendFeedback(id, flag.id, useful, reason);
                        setInterview((prev) =>
                          prev
                            ? { ...prev, feedback: { ...prev.feedback, [flag.id]: { useful, reason, at: new Date().toISOString() } } }
                            : prev,
                        );
                      }}
                    />
                  );
                })}
              </section>

              <section className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold">CV / Interview Consistency</h2>
                {report.cv_findings.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">Nothing notable, or no CV was analyzed.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {report.cv_findings.map((finding, i) => {
                      const unit = finding.unit_id ? report.units.find((u) => u.id === finding.unit_id) : null;
                      return (
                        <li key={i} className="text-sm">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize">{finding.classification}</span>
                            {unit && (
                              <button onClick={() => seek(unit.answer_start)} className="font-mono text-xs text-muted hover:text-accent">
                                {clock(unit.answer_start)}
                              </button>
                            )}
                          </div>
                          <p className="mt-1">{finding.claim}</p>
                          <p className="mt-0.5 text-muted">{finding.cv_evidence}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold">Not analyzed</h2>
                {report.skipped.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">All enabled signals ran.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-sm text-muted">
                    {report.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="text-text">{s.signal}:</span> {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

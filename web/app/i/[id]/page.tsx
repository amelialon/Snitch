"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AnalysisBoxes, type HighlightMode } from "@/components/analysis-boxes";
import { FlagCard } from "@/components/flag-card";
import { Timeline } from "@/components/timeline";
import { TranscriptPane, type HighlightSpan } from "@/components/transcript-pane";

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [interview, setInterview] = useState<Interview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode | null>(null);
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

  const highlightSpans = useMemo<Record<HighlightMode, HighlightSpan[]>>(() => {
    if (!report) return { ai: [], cv: [], delivery: [] };
    const ai: HighlightSpan[] = report.ai_text.flatMap((unit) =>
      unit.sentences
        .filter((s) => s.cls !== "human")
        .map((s) => ({
          start: s.start,
          end: s.end,
          cls: s.cls === "ai" ? ("ai" as const) : ("yellow" as const),
          title: s.cls === "ai" ? "Likely AI-generated wording" : "Wording that may reflect AI influence",
        })),
    );
    const cv: HighlightSpan[] = report.cv_findings
      .filter((f) => f.start !== null && f.end !== null)
      .map((f) => ({ start: f.start as number, end: f.end as number, cls: "yellow" as const, title: `CV says: ${f.cv_evidence}` }));
    const delivery: HighlightSpan[] = report.signals
      .filter((s) => (s.family === "timing" || s.family === "delivery") && s.anomalous)
      .map((s) => ({ start: s.evidence.start, end: s.evidence.end, cls: "yellow" as const, title: s.evidence.note }));
    return { ai, cv, delivery };
  }, [report]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!interview) return <p className="text-sm text-muted">Loading…</p>;

  const duration = interview.summary.duration_sec ?? transcript?.duration ?? 0;
  const first = report?.flags[0];
  const when = new Date(interview.created_at).toLocaleString(undefined, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const ghost = "btn btn-ghost h-9 px-3.5 text-[13.5px]";

  return (
    <div>
      <header className="flex items-end justify-between gap-6 border-b border-border pb-6">
        <div className="space-y-2.5">
          <Link href="/" className="text-[13px] text-muted hover:text-text">
            Interviews
          </Link>
          <h1 className="text-4xl leading-none">{interview.candidate_label}</h1>
          <p className="text-[14.5px] text-muted">
            Interviewed {when}.{duration > 0 && <> <span className="font-mono">{clock(duration)}</span>.</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/live/${id}`} className={ghost}>
            Live room
          </Link>
          <button onClick={() => rerunInterview(id).then(() => setReport(null))} className={ghost}>
            Re-run
          </button>
          <button
            onClick={() => {
              if (confirm("Delete this interview and its files?")) deleteInterview(id).then(() => (location.href = "/"));
            }}
            className={`${ghost} text-danger`}
          >
            Delete
          </button>
        </div>
      </header>

      {interview.status === "processing" && (
        <div className="py-6">
          <p className="text-[15px] font-medium capitalize">{interview.stage}…</p>
          <div className="mt-3 h-[3px] max-w-md overflow-hidden rounded-sm bg-border">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(interview.progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-[13px] text-muted">This page updates on its own.</p>
        </div>
      )}

      {interview.status === "failed" && (
        <div className="py-6">
          <p className="text-[15px] font-medium text-danger">This review could not be completed.</p>
          <p className="mt-1 text-sm text-muted">{interview.error}</p>
        </div>
      )}

      {interview.status === "ready" && report && (
        <>
          <p className="max-w-[72ch] py-5 text-base leading-normal">
            {report.flags.length === 0 ? (
              <>No moment was flagged for a second look. That is a normal result.</>
            ) : (
              <>
                {report.flags.length === 1 ? "One moment is" : `${report.flags.length} moments are`} worth a second look
                {first && (
                  <>
                    , starting at <span className="font-mono text-accent">{clock(first.start)}</span>
                  </>
                )}
                . Nothing here is a conclusion; the decision is yours.
              </>
            )}
          </p>

          <div className="grid grid-cols-[minmax(0,1fr)_420px] items-start gap-12">
            {/* Reading column */}
            <div className="min-w-0">
              <div className="flex items-end justify-between gap-4 pb-2">
                <span className="border-b-2 border-accent pb-2 text-sm font-medium">Transcript</span>
                <span className="pb-2 text-[12.5px] text-muted">
                  Follows playback. Click a word to jump.{highlightMode && ` Highlighting ${highlightMode === "ai" ? "AI-text" : highlightMode === "cv" ? "CV" : "delivery"}.`}
                </span>
              </div>
              {transcript ? (
                <TranscriptPane
                  units={report.units}
                  words={transcript.words}
                  flags={report.flags}
                  candidate={report.candidate_speaker}
                  current={current}
                  canSeek
                  onSeek={seek}
                  highlight={highlightMode ? highlightSpans[highlightMode] : undefined}
                />
              ) : (
                <p className="border-t border-border py-5 text-sm text-muted">Loading transcript…</p>
              )}
            </div>

            {/* Rail */}
            <div className="space-y-6">
              <div>
                <video
                  ref={video}
                  src={mediaUrl(id)}
                  controls
                  onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
                  className="aspect-video w-full rounded-[10px] bg-black"
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
              </div>

              <section className="space-y-3">
                <h2 className="eyebrow text-[12.5px] text-text/70">For review</h2>
                <AnalysisBoxes
                  report={report}
                  active={highlightMode}
                  onToggle={(mode) => setHighlightMode((prev) => (prev === mode ? null : mode))}
                />
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

              <section className="space-y-2">
                <h2 className="eyebrow text-[12.5px] text-text/70">Not analyzed</h2>
                {report.skipped.length === 0 ? (
                  <p className="text-[13.5px] text-muted">All enabled signals ran.</p>
                ) : (
                  <ul className="space-y-1.5 text-[13.5px] leading-normal text-muted">
                    {report.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="font-medium text-text">{s.signal}:</span> {s.reason}
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

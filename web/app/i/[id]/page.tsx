"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
import { MarkLoader } from "@/components/mark-loader";
import { Timeline } from "@/components/timeline";
import { TranscriptPane, type HighlightSpan } from "@/components/transcript-pane";

const HIGHLIGHT_LABEL: Record<HighlightMode, string> = {
  ai: "AI-text",
  cv: "CV",
  hidden: "hidden-prompt matches",
  delivery: "delivery",
};

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [interview, setInterview] = useState<Interview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode | null>(null); // pinned by a click
  const [hoverMode, setHoverMode] = useState<HighlightMode | null>(null); // previewed while hovering a box
  const video = useRef<HTMLVideoElement>(null);
  const transcriptScroll = useRef<HTMLDivElement>(null);

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

  // Signals skipped on this interview (short baseline, no audio…) stay visible, per the product
  // rules; a family that simply isn't built ("not enabled") is not a skip and isn't listed.
  const skippedSignals = useMemo(() => (report?.skipped ?? []).filter((s) => !/not enabled/i.test(s.reason)), [report]);

  const highlightSpans = useMemo<Record<HighlightMode, HighlightSpan[]>>(() => {
    if (!report) return { ai: [], cv: [], hidden: [], delivery: [] };
    const ai: HighlightSpan[] = report.ai_text.flatMap((unit) =>
      unit.sentences
        .filter((s) => s.cls !== "human")
        .map((s) => ({
          start: s.start,
          end: s.end,
          cls: s.cls === "ai" ? ("ai" as const) : ("mixed" as const),
          title: s.cls === "ai" ? "Likely AI-generated wording" : "Wording that may reflect AI influence",
        })),
    );
    const answerOf = (unitId: string | null) => {
      const unit = report.units.find((u) => u.id === unitId);
      return unit ? { start: unit.answer_start, end: unit.answer_end } : null;
    };
    // A CV quote that could not be located still marks its answer, as a whole.
    const cv: HighlightSpan[] = report.cv_findings.flatMap((f) => {
      const span = f.start !== null && f.end !== null ? { start: f.start, end: f.end } : answerOf(f.unit_id);
      return span ? [{ ...span, cls: "ai" as const, title: `CV says: ${f.cv_evidence}` }] : [];
    });
    // A pause has no words in it, so a timing anomaly marks the answer that followed it.
    const notesByUnit = new Map<string, string[]>();
    for (const sig of report.signals) {
      if ((sig.family === "timing" || sig.family === "delivery") && sig.anomalous) {
        notesByUnit.set(sig.unit_id, [...(notesByUnit.get(sig.unit_id) ?? []), sig.evidence.note]);
      }
    }
    const delivery: HighlightSpan[] = [...notesByUnit].flatMap(([unitId, notes]) => {
      const span = answerOf(unitId);
      return span ? [{ ...span, cls: "ai" as const, title: notes.join("; ") }] : [];
    });
    const hidden: HighlightSpan[] = (report.hidden_prompt?.units ?? [])
      .filter((u) => u.followed && u.start !== null && u.end !== null)
      .map((u) => ({
        start: u.start as number,
        end: u.end as number,
        cls: "ai" as const,
        title: `Carried out the hidden on-screen instruction: ${u.rationale}`,
      }));
    return { ai, cv, hidden, delivery };
  }, [report]);

  // Hovering a box has to show its highlights even when they sit far down the transcript. After a short
  // pause (so a pointer just passing over does not make things jump), scroll the transcript pane to the
  // first one. Only the pane scrolls, never the page, so the box stays under the pointer.
  useEffect(() => {
    if (!hoverMode) return;
    const timer = setTimeout(() => {
      const pane = transcriptScroll.current;
      if (!pane) return;
      const bounds = pane.getBoundingClientRect();
      const marked = Array.from(pane.querySelectorAll<HTMLElement>("[data-highlighted]"));
      const shown = marked.some((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > bounds.top && r.top < bounds.bottom;
      });
      if (marked.length === 0 || shown) return;
      const first = marked[0].getBoundingClientRect();
      pane.scrollTo({ top: pane.scrollTop + (first.top - bounds.top) - pane.clientHeight / 2 + first.height / 2, behavior: "smooth" });
    }, 250);
    return () => clearTimeout(timer);
  }, [hoverMode]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!interview) return <p className="text-sm text-muted">Loading…</p>;

  const shownMode = hoverMode ?? highlightMode;
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
              if (confirm(`Delete ${interview.candidate_label} and everything recorded for them? This cannot be undone.`))
                deleteInterview(id).then(() => router.push("/")).catch((e: Error) => setError(e.message));
            }}
            className={`${ghost} text-danger`}
          >
            Delete
          </button>
        </div>
      </header>

      {interview.status === "processing" && (
        <MarkLoader label={interview.stage} detail="This page updates on its own." />
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
              <>Nothing flagged for a second look. That is a normal result.</>
            ) : (
              <>
                {report.flags.length === 1 ? "One moment flagged" : `${report.flags.length} moments flagged`} for a second look
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
            <div className="min-w-0 lg:sticky lg:top-6 lg:flex lg:h-[calc(100vh-14rem)] lg:flex-col">
              <div className="flex items-end justify-between gap-4 pb-2">
                <span className="border-b-2 border-accent pb-2 text-sm font-medium">Transcript</span>
                <span className="pb-2 text-[12.5px] text-muted">
                  Follows playback. Click a word to jump.{shownMode && ` Highlighting ${HIGHLIGHT_LABEL[shownMode]}.`}
                </span>
              </div>
              {transcript ? (
                <div ref={transcriptScroll} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-3">
                  <TranscriptPane
                    units={report.units}
                    words={transcript.words}
                    flags={report.flags}
                    candidate={report.candidate_speaker}
                    current={current}
                    canSeek
                    onSeek={seek}
                    highlight={shownMode ? highlightSpans[shownMode] : undefined}
                    hiddenPromptUnits={report.hidden_prompt?.units.filter((u) => u.followed).map((u) => u.unit_id)}
                  />
                </div>
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
                <p className="text-[12.5px] text-muted">Hover a card to highlight it in the transcript; click to keep it on.</p>
                <AnalysisBoxes
                  report={report}
                  active={shownMode}
                  onHover={setHoverMode}
                  onToggle={(mode) => setHighlightMode((prev) => (prev === mode ? null : mode))}
                  onJumpToFlag={(flag) => jumpToFlag(flag.id, flag.start)}
                />
                {report.flags.map((flag) => (
                  <FlagCard
                    key={flag.id}
                    flag={flag}
                    selected={selected === flag.id}
                    feedback={interview.feedback[flag.id]}
                    onFeedback={async (useful, reason) => {
                      await sendFeedback(id, flag.id, useful, reason);
                      setInterview((prev) =>
                        prev
                          ? { ...prev, feedback: { ...prev.feedback, [flag.id]: { useful, reason, at: new Date().toISOString() } } }
                          : prev,
                      );
                    }}
                  />
                ))}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

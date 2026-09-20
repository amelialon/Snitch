"use client";

import { useEffect, useMemo, useRef } from "react";
import { clock } from "@/lib/api";
import type { Flag, UnitView, Word } from "@/lib/types";

export interface HighlightSpan {
  start: number;
  end: number;
  cls: "ai" | "yellow";
  title?: string;
}

interface Props {
  units: UnitView[];
  words: Word[];
  flags: Flag[];
  candidate: string;
  current: number;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  highlight?: HighlightSpan[];
}

/** Consecutive words by one speaker, so each turn can be shown on its own labeled row. */
function speakerRuns(ws: Word[]): { speaker: string; words: Word[] }[] {
  const runs: { speaker: string; words: Word[] }[] = [];
  for (const w of ws) {
    const last = runs[runs.length - 1];
    if (last && last.speaker === w.speaker) last.words.push(w);
    else runs.push({ speaker: w.speaker, words: [w] });
  }
  return runs;
}

/** The interview, exchange by exchange, with interviewer and candidate turns separated. */
export function TranscriptPane({ units, words, flags, candidate, current, canSeek, onSeek, highlight }: Props) {
  const highlightAt = (start: number) => (highlight ?? []).find((h) => start >= h.start - 0.02 && start < h.end + 0.02);
  const flagged = useMemo(() => {
    const ids = new Set(flags.map((f) => f.unit_id));
    return new Set(units.filter((u) => ids.has(u.id) || (u.parent_id && ids.has(u.parent_id))).map((u) => u.id));
  }, [flags, units]);

  const runsByUnit = useMemo(
    () =>
      new Map(
        units.map((u) => [
          u.id,
          speakerRuns(words.filter((w) => w.start >= u.question_start - 0.01 && w.end <= u.answer_end + 0.01)),
        ]),
      ),
    [units, words],
  );

  const active = units.find((u) => current >= u.question_start && current <= u.answer_end)?.id;
  const activeRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <ol>
      {units.map((unit) => {
        const isActive = unit.id === active;
        const isFlagged = flagged.has(unit.id);
        const kind = unit.is_baseline ? "baseline" : unit.type === "autobiographical" ? "about them" : unit.type.replace("_", " ");
        return (
          <li
            key={unit.id}
            ref={isActive ? activeRef : null}
            className={`grid grid-cols-[72px_minmax(0,1fr)] gap-5 py-5 ${
              unit.parent_id ? "border-t-0 pt-0" : `border-t ${isFlagged ? "border-accent" : "border-border"}`
            } ${isActive ? "bg-mark/40" : ""}`}
          >
            <div className={`flex flex-col gap-1 pt-[3px] text-[12.5px] ${isFlagged ? "text-accent" : "text-muted"}`}>
              <button
                type="button"
                disabled={!canSeek}
                onClick={() => onSeek(unit.question_start)}
                className={`text-left font-mono enabled:hover:text-accent ${isFlagged ? "font-medium" : ""}`}
              >
                {clock(unit.question_start)}
              </button>
              <span>{unit.parent_id ? "follow-up" : isFlagged ? "worth a look" : kind}</span>
            </div>

            <div className={unit.parent_id ? "border-l border-border pl-[22px]" : ""}>
              {(runsByUnit.get(unit.id) ?? []).map((run, index) => {
                const isCandidate = run.speaker === candidate;
                return (
                  <div key={run.words[0].start} className={`grid grid-cols-[82px_minmax(0,1fr)] items-start gap-3 ${index ? "mt-3" : ""}`}>
                    <span
                      className={`select-none pt-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] ${isCandidate ? "text-accent" : "text-muted/70"}`}
                    >
                      {isCandidate ? "Candidate" : "Interviewer"}
                    </span>
                    <p
                      className={`m-0 text-[15.5px] leading-[1.65] ${isCandidate ? "" : "text-muted"} ${
                        isCandidate && isFlagged && !unit.parent_id ? "-ml-[17px] pl-3.5 shadow-[inset_3px_0_0_var(--mark-strong)]" : ""
                      }`}
                    >
                      {run.words.map((word) => {
                        const spoken = isActive && current >= word.start && current < word.end + 0.15;
                        // highlights describe the candidate's own wording, never the interviewer's
                        const hit = isCandidate ? highlightAt(word.start) : undefined;
                        const wordClass = spoken
                          ? "rounded-sm bg-accent px-0.5 text-accent-fg"
                          : hit
                            ? hit.cls === "ai"
                              ? "bg-hl-ai text-hl-ai-text [box-decoration-break:clone]"
                              : "bg-hl-warn text-hl-warn-text [box-decoration-break:clone]"
                            : "";
                        return (
                          <span
                            key={word.start}
                            onClick={canSeek ? () => onSeek(word.start) : undefined}
                            title={hit?.title}
                            className={`${canSeek ? "cursor-pointer hover:underline" : ""} ${wordClass}`}
                          >
                            {word.text}{" "}
                          </span>
                        );
                      })}
                    </p>
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

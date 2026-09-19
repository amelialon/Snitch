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
export function TranscriptPane({ units, words, flags, candidate, current, canSeek, onSeek }: Props) {
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
    <ol className="space-y-3">
      {units.map((unit) => {
        const isActive = unit.id === active;
        return (
          <li
            key={unit.id}
            ref={isActive ? activeRef : null}
            className={`rounded-md border p-3 text-sm ${flagged.has(unit.id) ? "border-mark-strong bg-mark/40" : "border-border/60"} ${isActive ? "ring-1 ring-accent" : ""} ${unit.parent_id ? "ml-5" : ""}`}
          >
            <div className="mb-2 flex items-center gap-2 font-mono text-xs text-muted">
              <button type="button" disabled={!canSeek} onClick={() => onSeek(unit.question_start)} className="enabled:hover:text-accent">
                {clock(unit.question_start)}
              </button>
              <span>{unit.is_baseline ? "baseline" : unit.type.replace("_", " ")}</span>
              {unit.parent_id && <span>follow-up</span>}
            </div>

            <div className="space-y-2">
              {(runsByUnit.get(unit.id) ?? []).map((run) => {
                const isCandidate = run.speaker === candidate;
                return (
                  <div key={run.words[0].start} className="flex gap-3">
                    <span
                      className={`w-20 shrink-0 select-none pt-0.5 text-xs font-semibold uppercase tracking-wide ${isCandidate ? "text-accent" : "text-muted"}`}
                    >
                      {isCandidate ? "Candidate" : "Interviewer"}
                    </span>
                    <p className={`flex-1 leading-relaxed ${isCandidate ? "" : "text-muted"}`}>
                      {run.words.map((word) => {
                        const spoken = isActive && current >= word.start && current < word.end + 0.15;
                        return (
                          <span
                            key={word.start}
                            onClick={canSeek ? () => onSeek(word.start) : undefined}
                            className={`${canSeek ? "cursor-pointer hover:underline" : ""} ${spoken ? "rounded-sm bg-accent text-accent-fg" : ""}`}
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

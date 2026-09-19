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

/** The interview, exchange by exchange. Follows playback; flagged exchanges are marked. */
export function TranscriptPane({ units, words, flags, candidate, current, canSeek, onSeek, highlight }: Props) {
  const highlightAt = (start: number) => (highlight ?? []).find((h) => start >= h.start - 0.02 && start < h.end + 0.02);
  const flagged = useMemo(() => {
    const ids = new Set(flags.map((f) => f.unit_id));
    return new Set(units.filter((u) => ids.has(u.id) || (u.parent_id && ids.has(u.parent_id))).map((u) => u.id));
  }, [flags, units]);

  const wordsByUnit = useMemo(
    () =>
      new Map(
        units.map((u) => [u.id, words.filter((w) => w.start >= u.question_start - 0.01 && w.end <= u.answer_end + 0.01)]),
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
            className={`rounded-md border p-3 text-sm ${flagged.has(unit.id) ? "border-mark-strong bg-mark/40" : "border-transparent"} ${isActive ? "ring-1 ring-accent" : ""} ${unit.parent_id ? "ml-5" : ""}`}
          >
            <div className="mb-1 flex items-center gap-2 font-mono text-xs text-muted">
              <button type="button" disabled={!canSeek} onClick={() => onSeek(unit.question_start)} className="enabled:hover:text-accent">
                {clock(unit.question_start)}
              </button>
              <span>{unit.is_baseline ? "baseline" : unit.type.replace("_", " ")}</span>
              {unit.parent_id && <span>follow-up</span>}
            </div>
            <p className="leading-relaxed">
              {(wordsByUnit.get(unit.id) ?? []).map((word, i) => {
                const spoken = isActive && current >= word.start && current < word.end + 0.15;
                const hit = highlight ? highlightAt(word.start) : undefined;
                const highlightClass = hit
                  ? hit.cls === "ai"
                    ? "rounded-sm bg-hl-ai px-0.5 text-hl-ai-text"
                    : "rounded-sm bg-hl-warn px-0.5 text-hl-warn-text"
                  : spoken
                    ? "rounded-sm bg-accent text-accent-fg"
                    : "";
                return (
                  <span
                    key={i}
                    onClick={canSeek ? () => onSeek(word.start) : undefined}
                    title={hit?.title}
                    className={`${word.speaker === candidate ? "" : "font-medium text-muted"} ${canSeek ? "cursor-pointer hover:underline" : ""} ${highlightClass}`}
                  >
                    {word.text}{" "}
                  </span>
                );
              })}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

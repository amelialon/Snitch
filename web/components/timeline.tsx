import { clock } from "@/lib/api";
import type { Flag } from "@/lib/types";

interface Props {
  duration: number;
  current: number;
  flags: Flag[];
  selected: string | null;
  onSeek: (seconds: number) => void;
  onSelect: (flag: Flag) => void;
}

/** The whole interview as one bar, with each flagged moment marked where it happened. */
export function Timeline({ duration, current, flags, selected, onSeek, onSelect }: Props) {
  const pct = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / duration) * 100))}%`;

  return (
    <div>
      <div
        className="relative h-8 cursor-pointer rounded-md border border-border bg-surface"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - box.left) / box.width) * duration);
        }}
      >
        {flags.map((flag) => (
          <button
            key={flag.id}
            type="button"
            title={`${clock(flag.start)} – ${clock(flag.end)}`}
            aria-label={`Flagged moment at ${clock(flag.start)}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(flag);
            }}
            className={`absolute inset-y-0 min-w-1.5 rounded-sm ${selected === flag.id ? "bg-mark-strong" : "bg-mark-strong/60 hover:bg-mark-strong"}`}
            style={{ left: pct(flag.start), width: `calc(${pct(flag.end)} - ${pct(flag.start)})` }}
          />
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ left: pct(current) }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs text-muted">
        <span>{clock(current)}</span>
        <span>{clock(duration)}</span>
      </div>
    </div>
  );
}

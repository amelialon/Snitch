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
        className="relative my-2 h-[3px] cursor-pointer rounded-sm bg-border"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - box.left) / box.width) * duration);
        }}
      >
        {flags.map((flag) => (
          <button
            key={flag.id}
            type="button"
            title={`${clock(flag.start)} to ${clock(flag.end)}`}
            aria-label={`Flagged moment at ${clock(flag.start)}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(flag);
            }}
            className={`absolute -top-[1px] h-[5px] min-w-1.5 rounded-sm ${selected === flag.id ? "bg-mark-strong" : "bg-mark-strong/50 hover:bg-mark-strong"}`}
            style={{ left: pct(flag.start), width: `calc(${pct(flag.end)} - ${pct(flag.start)})` }}
          />
        ))}
        <div className="pointer-events-none absolute -top-[3.5px] size-2.5 -translate-x-1/2 rounded-full bg-text" style={{ left: pct(current) }} />
      </div>
      <div className="flex justify-between font-mono text-[12px] text-muted">
        <span>{clock(current)}</span>
        <span>{clock(duration)}</span>
      </div>
    </div>
  );
}

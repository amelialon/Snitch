/**
 * The Snitch mark as a loader: the four brackets wind up, orbit once, then snap back into the
 * square and hold, while the dot stays put and pulses on the lock. A spin-and-settle loop, all
 * transform and opacity. Reduced motion swaps the spin for a slow fade. Styles in globals.css.
 */
export function MarkLoader({ label, detail }: { label: string; detail?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-6 py-24 text-center">
      <svg className="mark-loader" viewBox="0 0 100 100" width="72" height="72" aria-hidden="true">
        <g className="brackets" fill="none" stroke="var(--mark-strong)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 34V22a8 8 0 0 1 8-8h12" />
          <path d="M66 14h12a8 8 0 0 1 8 8v12" />
          <path d="M86 66v12a8 8 0 0 1-8 8H66" />
          <path d="M34 86H22a8 8 0 0 1-8-8V66" />
        </g>
        <g className="ticks" fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round">
          <path d="M50 21v9" />
          <path d="M50 70v9" />
        </g>
        <circle className="dot" cx="50" cy="50" r="10" fill="var(--accent)" />
      </svg>
      <div>
        <p className="text-[15px] font-medium capitalize">{label}</p>
        {detail && <p className="mt-1 text-[13px] text-muted">{detail}</p>}
      </div>
    </div>
  );
}

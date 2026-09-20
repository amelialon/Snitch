"use client";

import { useEffect, useRef } from "react";

export function VideoTile({
  videoTrack,
  audioTrack,
  label,
  muted,
  contain = false,
  fill = false,
  compact = false,
  className = "",
  children,
}: {
  videoTrack: MediaStreamTrack | null;
  audioTrack?: MediaStreamTrack | null;
  label: string;
  muted?: boolean;
  contain?: boolean;
  /** Fill the parent's box instead of forcing a 16:9 aspect ratio (inside the call stage). */
  fill?: boolean;
  /** A thumbnail: smaller caption, no full-screen control of its own. */
  compact?: boolean;
  className?: string;
  /** Overlay content, e.g. a "waiting for the candidate" message. */
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tracks = [videoTrack, audioTrack].filter(Boolean) as MediaStreamTrack[];
    el.srcObject = tracks.length ? new MediaStream(tracks) : null;
  }, [videoTrack, audioTrack]);

  return (
    <div ref={frame} className={`group relative overflow-hidden rounded-[10px] bg-[#1b1b1f] ${fill ? "h-full w-full" : "aspect-video"} ${className}`}>
      <video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full ${contain ? "object-contain" : "object-cover"}`} />
      <span className={`absolute bottom-2.5 left-3 text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)] ${compact ? "text-[12px]" : "text-[12.5px]"}`}>{label}</span>
      {!videoTrack && !children && <div className="absolute inset-0 grid place-items-center text-xs text-white/60">No video</div>}
      {children}
      {!compact && (
        <button
          type="button"
          aria-label="Full screen"
          onClick={() => {
            const el = frame.current;
            if (!el) return;
            if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
            else el.requestFullscreen().catch(() => {});
          }}
          className="absolute right-2.5 top-2.5 grid size-[30px] place-items-center rounded-md bg-black/55 text-white opacity-0 transition-opacity duration-150 hover:bg-black/75 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
          </svg>
        </button>
      )}
    </div>
  );
}

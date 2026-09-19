"use client";

import { useEffect, useRef } from "react";

export function VideoTile({
  videoTrack,
  audioTrack,
  label,
  muted,
}: {
  videoTrack: MediaStreamTrack | null;
  audioTrack?: MediaStreamTrack | null;
  label: string;
  muted?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tracks = [videoTrack, audioTrack].filter(Boolean) as MediaStreamTrack[];
    el.srcObject = tracks.length ? new MediaStream(tracks) : null;
  }, [videoTrack, audioTrack]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black">
      <video ref={ref} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{label}</span>
      {!videoTrack && <div className="absolute inset-0 grid place-items-center text-xs text-white/60">No video</div>}
    </div>
  );
}

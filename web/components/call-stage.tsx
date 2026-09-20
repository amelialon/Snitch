"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CallTracks } from "@/lib/live-call";
import { VideoTile } from "@/components/video-tile";

type Layout = "speaker" | "grid";

interface Props {
  role: "host" | "candidate";
  /** The other person's name, for the header and their tile. */
  otherName: string;
  phase: "joining" | "live" | "saving";
  connected: boolean;
  local: MediaStreamTrack | null;
  remote: CallTracks;
  sharing: MediaStreamTrack | null;
  sharePending: boolean;
  micOn: boolean;
  cameraOn: boolean;
  /** Epoch ms when recording began; drives the elapsed clock. */
  startedAt: number | null;
  /** Host only: shown inside the stage while waiting for the candidate. */
  inviteLink?: string;
  onCopyInvite?: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onShare: () => void;
  onEnd: () => void;
}

function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "0:00";
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * The call console: header, video stage and control bar as one unit. Full screen puts this
 * whole unit on the display, so nothing is lost when you enter it. In full screen the header and
 * controls fade after a few idle seconds and return on any movement, like a video player.
 */
export function CallStage(props: Props) {
  const { role, otherName, phase, connected, local, remote, sharing, sharePending, micOn, cameraOn, startedAt } = props;
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [layout, setLayout] = useState<Layout>("speaker");
  const [now, setNow] = useState(() => Date.now());
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | null>(null);

  // the elapsed clock
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  // in full screen, hide the chrome after 3 s without movement; any movement brings it back
  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    if (document.fullscreenElement === root.current) {
      idleTimer.current = window.setTimeout(() => setIdle(true), 3000);
    }
  }, []);

  // track the browser's full-screen state (Escape exits it without telling our button)
  useEffect(() => {
    const sync = () => {
      const isFull = document.fullscreenElement === root.current;
      setFull(isFull);
      if (isFull) wake();
      else {
        setIdle(false);
        if (idleTimer.current) window.clearTimeout(idleTimer.current);
      }
    };
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [wake]);

  function toggleFull() {
    const el = root.current;
    if (!el) return;
    if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  }

  const screen = sharing ?? remote.screen;
  const youLabel = role === "host" ? "You, interviewer" : "You, candidate";
  const chrome = `transition-opacity duration-200 ease-out ${idle ? "opacity-0" : "opacity-100"}`;

  const waiting = (
    <div className="absolute inset-0 grid place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <p className="text-[15px] text-white/85">
          {role === "host" ? `Waiting for ${otherName} to join` : "Waiting for the interviewer"}
        </p>
        {role === "host" && props.inviteLink && (
          <div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-left">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-white/70">{props.inviteLink}</span>
            <button type="button" onClick={props.onCopyInvite} className="shrink-0 text-[13px] font-medium text-[#c9c0fb] hover:text-white">
              Copy link
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const remoteTile = (
    <VideoTile videoTrack={remote.camera} audioTrack={remote.audio} label={otherName} fill compact={!!screen} className="rounded-lg">
      {!connected && waiting}
    </VideoTile>
  );
  const selfTile = (
    <VideoTile videoTrack={cameraOn ? local : null} label={youLabel} muted fill compact className="rounded-lg" />
  );

  return (
    <div
      ref={root}
      onMouseMove={full ? wake : undefined}
      onKeyDown={full ? wake : undefined}
      className={`relative flex flex-col bg-[#0f0f12] text-[#f2f1ec] ${full ? "h-screen w-screen cursor-default" : "aspect-[16/10] rounded-xl"} ${full && idle ? "cursor-none" : ""}`}
    >
      {/* Header */}
      <div className={`flex items-center justify-between px-5 py-3 text-[13px] text-[#b8b6ad] ${chrome}`}>
        <div className="flex items-center gap-3.5">
          <span className="font-medium text-[#f2f1ec]">{otherName}</span>
          <span className="text-[#44434a]">|</span>
          {role === "host" && (
            <span className="inline-flex items-center gap-2">
              <span className={`size-2 rounded-full bg-[#a99cf5] ${phase === "live" ? "animate-pulse" : ""}`} />
              Recording <span className="font-mono">{elapsed(startedAt, now)}</span>
            </span>
          )}
          {role === "candidate" && <span>{phase === "live" ? "Recording" : "Connecting"}</span>}
          <span className="text-[#44434a]">|</span>
          <span>{phase === "joining" ? "Connecting…" : connected ? "Connected" : "Waiting"}</span>
        </div>
        <button type="button" onClick={toggleFull} className="inline-flex items-center gap-2 text-[13px] text-[#c9c0fb] hover:text-white">
          <FullIcon exit={full} />
          {full ? "Exit full screen" : "Full screen"}
        </button>
      </div>

      {/* Stage */}
      <div className="relative min-h-0 flex-1 px-5">
        {screen ? (
          <div className="flex h-full gap-3">
            <VideoTile videoTrack={screen} label={sharing ? "Your shared screen" : `${otherName} is sharing their screen`} muted contain fill className="min-w-0 flex-1 rounded-lg" />
            <div className="flex w-[236px] shrink-0 flex-col gap-3">
              <div className="aspect-video">{remoteTile}</div>
              <div className="aspect-video">{selfTile}</div>
            </div>
          </div>
        ) : layout === "speaker" ? (
          <div className="relative h-full">
            {remoteTile}
            <div className="absolute bottom-4 right-4 w-1/5 min-w-[160px] max-w-[280px] overflow-hidden rounded-lg shadow-[0_8px_30px_rgba(0,0,0,.5)]">
              <div className="aspect-video">{selfTile}</div>
            </div>
          </div>
        ) : (
          <div className="grid h-full grid-cols-2 gap-3">
            {remoteTile}
            {selfTile}
          </div>
        )}

        {phase === "saving" && (
          <div className="absolute inset-5 grid place-items-center rounded-lg bg-[#0f0f12]/80 text-[15px]">Saving the recording…</div>
        )}
      </div>

      {/* Control bar */}
      <div className={`flex items-center justify-center gap-1.5 px-6 pb-4 pt-3.5 ${chrome}`}>
        <Control label={micOn ? "Mute" : "Unmute"} on={!micOn} onClick={props.onToggleMic} icon={<MicIcon off={!micOn} />} />
        <Control label={cameraOn ? "Camera" : "Camera off"} on={!cameraOn} onClick={props.onToggleCamera} icon={<CameraIcon off={!cameraOn} />} />
        <Control
          label={sharePending ? "Choosing…" : sharing ? "Stop sharing" : "Share screen"}
          on={!!sharing}
          disabled={sharePending || phase !== "live"}
          onClick={props.onShare}
          icon={<ShareIcon />}
        />
        {!screen && (
          <Control label={layout === "speaker" ? "Grid" : "Speaker"} onClick={() => setLayout((l) => (l === "speaker" ? "grid" : "speaker"))} icon={<LayoutIcon grid={layout === "speaker"} />} />
        )}
        <span className="mx-2.5 h-7 w-px bg-[#2c2c34]" />
        <button
          type="button"
          onClick={props.onEnd}
          disabled={phase === "saving"}
          className="btn h-10 rounded-full bg-[#3d30b3] px-5 text-[13.5px] text-white hover:bg-[#4a3dc6] disabled:opacity-40"
        >
          {role === "host" ? "End interview" : "Leave"}
        </button>
      </div>
    </div>
  );
}

function Control({ label, icon, on, disabled, onClick }: { label: string; icon: React.ReactNode; on?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`btn h-auto min-w-[76px] flex-col gap-1.5 rounded-lg px-2 py-2 text-[11.5px] font-normal disabled:opacity-40 ${
        on ? "bg-[#2b2650] text-[#c9c0fb] hover:bg-[#342e5e]" : "text-[#e8e6df] hover:bg-white/8"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, width: 20, height: 20, viewBox: "0 0 24 24", "aria-hidden": true };

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg {...stroke}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}
function CameraIcon({ off }: { off: boolean }) {
  return (
    <svg {...stroke}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}
function ShareIcon() {
  return (
    <svg {...stroke}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
function LayoutIcon({ grid }: { grid: boolean }) {
  return grid ? (
    <svg {...stroke}>
      <rect x="3" y="4" width="8" height="7" rx="1.5" />
      <rect x="13" y="4" width="8" height="7" rx="1.5" />
      <rect x="3" y="13" width="8" height="7" rx="1.5" />
      <rect x="13" y="13" width="8" height="7" rx="1.5" />
    </svg>
  ) : (
    <svg {...stroke}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <rect x="13" y="12" width="6" height="5" rx="1" />
    </svg>
  );
}
function FullIcon({ exit }: { exit: boolean }) {
  return exit ? (
    <svg {...stroke} width={14} height={14}>
      <path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" />
    </svg>
  ) : (
    <svg {...stroke} width={14} height={14}>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  );
}

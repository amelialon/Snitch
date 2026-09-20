"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getLiveConfig, saveVisualMarker, uploadLiveRecording } from "@/lib/api";
import { ScreenOverlay, type VisualMarker } from "@/lib/screen-overlay";
import { LiveCall, type CallTracks } from "@/lib/live-call";
import { InterviewRecorder } from "@/lib/interview-recorder";
import {
  recoverRecording,
  removeRecording,
  type SavedRecording,
} from "@/lib/recording-store";
import { VideoTile } from "@/components/video-tile";

type Phase = "idle" | "joining" | "live" | "saving" | "retry" | "ended";

const emptyTracks: CallTracks = {
  camera: null,
  audio: null,
  screen: null,
};

export default function LiveRoomPage() {
  return (
    <Suspense fallback={<p>Loading interview…</p>}>
      <LiveRoom />
    </Suspense>
  );
}

function LiveRoom() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const call = useRef<LiveCall | null>(null);
  const recorder = useRef<InterviewRecorder | null>(null);
  const source = useRef<MediaStream | null>(null);
  const screen = useRef<MediaStream | null>(null);
  const overlay = useRef<ScreenOverlay | null>(null);
  const marker = useRef<VisualMarker | null>(null);
  const shareGeneration = useRef(0);
  const shareStarting = useRef(false);
  const [markerText, setMarkerText] = useState("");
  const [opacity, setOpacity] = useState(.35);

  const stage = useRef<HTMLDivElement | null>(null);
  const ending = useRef(false);
  const mounted = useRef(true);
  const busy = useRef(false);

  const role =
    useSearchParams().get("role") === "candidate" ? "candidate" : "host";

  const [phase, setPhase] = useState<Phase>("idle");
  const [consent, setConsent] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [local, setLocal] = useState<MediaStreamTrack | null>(null);
  const [remote, setRemote] = useState<CallTracks>(emptyTracks);

  const [sharing, setSharing] = useState<MediaStreamTrack | null>(null);
  const [sharePending, setSharePending] = useState(false);

  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  const [progress, setProgress] = useState(0);

  const [saved, setSaved] = useState<{
    session: SavedRecording;
    blob: Blob;
  } | null>(null);

  const finishRef = useRef<(reason?: string) => Promise<void>>(
    async () => {}
  );

  const releaseOverlay = useCallback(() => {
    shareGeneration.current++;
    shareStarting.current = false;
    overlay.current?.stop();
    overlay.current = null;
    const completed = marker.current;
    marker.current = null;
    if (completed) void saveVisualMarker(id, { ...completed, finished_at: new Date().toISOString() })
      .catch(() => { if (mounted.current) setError("Screen sharing stopped, but its watermark end time could not be saved."); });
  }, [id]);

  useEffect(() => {
    mounted.current = true;

    Promise.all([
      getLiveConfig(),
      role === "host" ? recoverRecording(id) : Promise.resolve(null),
    ])
      .then(([, found]) => {
        if (mounted.current && found) {
          setSaved(found);
          setPhase("retry");
          setNotice(
            "A recording from this room is saved in this browser. Save it as a review or download it before starting another interview."
          );
        }

        if (mounted.current) {
          setLoaded(true);
        }
      })
      .catch(() => {
        setError(
          "Could not prepare the room. Check that the backend is running and browser site storage is allowed."
        );
      });

    const protect = (e: BeforeUnloadEvent) => {
      if (busy.current || recorder.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", protect);

    return () => {
      mounted.current = false;

      window.removeEventListener("beforeunload", protect);

      void recorder.current?.stop();
      recorder.current = null;

      releaseOverlay();
      screen.current?.getTracks().forEach((track) => track.stop());

      call.current?.leave();

      source.current?.getTracks().forEach((track) => track.stop());
    };
  }, [id, role, releaseOverlay]);

  async function upload(recording: {
    session: SavedRecording;
    blob: Blob;
  }) {
    setPhase("saving");
    setProgress(0);
    setError("");
    busy.current = true;

    try {
      if (!recording.blob.size) {
        throw new Error(
          "No recording frames were captured. Clear the empty recording and start a new interview."
        );
      }

      const reviewId = await uploadLiveRecording(
        id,
        recording.session.id,
        recording.blob,
        setProgress
      );

      await removeRecording(recording.session.id).catch(() => {});

      setSaved(null);
      setPhase("ended");

      router.push(`/i/${reviewId}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase("retry");
    } finally {
      busy.current = false;
    }
  }

  async function finish(reason?: string) {
    if (ending.current) {
      return;
    }

    ending.current = true;

    if (reason) {
      setNotice(reason);
    }

    setPhase("saving");
    busy.current = true;

    const recording = recorder.current;
    recorder.current = null;

    try {
      const blob = recording ? await recording.stop() : null;

      releaseOverlay();
      setMarkerText("");
      setSharePending(false);
      screen.current?.getTracks().forEach((track) => track.stop());
      screen.current = null;

      call.current?.leave();
      call.current = null;

      source.current?.getTracks().forEach((track) => track.stop());
      source.current = null;

      setSharing(null);
      setLocal(null);
      setRemote(emptyTracks);
      setConnected(false);

      if (recording && blob) {
        const result = {
          session: recording.session,
          blob,
        };

        setSaved(result);

        await upload(result);
      } else {
        setPhase("ended");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("retry");
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    finishRef.current = finish;
  });

  async function join() {
    if (busy.current || !loaded) {
      return;
    }

    busy.current = true;
    ending.current = false;

    setPhase("joining");
    setError("");

    let c: LiveCall | null = null;
    let r: InterviewRecorder | null = null;

    try {
      const config = await getLiveConfig();

      if (!mounted.current) {
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      source.current = stream;

      setLocal(stream.getVideoTracks()[0]);
      setMicOn(true);
      setCameraOn(true);

      c = new LiveCall(
        stream,
        role,
        config.iceServers,
        () => {
          if (!mounted.current || !c) {
            return;
          }

          setRemote({ ...c.remote });
          setConnected(c.connected);
        },
        (reason) => {
          if (mounted.current && !ending.current) {
            void finishRef.current(reason);
          }
        }
      );

      call.current = c;

      if (role === "host") {
        r = new InterviewRecorder(
          id,
          () => ({
            local: stream,
            remoteCamera: c!.remote.camera,
            remoteAudio: c!.remote.audio,
            screen:
              screen.current?.getVideoTracks()[0] ??
              c!.remote.screen,
          }),
          setError
        );

        await r.start();

        recorder.current = r;
      }

      await c.join(id);

      if (!mounted.current) {
        await r?.stop();
        c.leave();
        return;
      }

      if (!ending.current) {
        setPhase("live");

        setNotice(
          role === "host"
            ? "Recording is on. End the interview to save it and create a review."
            : "This interview is being recorded by the interviewer for review."
        );
      }
    } catch (e) {
      setError((e as Error).message);

      if (r) {
        const blob = await r.stop();

        recorder.current = null;

        if (blob.size) {
          setSaved({
            session: r.session,
            blob,
          });

          setPhase("retry");
        } else {
          await removeRecording(r.session.id).catch(() => {});
          setPhase("idle");
        }
      } else {
        setPhase("idle");
      }

      c?.leave();
      call.current = null;

      source.current?.getTracks().forEach((track) => track.stop());
      source.current = null;
    } finally {
      busy.current = false;
    }
  }

  async function stopShare() {
    releaseOverlay();
    setMarkerText("");
    setSharePending(false);
    screen.current?.getTracks().forEach((track) => track.stop());

    screen.current = null;

    setSharing(null);

    await call.current?.share(null).catch(() => {});
  }

  async function startShare() {
    if (shareStarting.current || screen.current) {
      return;
    }

    shareStarting.current = true;
    const generation = ++shareGeneration.current;
    const current = () => mounted.current && !ending.current && generation === shareGeneration.current;
    setSharePending(true);
    setError("");

    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      if (!current() || !call.current) {
        captured.getTracks().forEach((track) => track.stop());
        return;
      }

      const compositor = new ScreenOverlay(captured, () => { if (current()) void stopShare(); });
      overlay.current = compositor;
      const output = await compositor.start(opacity);
      if (!current()) { compositor.stop(); return; }
      const created = compositor.marker!;
      await saveVisualMarker(id, created);
      if (!current()) {
        compositor.stop();
        await saveVisualMarker(id, { ...created, finished_at: new Date().toISOString() });
        return;
      }
      marker.current = created;
      screen.current = output;
      const track = output.getVideoTracks()[0];
      await call.current.share(track);
      if (!current()) return;
      setSharing(track);
      setMarkerText(created.expected_marker);
    } catch (e) {
      if (current()) {
        await stopShare();
        setError((e as Error).message);
      }
    } finally {
      if (generation === shareGeneration.current) {
        shareStarting.current = false;
        setSharePending(false);
      }
    }
  }

  const button = "btn btn-ghost";

  return (
    <div className="space-y-5">
      {phase !== "live" &&
        phase !== "joining" &&
        phase !== "saving" && (
          <Link href="/live" className="text-[13px] text-muted hover:text-text">
            Live interviews
          </Link>
        )}

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <h1 className="text-4xl leading-none">Live interview</h1>

        <span role="status" className="text-[13.5px] text-muted">
          {phase === "live"
            ? `${
                role === "host" ? "● Recording · " : ""
              }${
                connected
                  ? "Connected"
                  : "Waiting for the other participant"
              }`
            : phase === "saving"
              ? `Saving recording… ${Math.round(progress * 100)}%`
              : phase === "joining"
                ? "Connecting…"
                : ""}
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="text-sm text-danger"
        >
          {error}
        </p>
      )}

      {notice && (
        <p className="text-sm text-muted">
          {notice}
        </p>
      )}

      {role === "host" && (
        <div className="flex flex-wrap items-center gap-4">
          <p className="flex-1 text-[13.5px] leading-relaxed text-muted">
            Invite the candidate to this room. They open the link in a browser, confirm consent, and join. Both of you stay inside
            this app.
          </p>

          <button
            className={button}
            onClick={async () => {
              const link = `${window.location.origin}/live/${id}?role=candidate`;

              try {
                await navigator.clipboard.writeText(link);

                setNotice(
                  "Invitation link copied. Send it to the candidate."
                );
              } catch {
                setNotice(`Invitation link: ${link}`);
              }
            }}
          >
            Copy invitation link
          </button>
        </div>
      )}

      {(phase === "idle" || phase === "ended") && (
        <section className="max-w-[720px] space-y-4 border-t border-border pt-6">
          <p className="text-[14.5px] leading-relaxed">
            Your camera, microphone, and any shared screen will be
            recorded for automated interview review.
            Shared screens include a subtle visual watermark.
          </p>

          <label className="flex items-start gap-3 text-[14.5px] leading-snug">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 size-4 shrink-0 accent-(--accent)"
            />

            {role === "host"
              ? "I confirm all participants consent to recording and automated review."
              : "I consent to recording and automated review of this interview."}
          </label>

          <button
            disabled={!consent || !loaded || phase === "ended"}
            onClick={join}
            className="btn btn-primary"
          >
            {role === "host"
              ? "Start recorded interview"
              : "Join interview"}
          </button>

          {phase === "ended" && (
            <p className="text-sm">
              This interview has ended.
            </p>
          )}
        </section>
      )}

      {(phase === "live" || phase === "joining") && (
        <div ref={stage} className="space-y-3 bg-bg">
          {(sharing || remote.screen) && (
            <VideoTile
              videoTrack={sharing ?? remote.screen}
              label={
                sharing
                  ? "Your shared screen"
                  : "Shared screen"
              }
              muted
              contain
            />
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <VideoTile
              videoTrack={cameraOn ? local : null}
              label={
                role === "host"
                  ? "You · interviewer"
                  : "You · candidate"
              }
              muted
            />

            <VideoTile
              videoTrack={remote.camera}
              audioTrack={remote.audio}
              label={
                role === "host"
                  ? "Candidate"
                  : "Interviewer"
              }
            />
          </div>

          {phase === "live" && (
            <div className="space-y-2 text-[13.5px] text-muted">
              <label className="flex items-center gap-3">
                Visual watermark visibility: {Math.round(opacity * 100)}%
                <input aria-label="Visual watermark visibility" type="range" min="0.1" max="0.8" step="0.05" value={opacity} disabled={sharePending || !!sharing} onChange={e => setOpacity(Number(e.target.value))} />
              </label>
              {markerText && <p role="status">Visual watermark active: <code>{markerText}</code>. Included in the shared video and recording.</p>}
            </div>
          )}

          {phase === "live" && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                className={button}
                onClick={() => {
                  source.current
                    ?.getAudioTracks()
                    .forEach((track) => {
                      track.enabled = !micOn;
                    });

                  setMicOn(!micOn);
                }}
              >
                {micOn
                  ? "Mute microphone"
                  : "Unmute microphone"}
              </button>

              <button
                className={button}
                onClick={() => {
                  source.current
                    ?.getVideoTracks()
                    .forEach((track) => {
                      track.enabled = !cameraOn;
                    });

                  setCameraOn(!cameraOn);
                }}
              >
                {cameraOn
                  ? "Turn camera off"
                  : "Turn camera on"}
              </button>

              <button
                disabled={sharePending}
                className={button}
                onClick={
                  sharing
                    ? stopShare
                    : startShare
                }
              >
                {sharePending
                  ? "Choosing screen…"
                  : sharing
                    ? "Stop sharing"
                    : "Share screen"}
              </button>

              <button
                className={button}
                onClick={() => {
                  const el = stage.current;
                  if (!el) return;
                  if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
                  else el.requestFullscreen().catch(() => {});
                }}
              >
                Full screen
              </button>

              <div className="flex-1" />

              <button
                className="btn btn-primary"
                onClick={() => finish()}
              >
                {role === "host"
                  ? "End interview"
                  : "Leave interview"}
              </button>
            </div>
          )}
        </div>
      )}

      {saved && (
        <section className="max-w-[720px] space-y-3 border-t border-border pt-6">
          <h2 className="text-[15px] font-semibold">
            Your recording
          </h2>

          <p className="text-sm text-muted">
            Keep this tab open until saving finishes. A recovery copy
            is kept in this browser until the server accepts the
            recording.
          </p>

          {!!saved.blob.size && (
            <RecordingPreview
              blob={saved.blob}
              id={id}
            />
          )}

          <div className="flex gap-3">
            <button
              disabled={
                phase === "saving" ||
                !saved.blob.size
              }
              className={button}
              onClick={() => upload(saved)}
            >
              Retry saving review
            </button>

            {!saved.blob.size && (
              <button
                className={button}
                onClick={async () => {
                  await removeRecording(
                    saved.session.id
                  );

                  setSaved(null);
                  setPhase("idle");
                }}
              >
                Clear empty recording
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function RecordingPreview({
  blob,
  id,
}: {
  blob: Blob;
  id: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const link = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);

    if (video.current) {
      video.current.src = url;
    }

    if (link.current) {
      link.current.href = url;
    }

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  return (
    <div className="space-y-2">
      <video
        ref={video}
        controls
        className="max-h-80 w-full rounded-[10px] bg-black"
      />

      <a
        ref={link}
        className="inline-block text-sm text-accent hover:underline"
        download={`interview-${id}.${
          blob.type.includes("mp4")
            ? "mp4"
            : "webm"
        }`}
      >
        Download recording
      </a>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { logCanary, logQuestion } from "@/lib/api";
import { type AudioCanary, loadManifest } from "@/lib/canary";
import { LiveCall, type RemoteTile } from "@/lib/daily";
import { OutgoingAudioMixer } from "@/lib/live-audio";
import { VideoTile } from "@/components/video-tile";

const ROOM_URL = process.env.NEXT_PUBLIC_DAILY_ROOM_URL ?? "";
const uid = () => Math.random().toString(36).slice(2, 9);

type CanaryStatus = "idle" | "loading" | "ready" | "sending" | "sent";

export default function LiveRoom() {
  const { id } = useParams<{ id: string }>();

  const mixer = useRef<OutgoingAudioMixer | null>(null);
  const call = useRef<LiveCall | null>(null);
  const [armed, setArmed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [localVideo, setLocalVideo] = useState<MediaStreamTrack | null>(null);
  const [remotes, setRemotes] = useState<RemoteTile[]>([]);

  // canary state
  const [canaries, setCanaries] = useState<AudioCanary[]>([]);
  const [selected, setSelected] = useState<AudioCanary | null>(null);
  const [status, setStatus] = useState<CanaryStatus>("idle");
  const [gainDb, setGainDb] = useState(-24);
  const [audibleDev, setAudibleDev] = useState(true);
  const [askNow, setAskNow] = useState(false);

  // questions
  const [questions, setQuestions] = useState<{ id: string; text: string; active: boolean }[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    loadManifest().then(setCanaries).catch((e: Error) => setError(e.message));
    return () => {
      call.current?.leave().catch(() => {});
      mixer.current?.close().catch(() => {});
    };
  }, []);

  // Arming builds the audio graph from the mic alone — no call needed. This is what makes the
  // injection testable on its own: Preview and gain work after arming, before any Daily room.
  const ensureMixer = useCallback(async (): Promise<OutgoingAudioMixer> => {
    if (mixer.current) return mixer.current;
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(async () => {
      // fall back to audio-only for a pure injection test on a machine with no camera
      return navigator.mediaDevices.getUserMedia({ audio: true });
    });
    const m = new OutgoingAudioMixer(micStream, audibleDev);
    await m.resume();
    mixer.current = m;
    setLocalVideo(micStream.getVideoTracks()[0] ?? null);
    setArmed(true);
    return m;
  }, [audibleDev]);

  async function arm() {
    setError("");
    try {
      await ensureMixer();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function connect() {
    setError("");
    if (!ROOM_URL) {
      setError("No Daily room configured. Set NEXT_PUBLIC_DAILY_ROOM_URL to a room URL to start the call. You can still arm the mic and Preview without a room.");
      return;
    }
    try {
      const m = await ensureMixer();

      const c = new LiveCall();
      const refresh = () => {
        setLocalVideo(c.localVideoTrack());
        setRemotes(c.remotes());
        setConnected(c.isConnected());
      };
      c.on("participant-updated", refresh);
      c.on("participant-joined", refresh);
      c.on("participant-left", refresh);
      c.on("joined-meeting", refresh);
      // The recruiter's camera goes out normally; the mixed mic(+canary) track is the audio source.
      await c.join(ROOM_URL, m.outgoingTrack);
      call.current = c;
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function selectCanary(canary: AudioCanary) {
    setSelected(canary);
    setAskNow(false);
    setStatus("loading");
    try {
      const m = await ensureMixer(); // arm the mic if it isn't already
      await m.preload(canary); // preload now, never at send time
      setStatus("ready");
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  }

  const activeQuestionId = questions.find((q) => q.active)?.id ?? null;

  const send = useCallback(
    async (thenAsk: boolean) => {
      const m = mixer.current;
      if (!m || !selected || status !== "ready") return;
      setAskNow(false);
      setStatus("sending");
      const result = await m.send(selected, gainDb); // mic keeps flowing; canary mixed in
      setStatus("sent");
      logCanary(id, {
        canary_id: selected.id,
        question_id: activeQuestionId,
        expected_marker: selected.expectedMarker,
        instruction: selected.instruction,
        delivery_method: "outgoing-audio-mix",
        gain_db: result.gainDb,
        sent_at: new Date(result.sentAt).toISOString(),
        finished_at: new Date(result.finishedAt).toISOString(),
      }).catch(() => {});
      if (thenAsk) {
        setTimeout(() => setAskNow(true), 100); // small margin after the canary finishes
      }
    },
    [id, selected, status, gainDb, activeQuestionId],
  );

  async function preview() {
    if (mixer.current && selected && status !== "sending") await mixer.current.preview(selected, gainDb);
  }

  function addQuestion() {
    if (!draft.trim()) return;
    setQuestions((q) => [...q, { id: uid(), text: draft.trim(), active: false }]);
    setDraft("");
  }

  function startQuestion(qid: string) {
    setQuestions((qs) => qs.map((q) => ({ ...q, active: q.id === qid })));
    setAskNow(false);
    const q = questions.find((x) => x.id === qid);
    if (q) logQuestion(id, { id: qid, text: q.text, started_at: new Date().toISOString() }).catch(() => {});
  }

  function endQuestion(qid: string) {
    setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, active: false } : q)));
    logQuestion(id, { id: qid, ended_at: new Date().toISOString() }).catch(() => {});
  }

  const btn = "rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/i/${id}`} className="text-xs text-muted hover:underline">
          ← Review
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Live interview</h1>
        <p className="mt-1 text-sm text-muted">
          Canary use requires the candidate to have consented to measures that detect unauthorized real-time
          assistance. A triggered marker is one signal, never proof on its own.
        </p>
      </div>

      {error && <p className="rounded-md border border-danger/40 bg-surface p-4 text-sm text-danger">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <VideoTile videoTrack={localVideo} label="You (recruiter)" muted />
            {remotes.length ? (
              remotes.map((r) => <VideoTile key={r.sessionId} videoTrack={r.videoTrack} audioTrack={r.audioTrack} label="Candidate" />)
            ) : (
              <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-border text-xs text-muted">
                Waiting for candidate
              </div>
            )}
          </div>

          {!connected ? (
            <div className="flex flex-wrap items-center gap-3">
              {!armed && (
                <button onClick={arm} className={`${btn} border border-border`}>
                  Enable microphone (test without a call)
                </button>
              )}
              <button onClick={connect} className={`${btn} bg-accent text-accent-fg`}>
                Join call
              </button>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={audibleDev}
                  onChange={(e) => {
                    setAudibleDev(e.target.checked);
                    if (mixer.current) mixer.current.audibleDevMode = e.target.checked;
                  }}
                  className="size-4 accent-(--accent)"
                />
                Audible dev mode (prove it transmits before lowering the level)
              </label>
              {armed && <span className="text-xs text-accent">Mic armed — Preview and gain work now.</span>}
            </div>
          ) : (
            <p className="text-xs text-muted">Connected. Your microphone is live and uninterrupted.</p>
          )}

          <section className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">Questions</h2>
            <div className="mt-3 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuestion()}
                placeholder="Add a question…"
                className="flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm"
              />
              <button onClick={addQuestion} className={`${btn} border border-border`}>
                Add
              </button>
            </div>
            <ul className="mt-3 space-y-2">
              {questions.map((q) => (
                <li key={q.id} className={`rounded-md border p-3 text-sm ${q.active ? "border-accent" : "border-border"}`}>
                  <p>{q.text}</p>
                  <div className="mt-2 flex gap-2">
                    {q.active ? (
                      <button onClick={() => endQuestion(q.id)} className={`${btn} border border-border text-xs`}>
                        End question
                      </button>
                    ) : (
                      <button onClick={() => startQuestion(q.id)} className={`${btn} border border-border text-xs`}>
                        Start question
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {questions.length === 0 && <li className="text-sm text-muted">No questions yet.</li>}
            </ul>
            <p className="mt-2 text-xs text-muted">You ask each question yourself; the app never speaks it.</p>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">Canary</h2>
            <select
              value={selected?.id ?? ""}
              onChange={(e) => {
                const c = canaries.find((x) => x.id === e.target.value);
                if (c) selectCanary(c);
              }}
              className="mt-3 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Select a canary…
              </option>
              {canaries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} — “{c.expectedMarker}”
                </option>
              ))}
            </select>

            {selected && (
              <p className="mt-2 text-xs text-muted">
                “{selected.instruction}” · {selected.durationMs} ms ·{" "}
                <span className={status === "ready" || status === "sent" ? "text-accent" : ""}>
                  {status === "loading" ? "preloading…" : status === "idle" ? "not preloaded" : status.toUpperCase()}
                </span>
              </p>
            )}

            <label className="mt-4 block text-xs font-medium">
              Injection level: {gainDb} dB
              <input
                type="range"
                min={-48}
                max={0}
                step={1}
                value={gainDb}
                onChange={(e) => setGainDb(Number(e.target.value))}
                className="mt-1 w-full accent-(--accent)"
              />
              <span className="text-muted">Start audible (near 0 dB), then lower once you confirm it transmits.</span>
            </label>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={preview} disabled={status !== "ready" && status !== "sent"} className={`${btn} border border-border`}>
                Preview (local)
              </button>
              <button onClick={() => send(false)} disabled={!connected || status !== "ready"} className={`${btn} bg-accent text-accent-fg`}>
                Send canary
              </button>
              <button
                onClick={() => send(true)}
                disabled={!connected || status !== "ready"}
                className={`${btn} col-span-2 border border-accent text-accent`}
              >
                Send + Ask
              </button>
            </div>

            {status === "sending" && <p className="mt-3 text-sm">Canary: SENDING…</p>}
            {askNow && (
              <p className="mt-3 rounded-md bg-mark px-3 py-2 text-sm font-semibold text-mark-text">✓ Sent — ASK QUESTION NOW</p>
            )}
            <p className="mt-3 text-xs text-muted">Preview plays to you only. Send mixes it into the outgoing audio; your mic is not interrupted.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

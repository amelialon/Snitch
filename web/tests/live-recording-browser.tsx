"use client";

import { useEffect, useRef, useState } from "react";
import { LiveCall } from "@/lib/live-call";
import { InterviewRecorder } from "@/lib/interview-recorder";
import { ScreenOverlay } from "@/lib/screen-overlay";
import { recoverRecording, removeRecording } from "@/lib/recording-store";

const API = "http://localhost:8001";
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Explicit development-only fixture: synthetic media, isolated temporary backend, no camera. */
export function LiveRecordingTest() {
  const [steps, setSteps] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const preview = useRef<HTMLVideoElement>(null);
  const playbackUrl = useRef("");
  useEffect(() => () => URL.revokeObjectURL(playbackUrl.current), []);
  async function run() {
    setRunning(true); setSteps([]); setError("");
    const append = (text: string) => setSteps(previous => [...previous, text]);
    const audio = new AudioContext();
    const timers: ReturnType<typeof setInterval>[] = [];
    const sources: MediaStream[] = [];
    let host: LiveCall | undefined, candidate: LiveCall | undefined, recording: InterviewRecorder | undefined;
    let overlay: ScreenOverlay | undefined;
    try {
      await audio.resume();
      const synthetic = (color: string, label: string, frequency: number) => {
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
        const draw = () => { const ctx = canvas.getContext("2d")!; ctx.fillStyle = color; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = "white"; ctx.font = "26px sans-serif"; ctx.fillText(label, 30, 80); ctx.fillText(new Date().toISOString(), 30, 140); };
        draw(); timers.push(setInterval(draw, 50));
        const stream = canvas.captureStream(20);
        const oscillator = audio.createOscillator(); oscillator.frequency.value = frequency;
        const gain = audio.createGain(); gain.gain.value = .08;
        const output = audio.createMediaStreamDestination(); oscillator.connect(gain); gain.connect(output); oscillator.start();
        stream.addTrack(output.stream.getAudioTracks()[0]); sources.push(stream); return stream;
      };
      const local = synthetic("#ae2637", "Synthetic interviewer", 440);
      const remote = synthetic("#2457ab", "Synthetic candidate", 660);
      const shared = synthetic("#287742", "Shared screen", 880);
      const response = await fetch(`${API}/live-interviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidate_label: "Browser recording test", attested_by: "Synthetic test", consent_attested: true }) });
      if (!response.ok) throw new Error("Start backend/tests/dev_live_server.py first.");
      const room = (await response.json()).id;
      append(`Created isolated test room ${room}`);
      let callError = "";
      host = new LiveCall(local, "host", [], () => {}, reason => { callError = reason; }, API);
      candidate = new LiveCall(remote, "candidate", [], () => {}, reason => { callError = reason; }, API);
      await host.join(room); await candidate.join(room);
      const deadline = Date.now() + 12000;
      while ((!host.connected || !candidate.connected) && Date.now() < deadline) { if (callError) throw new Error(callError); await pause(100); }
      if (!host.connected || !candidate.connected) throw new Error("Local WebRTC peers did not connect.");
      append("PASS: two in-app WebRTC peers connected; no Daily room");
      overlay = new ScreenOverlay(new MediaStream(shared.getVideoTracks()), () => {});
      if (overlay.marker) throw new Error("Marker activated before frames arrived.");
      const composited = await overlay.start();
      const marker = overlay.marker!;
      const persisted = await fetch(`${API}/interviews/${room}/screen-shares/${marker.sharing_session_id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(marker) });
      if (!persisted.ok) throw new Error(`Watermark persistence failed: ${persisted.status}`);
      await host.share(composited.getVideoTracks()[0]);
      await pause(1000);
      if (!candidate.remote.screen || !host.remote.audio || !host.remote.camera) throw new Error(`Missing tracks: candidate screen=${!!candidate.remote.screen}, host audio=${!!host.remote.audio}, host camera=${!!host.remote.camera}`);
      append("PASS: camera, audio and separate screen tracks arrived");
      // Record the RECEIVED screen to exercise WebRTC encoding before recording encoding.
      recording = new InterviewRecorder(room, () => ({ local, remoteCamera: host!.remote.camera, remoteAudio: host!.remote.audio, screen: candidate!.remote.screen }), message => { callError = message; });
      await recording.start(); await pause(3800);
      const blob = await recording.stop();
      if (callError) throw new Error(callError);
      if (blob.size < 1000) throw new Error("Recorded video is empty.");
      const recovered = await recoverRecording(room);
      if (!recovered || recovered.blob.size !== blob.size) throw new Error("IndexedDB recovery differs from captured recording.");
      append(`PASS: ${blob.size} recorded bytes recovered from IndexedDB`);
      URL.revokeObjectURL(playbackUrl.current); playbackUrl.current = URL.createObjectURL(blob);
      preview.current!.src = playbackUrl.current; await preview.current!.play(); await pause(1000);
      if (!preview.current!.videoWidth) throw new Error("Recorded video cannot be decoded.");
      const frame = document.createElement("canvas"); frame.width = 1280; frame.height = 720;
      const ctx = frame.getContext("2d")!; ctx.drawImage(preview.current!, 0, 0);
      const green = ctx.getImageData(400, 300, 1, 1).data;
      const red = ctx.getImageData(1100, 170, 1, 1).data;
      const blue = ctx.getImageData(1100, 540, 1, 1).data;
      if (!(green[1] > green[0] && red[0] > red[1] && blue[2] > blue[0])) throw new Error("Recording is missing a screen/camera tile.");
      append("PASS: decoded recording contains shared screen and both cameras");
      const band = ctx.getImageData(9, 99, 310, 24).data;
      const background = ctx.getImageData(400, 110, 1, 1).data;
      let markedPixels = 0;
      for (let i = 0; i < band.length; i += 4) if (band[i] - background[0] > 10 && band[i + 1] - background[1] > 10) markedPixels++;
      if (markedPixels < 70) throw new Error(`Visual watermark missing after WebRTC and recording encoding: ${markedPixels} pixels`);
      append(`PASS: visual watermark survives WebRTC and recording encoding (${markedPixels} text pixels); ${marker.expected_marker}`);
      const decodedAudio = await audio.decodeAudioData(await blob.arrayBuffer());
      const pcm = decodedAudio.getChannelData(0), start = Math.floor(decodedAudio.sampleRate), n = Math.min(8192, pcm.length - start);
      const magnitude = (hz: number) => {
        let sin = 0, cos = 0;
        for (let i = 0; i < n; i++) { const angle = 2 * Math.PI * hz * i / decodedAudio.sampleRate; sin += pcm[start + i] * Math.sin(angle); cos += pcm[start + i] * Math.cos(angle); }
        return Math.hypot(sin, cos) / n;
      };
      if (magnitude(440) < .005 || magnitude(660) < .005) throw new Error(`Audio tone amplitudes: interviewer=${magnitude(440).toFixed(5)}, candidate=${magnitude(660).toFixed(5)}, duration=${decodedAudio.duration.toFixed(2)}s`);
      append("PASS: both participants' audio tones recovered from encoded video");
      await host.share(null); await pause(200);
      overlay.stop();
      if (composited.getVideoTracks()[0].readyState !== "ended") throw new Error("Overlay track still running after stop.");
      if (candidate.remote.screen) throw new Error("Remote screen did not clear after stopping sharing.");
      const form = new FormData(); form.append("recording_id", recording.session.id); form.append("consent_attested", "true"); form.append("recording", blob, "interview.webm");
      const uploaded = await fetch(`${API}/live-interviews/${room}/recording`, { method: "POST", body: form });
      if (!uploaded.ok) throw new Error(`Recording upload failed: ${uploaded.status}`);
      const reviewId = (await uploaded.json()).review_id;
      let review;
      for (let i = 0; i < 50; i++) {
        review = await (await fetch(`${API}/interviews/${reviewId}`)).json();
        if (review.interview.status !== "processing") break;
        await pause(100);
      }
      if (review?.interview.status !== "ready" || !review.report) throw new Error("Recorded interview did not become a review.");
      const retried = await (await fetch(`${API}/live-interviews/${room}/recording`, { method: "POST", body: form })).json();
      if (retried.review_id !== reviewId) throw new Error("Retry created another review.");
      await removeRecording(recording.session.id);
      append("PASS: recording uploaded, review ready, retry returned same review");
      append("ALL CHECKS PASSED (synthetic transcription; no vendor calls)");
    } catch (e) { setError((e as Error).message); }
    finally {
      await recording?.stop(); overlay?.stop(); host?.leave(); candidate?.leave(); sources.forEach(s => s.getTracks().forEach(t => t.stop())); timers.forEach(clearInterval); await audio.close(); setRunning(false);
    }
  }
  return <div className="space-y-4"><h1 className="text-2xl font-semibold">Development: live recording integration test</h1>
    <p className="text-sm">Synthetic sources and the temporary backend on port 8001. No real camera, microphone, or vendor service is used.</p>
    <button disabled={running} onClick={run} className="rounded bg-accent p-3 text-accent-fg">{running ? "Testing…" : "Run in-app recording test"}</button>
    <ul className="space-y-2 text-sm">{steps.map(s => <li key={s}>{s}</li>)}</ul>{error && <p role="alert">FAIL: {error}</p>}
    <video ref={preview} controls muted className="w-full rounded bg-black" />
  </div>;
}

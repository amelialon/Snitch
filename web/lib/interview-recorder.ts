import { saveRecordingChunk, saveRecordingSession, type SavedRecording } from "./recording-store";
export interface RecordingTracks { local: MediaStream; remoteCamera: MediaStreamTrack | null; remoteAudio: MediaStreamTrack | null; screen: MediaStreamTrack | null }

/** Stable canvas/audio-bus tracks support participant and screen changes during recording. */
export class InterviewRecorder {
  private canvas = document.createElement("canvas");
  private audio = new AudioContext();
  private bus = this.audio.createMediaStreamDestination();
  private inputs = new Map<string, MediaStreamAudioSourceNode>();
  private audioSinks = new Map<string, HTMLAudioElement>();
  private videos = new Map<string, HTMLVideoElement>();
  private output: MediaStream;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private writes = Promise.resolve();
  private storageFailed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping: Promise<Blob> | null = null;
  readonly session: SavedRecording;
  constructor(interviewId: string, private tracks: () => RecordingTracks, private failed: (message: string) => void) {
    this.canvas.width = 1280; this.canvas.height = 720;
    this.output = this.canvas.captureStream(20); this.output.addTrack(this.bus.stream.getAudioTracks()[0]);
    const mimeType = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { this.dispose(); throw new Error("This browser cannot record interview video. Use desktop Chrome or Edge."); }
    this.recorder = new MediaRecorder(this.output, { mimeType, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 128_000 });
    this.session = { id: crypto.randomUUID(), interviewId, mimeType, createdAt: Date.now() };
    this.recorder.ondataavailable = e => {
      if (!e.data.size) return;
      const index = this.chunks.length; this.chunks.push(e.data);
      this.writes = this.writes.then(() => saveRecordingChunk(this.session.id, index, e.data)).catch(() => {
        if (!this.storageFailed) { this.storageFailed = true; this.failed("Browser recovery storage is full or unavailable. End the interview and save the recording before closing this tab."); }
      });
    };
    this.recorder.onerror = () => this.failed("Recording was interrupted. End the interview to save the captured portion.");
  }
  async start() {
    try {
      await saveRecordingSession(this.session); await this.audio.resume();
      this.draw(); this.recorder.start(3000); this.timer = setInterval(() => this.draw(), 50);
    } catch (e) { this.dispose(); throw e; }
  }
  private draw() {
    const tracks = this.tracks();
    const audioTracks = [tracks.local.getAudioTracks()[0], tracks.remoteAudio].filter((t): t is MediaStreamTrack => !!t && t.readyState === "live");
    const audioIds = new Set(audioTracks.map(t => t.id));
    for (const [id, node] of this.inputs) if (!audioIds.has(id)) {
      node.disconnect(); this.inputs.delete(id);
      const sink = this.audioSinks.get(id); if (sink) { sink.pause(); sink.srcObject = null; this.audioSinks.delete(id); }
    }
    for (const track of audioTracks) if (!this.inputs.has(track.id)) {
      const stream = new MediaStream([track]);
      // Keep remote audio rendering active even when the participant preview is unmounted.
      const sink = document.createElement("audio"); sink.muted = true; sink.srcObject = stream;
      void sink.play().catch(() => {}); this.audioSinks.set(track.id, sink);
      const input = this.audio.createMediaStreamSource(stream); input.connect(this.bus); this.inputs.set(track.id, input);
    }
    const ctx = this.canvas.getContext("2d")!;
    ctx.fillStyle = "#121820"; ctx.fillRect(0, 0, 1280, 720);
    const used = new Set<string>();
    const tile = (track: MediaStreamTrack | null | undefined, label: string, x: number, y: number, w: number, h: number) => {
      if (track && track.readyState === "live") {
        used.add(track.id); let video = this.videos.get(track.id);
        if (!video) {
          video = document.createElement("video"); video.muted = true; video.playsInline = true;
          video.srcObject = new MediaStream([track]); video.play().catch(() => {}); this.videos.set(track.id, video);
        }
        if (video.readyState >= 2 && video.videoWidth) {
          const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
          const vw = video.videoWidth * scale, vh = video.videoHeight * scale;
          ctx.drawImage(video, x + (w - vw) / 2, y + (h - vh) / 2, vw, vh);
        }
      }
      ctx.fillStyle = "#000a"; ctx.fillRect(x + 8, y + h - 36, Math.min(w - 16, 220), 28);
      ctx.font = "16px sans-serif"; ctx.fillStyle = "white"; ctx.fillText(label, x + 16, y + h - 16);
    };
    if (tracks.screen?.readyState === "live") {
      tile(tracks.screen, "Shared screen", 0, 0, 960, 720);
      tile(tracks.local.getVideoTracks()[0], "Interviewer", 960, 0, 320, 360);
      tile(tracks.remoteCamera, "Candidate", 960, 360, 320, 360);
    } else {
      tile(tracks.local.getVideoTracks()[0], "Interviewer", 0, 0, 640, 720);
      tile(tracks.remoteCamera, "Candidate", 640, 0, 640, 720);
    }
    for (const [id, video] of this.videos) if (!used.has(id)) { video.pause(); video.srcObject = null; this.videos.delete(id); }
  }
  stop(): Promise<Blob> {
    if (this.stopping) return this.stopping;
    this.stopping = new Promise<Blob>((resolve) => {
      const complete = async () => { await this.writes; const blob = new Blob(this.chunks, { type: this.session.mimeType }); this.dispose(); resolve(blob); };
      if (this.recorder.state === "inactive") { void complete(); return; }
      this.recorder.onstop = () => { void complete(); }; this.recorder.stop();
    });
    return this.stopping;
  }
  private dispose() {
    if (this.timer) clearInterval(this.timer);
    this.inputs.forEach(node => node.disconnect()); this.inputs.clear();
    this.audioSinks.forEach(sink => { sink.pause(); sink.srcObject = null; }); this.audioSinks.clear();
    this.videos.forEach(video => { video.pause(); video.srcObject = null; }); this.videos.clear();
    this.output?.getTracks().forEach(track => track.stop());
    if (this.audio.state !== "closed") void this.audio.close();
  }
}

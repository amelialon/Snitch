export interface VisualMarker {
  sharing_session_id: string;
  expected_marker: string;
  started_at: string;
  finished_at?: string;
  opacity: number;
  contrast: number;
}

export interface Region { x: number; y: number; score: number; color: number[] }

/** Score padded text footprints at 8×8 candidate locations, without sending pixels to a vendor. */
export function locateMarker(image: ImageData, textWidth: number, textHeight: number, contrast: number, previous?: Region): Region {
  const { width, height, data } = image;
  const w = Math.min(width, Math.ceil(textWidth + 16)), h = Math.min(height, Math.ceil(textHeight + 16));
  const sample = (x: number, y: number): Region => {
    const sums = [0, 0, 0]; let square = 0, edges = 0, count = 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const p = (yy * width + xx) * 4;
      let edge = 0;
      for (let c = 0; c < 3; c++) {
        sums[c] += data[p + c]; square += data[p + c] ** 2;
        if (xx > x && yy > y) edge = Math.max(edge, Math.abs(data[p + c] - data[p - 4 + c]), Math.abs(data[p + c] - data[p - width * 4 + c]));
      }
      if (edge > 22) edges++;
      count++;
    }
    const mean = sums.map(v => v / count);
    const variance = Math.max(0, square / (3 * count) - mean.reduce((s, v) => s + v * v, 0) / 3);
    const luminance = mean[0] * .2126 + mean[1] * .7152 + mean[2] * .0722;
    return { x: x / width, y: y / height, score: variance / 65025 + 3 * edges / count,
      color: mean.map(v => Math.round(Math.max(0, Math.min(255, v + (luminance > 128 ? -contrast : contrast))))) };
  };
  const regions: Region[] = [];
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) regions.push(sample(Math.round(col * (width - w) / 7), Math.round(row * (height - h) / 7)));
  regions.sort((a, b) => a.score - b.score);
  if (previous) {
    const current = sample(Math.max(0, Math.min(width - w, Math.round(previous.x * width))), Math.max(0, Math.min(height - h, Math.round(previous.y * height))));
    if (current.score <= regions[0].score * 1.25 + .012) return current;
  }
  return regions[0];
}

/** Owns raw capture and composited output. The returned stream is used for transmission AND recording. */
export class ScreenOverlay {
  private video = document.createElement("video");
  private canvas = document.createElement("canvas");
  private sample = document.createElement("canvas");
  private output: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cancelReady: (() => void) | null = null;
  private stopped = false;
  private target?: Region;
  private position?: { x: number; y: number };
  private analyzedAt = -Infinity;
  marker: VisualMarker | null = null;
  constructor(private source: MediaStream, private onEnded: () => void) {
    this.video.muted = true; this.video.playsInline = true; this.video.srcObject = source;
    source.getVideoTracks()[0]?.addEventListener("ended", this.end);
    source.getVideoTracks()[0]?.addEventListener("mute", this.end);
  }
  private end = () => { this.stop(); this.onEnded(); };
  async start(opacity = .35, contrast = 80): Promise<MediaStream> {
    if (this.stopped || this.source.getVideoTracks()[0]?.readyState !== "live") throw new Error("Screen capture stopped.");
    await new Promise<void>((resolve, reject) => {
      let frame: number | undefined;
      const cleanup = () => { clearTimeout(timeout); this.cancelReady = null; if (frame !== undefined) this.video.cancelVideoFrameCallback(frame); this.video.removeEventListener("loadeddata", loaded); };
      const fail = () => { cleanup(); reject(new Error("No screen frames arrived, or screen sharing was canceled.")); };
      const ready = () => { if (!this.video.videoWidth || this.stopped) return fail(); cleanup(); resolve(); };
      const loaded = () => { if (!("requestVideoFrameCallback" in this.video)) ready(); };
      const timeout = setTimeout(fail, 15000); this.cancelReady = fail;
      this.video.addEventListener("loadeddata", loaded);
      if ("requestVideoFrameCallback" in this.video) frame = this.video.requestVideoFrameCallback(ready);
      void this.video.play().catch(fail);
    });
    if (this.stopped) throw new Error("Screen sharing canceled.");
    const id = crypto.randomUUID();
    this.marker = { sharing_session_id: id, expected_marker: `workingTotal_${id.replaceAll("-", "").slice(0, 10)}`, started_at: new Date().toISOString(), opacity, contrast };
    this.draw(); this.output = this.canvas.captureStream(15);
    this.output.getVideoTracks()[0].contentHint = "detail";
    this.timer = setInterval(() => { try { this.draw(); } catch { this.end(); } }, 1000 / 15);
    return this.output;
  }
  private draw() {
    if (this.stopped || !this.marker) return;
    const width = this.video.videoWidth, height = this.video.videoHeight;
    if (!width || !height) return;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height; this.target = undefined; this.position = undefined; this.analyzedAt = -Infinity;
    }
    const ctx = this.canvas.getContext("2d")!;
    ctx.globalAlpha = 1; ctx.drawImage(this.video, 0, 0);
    const font = Math.max(14, Math.round(height / 48)); ctx.font = `500 ${font}px monospace`;
    if (performance.now() - this.analyzedAt >= 450) {
      const scale = Math.min(1, 640 / width);
      this.sample.width = Math.max(1, Math.round(width * scale)); this.sample.height = Math.max(1, Math.round(height * scale));
      const small = this.sample.getContext("2d", { willReadFrequently: true })!;
      small.drawImage(this.video, 0, 0, this.sample.width, this.sample.height);
      this.target = locateMarker(small.getImageData(0, 0, this.sample.width, this.sample.height), ctx.measureText(this.marker.expected_marker).width * scale, font * scale, this.marker.contrast, this.target);
      this.analyzedAt = performance.now();
    }
    if (!this.target) return;
    this.position ??= { x: this.target.x, y: this.target.y };
    this.position.x += (this.target.x - this.position.x) * .3; this.position.y += (this.target.y - this.position.y) * .3;
    ctx.fillStyle = `rgb(${this.target.color.join(",")})`; ctx.globalAlpha = this.marker.opacity;
    ctx.textBaseline = "top"; ctx.fillText(this.marker.expected_marker, this.position.x * width + 6, this.position.y * height + 6, width - 12); ctx.globalAlpha = 1;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.cancelReady?.(); if (this.timer !== null) clearInterval(this.timer);
    this.source.getVideoTracks()[0]?.removeEventListener("ended", this.end); this.source.getVideoTracks()[0]?.removeEventListener("mute", this.end);
    this.source.getTracks().forEach(t => t.stop()); this.output?.getTracks().forEach(t => t.stop());
    this.video.pause(); this.video.srcObject = null;
    this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

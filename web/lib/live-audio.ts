// The outgoing-audio mixer for a consented live interview.
//
// It builds ONE outgoing audio track = recruiter mic (+ a canary, only while sending). The mixed
// track is what the video SDK transmits. The canary is NOT routed to the recruiter's own speakers,
// so they hear it only via Preview — except in "audible" dev mode, where it is also monitored
// locally so you can first prove the candidate hears mic + canary before lowering the gain.
//
// This module is SDK-agnostic: it hands the finished MediaStreamTrack to a callback. It never
// synthesises audio; canary buffers come from CanaryLoader. Source buffers stay clean; gain is
// applied only at send time. Use is gated on the candidate's SPEC §6 consent by the caller.

import { type AudioCanary, dbToGain } from "./canary";

export interface SendResult {
  sentAt: number; // epoch ms
  finishedAt: number;
  gainDb: number;
}

export class OutgoingAudioMixer {
  private context: AudioContext;
  private mixBus: MediaStreamAudioDestinationNode;
  private cache = new Map<string, AudioBuffer>();
  private active: AudioBufferSourceNode | null = null;

  /**
   * @param micStream the recruiter's live microphone (from getUserMedia)
   * @param audibleDevMode when true, sent canaries also play on the recruiter's speakers
   */
  constructor(
    micStream: MediaStream,
    public audibleDevMode = false,
  ) {
    this.context = new AudioContext();
    this.mixBus = this.context.createMediaStreamDestination();
    // Mic is always in the outgoing mix; it is never interrupted by a canary.
    this.context.createMediaStreamSource(micStream).connect(this.mixBus);
  }

  /** The single track to hand to the call SDK as the outgoing audio source. */
  get outgoingTrack(): MediaStreamTrack {
    return this.mixBus.stream.getAudioTracks()[0];
  }

  async resume(): Promise<void> {
    if (this.context.state === "suspended") await this.context.resume();
  }

  async preload(canary: AudioCanary): Promise<void> {
    if (this.cache.has(canary.audioUrl)) return;
    const response = await fetch(canary.audioUrl);
    if (!response.ok) throw new Error(`Could not load ${canary.id} audio (${response.status})`);
    this.cache.set(canary.audioUrl, await this.context.decodeAudioData(await response.arrayBuffer()));
  }

  isReady(canary: AudioCanary): boolean {
    return this.cache.has(canary.audioUrl);
  }

  /** Preview: play locally to the recruiter only. Never reaches the outgoing mix. */
  async preview(canary: AudioCanary, gainDb: number): Promise<void> {
    await this.resume();
    await this.play(canary, gainDb, [this.context.destination]);
  }

  /**
   * Send: mix the canary into the outgoing track (and, in audible dev mode, the local speakers).
   * The mic keeps flowing throughout. Resolves when the canary finishes.
   */
  async send(canary: AudioCanary, gainDb: number): Promise<SendResult> {
    await this.resume();
    const destinations: AudioNode[] = [this.mixBus];
    if (this.audibleDevMode) destinations.push(this.context.destination);
    const sentAt = Date.now();
    await this.play(canary, gainDb, destinations);
    return { sentAt, finishedAt: Date.now(), gainDb };
  }

  private play(canary: AudioCanary, gainDb: number, destinations: AudioNode[]): Promise<void> {
    const buffer = this.cache.get(canary.audioUrl);
    if (!buffer) throw new Error(`${canary.id} is not preloaded — call preload() first`);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = dbToGain(gainDb); // source stays clean; gain applied only here
    source.connect(gain);
    destinations.forEach((d) => gain.connect(d));
    this.active = source;
    return new Promise<void>((resolve) => {
      source.onended = () => {
        if (this.active === source) this.active = null;
        resolve();
      };
      source.start();
    });
  }

  async close(): Promise<void> {
    this.active?.stop();
    await this.context.close();
  }
}

// Loading, decoding, gain, and local preview for pre-generated canary audio.
//
// This module NEVER synthesises audio. It prepares buffers and plays them locally to the
// recruiter (Preview). Transmitting a canary into a live call's outgoing audio is the call
// layer's job, and only in a session where the candidate has consented to automated integrity
// measures (SPEC §6). Keep source buffers clean; apply gain at playback time.

export interface AudioCanary {
  id: string;
  audioUrl: string;
  instruction: string;
  expectedMarker: string;
  durationMs: number;
}

/** dB is intuitive for "how loud"; Web Audio gain is linear. -24 dB ~= 0.063. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export async function loadManifest(url = "/canaries/manifest.json"): Promise<AudioCanary[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the canary manifest (${response.status})`);
  return response.json();
}

/**
 * Preloads and decodes a canary. Do this when the recruiter selects it, never at send time:
 * decoding at the moment of injection would add unpredictable latency. Decoded buffers are
 * cached per URL so a second call is instant.
 */
export class CanaryLoader {
  private cache = new Map<string, AudioBuffer>();

  constructor(private context: AudioContext) {}

  async preload(canary: AudioCanary): Promise<AudioBuffer> {
    const cached = this.cache.get(canary.audioUrl);
    if (cached) return cached;
    const response = await fetch(canary.audioUrl);
    if (!response.ok) throw new Error(`Could not load ${canary.id} audio (${response.status})`);
    const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
    this.cache.set(canary.audioUrl, buffer);
    return buffer;
  }

  isReady(canary: AudioCanary): boolean {
    return this.cache.has(canary.audioUrl);
  }
}

/**
 * Plays a decoded canary to a destination node through a gain stage, and resolves when it ends.
 * For Preview, pass `context.destination` (the recruiter's own speakers) -- this is local only.
 * The same helper mixes into an outgoing call by passing a MediaStreamAudioDestinationNode
 * instead; that path is used only in a consented live session.
 */
export function playBuffer(
  context: AudioContext,
  buffer: AudioBuffer,
  destination: AudioNode,
  gainDb: number,
): { done: Promise<void>; stop: () => void } {
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = dbToGain(gainDb);
  source.connect(gain).connect(destination);
  const done = new Promise<void>((resolve) => {
    source.onended = () => resolve();
  });
  source.start();
  return { done, stop: () => source.stop() };
}

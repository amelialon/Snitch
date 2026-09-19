// Thin wrapper over daily-js. Only the methods verified against node_modules/@daily-co/daily-js/
// index.d.ts are used: createCallObject, join, setInputDevicesAsync({ audioSource }), participants,
// leave. The custom outgoing audio track from OutgoingAudioMixer is applied via
// setInputDevicesAsync — the documented way to replace the outgoing mic with a custom track.

import Daily, { type DailyCall, type DailyParticipant } from "@daily-co/daily-js";

export interface RemoteTile {
  sessionId: string;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
}

export class LiveCall {
  private call: DailyCall;

  constructor() {
    this.call = Daily.createCallObject({ subscribeToTracksAutomatically: true });
  }

  /** Join a room. `outgoingAudioTrack` is the mixed mic(+canary) track from OutgoingAudioMixer. */
  async join(roomUrl: string, outgoingAudioTrack: MediaStreamTrack, token?: string): Promise<void> {
    await this.call.join({ url: roomUrl, token });
    await this.call.setInputDevicesAsync({ audioSource: outgoingAudioTrack });
  }

  /** The recruiter's own camera track, for the local self-view. */
  localVideoTrack(): MediaStreamTrack | null {
    return this.call.participants().local?.tracks.video.persistentTrack ?? null;
  }

  /** Remote participants (the candidate), for their tile. */
  remotes(): RemoteTile[] {
    return Object.values(this.call.participants())
      .filter((p): p is DailyParticipant => !p.local)
      .map((p) => ({
        sessionId: p.session_id,
        videoTrack: p.tracks.video.persistentTrack ?? null,
        audioTrack: p.tracks.audio.persistentTrack ?? null,
      }));
  }

  on(event: "participant-updated" | "participant-joined" | "participant-left" | "joined-meeting" | "left-meeting", handler: () => void): void {
    this.call.on(event, handler);
  }

  isConnected(): boolean {
    return this.call.meetingState() === "joined-meeting";
  }

  async leave(): Promise<void> {
    await this.call.leave();
    await this.call.destroy();
  }
}

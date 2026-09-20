import { API_URL } from "./api";

export interface CallTracks {
  camera: MediaStreamTrack | null;
  audio: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
}

export class LiveCall {
  private peer: RTCPeerConnection;
  private socket: WebSocket | null = null;
  private screenSender: RTCRtpSender | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private remoteScreen: MediaStreamTrack | null = null;
  private screenActive = false;
  private candidates: RTCIceCandidateInit[] = [];
  private closed = false;
  private joined = false;
  private messages = Promise.resolve();
  readonly remote: CallTracks = { camera: null, audio: null, screen: null };

  constructor(
    readonly local: MediaStream,
    private role: "host" | "candidate",
    iceServers: RTCIceServer[],
    private changed: () => void,
    private ended: (reason: string) => void,
    private apiUrl = API_URL,
  ) {
    this.peer = new RTCPeerConnection({ iceServers });
    if (role === "host") {
      this.peer.addTransceiver(local.getAudioTracks()[0], { direction: "sendrecv", streams: [local] });
      const camera = local.getVideoTracks()[0];
      this.peer.addTransceiver(camera ?? "video", { direction: "sendrecv", ...(camera ? { streams: [local] } : {}) });
      this.screenSender = this.peer.addTransceiver("video", { direction: "sendrecv" }).sender;
    }
    this.peer.onicecandidate = e => { if (e.candidate) this.send({ type: "ice", candidate: e.candidate.toJSON() }); };
    this.peer.ontrack = e => {
      const index = this.peer.getTransceivers().indexOf(e.transceiver);
      if (index === 0) this.remote.audio = e.track;
      if (index === 1) this.remote.camera = e.track;
      if (index === 2) this.remoteScreen = e.track;
      this.update();
      e.track.onunmute = () => this.update();
    };
    this.peer.onconnectionstatechange = () => {
      this.changed();
      if (this.peer.connectionState === "failed") this.ended("The call connection failed. The recording will be saved.");
    };
  }

  private update() {
    this.remote.screen = this.screenActive ? this.remoteScreen : null;
    this.changed();
  }

  private send(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  async join(id: string): Promise<void> {
    const url = new URL(`${this.apiUrl}/live-interviews/${id}/signal`, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("role", this.role);
    this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Could not connect to the interview room.")), 12000);
      this.socket!.onerror = () => { clearTimeout(timer); reject(new Error("Could not connect to the interview server. Check that the backend is running.")); };
      this.socket!.onclose = () => {
        clearTimeout(timer);
        reject(new Error("The interview room connection closed."));
        if (!this.closed && this.joined) this.ended("The room connection closed. Saving your recording.");
      };
      this.socket!.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === "joined") { this.joined = true; clearTimeout(timer); resolve(); return; }
        if (message.type === "error") { clearTimeout(timer); reject(new Error(message.message)); return; }
        // SDP and ICE must be handled in arrival order, including candidates arriving while
        // setRemoteDescription is still awaiting completion.
        this.messages = this.messages.then(async () => {
          if (this.closed) return;
          if (message.type === "peer-ready") this.send({ type: "screen-state", active: !!this.screenTrack });
          if (message.type === "peer-ready" && this.role === "host") {
            await this.peer.setLocalDescription(await this.peer.createOffer());
            this.send({ type: "offer", description: this.peer.localDescription });
          } else if (message.type === "offer" || message.type === "answer") {
            await this.peer.setRemoteDescription(message.description);
            for (const candidate of this.candidates.splice(0)) await this.peer.addIceCandidate(candidate);
            if (message.type === "offer") {
              // The answerer must use the offer's transceivers. Pre-creating its own with
              // addTransceiver would leave those tracks on unnegotiated extra m-lines.
              const [audio, camera, screen] = this.peer.getTransceivers();
              audio.direction = camera.direction = screen.direction = "sendrecv";
              await audio.sender.replaceTrack(this.local.getAudioTracks()[0]);
              await camera.sender.replaceTrack(this.local.getVideoTracks()[0] ?? null);
              this.screenSender = screen.sender;
              await this.screenSender.replaceTrack(this.screenTrack);
              await this.peer.setLocalDescription(await this.peer.createAnswer());
              this.send({ type: "answer", description: this.peer.localDescription });
            }
          } else if (message.type === "ice") {
            if (this.peer.remoteDescription) await this.peer.addIceCandidate(message.candidate);
            else this.candidates.push(message.candidate);
          } else if (message.type === "screen-state") {
            this.screenActive = !!message.active; this.update();
          } else if (message.type === "end" || message.type === "peer-left") {
            this.ended("The other participant ended the interview.");
          }
        }).catch(() => this.ended("Unable to establish the media connection. Any recording will be saved."));
      };
    });
  }

  get connected() { return this.peer.connectionState === "connected"; }

  async share(track: MediaStreamTrack | null) {
    if (track) track.contentHint = "detail";
    this.screenTrack = track;
    await this.screenSender?.replaceTrack(track);
    this.send({ type: "screen-state", active: !!track });
  }

  leave() {
    if (this.closed) return;
    this.send({ type: "end" }); this.closed = true;
    this.socket?.close(); this.peer.close();
    this.local.getTracks().forEach(t => t.stop());
  }
}

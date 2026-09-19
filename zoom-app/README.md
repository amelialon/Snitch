# Zoom App — canary injection

A Zoom App (runs in the Zoom desktop client's meeting sidebar) that does one thing: delivers a
pre-generated canary (SPEC §6) into a live, consented interview through Zoom, and logs it to the
review backend. It is the Zoom counterpart of the Daily live room in `web/app/live/[id]`.

It does not transcribe, analyse, or decide anything. It never synthesises audio; the `.wav`
files come from `web/public/canaries/` (the audio team's assets), served by this server.

## Two channels

| Channel | How | Zoom API | What the candidate experiences |
|---|---|---|---|
| **Visual** | Prints the instruction onto the recruiter's *outgoing* camera feed at a chosen opacity, size, and position, for N seconds. A copilot that screenshots the candidate's screen may OCR it. | Layers API camera mode: `runRenderingContext({view:"camera"})`, `drawParticipant` (self), `drawImage`, `clearImage` | Faint text on the recruiter's video tile. The recruiter's own sidebar is untouched. |
| **Audio** | Plays the canary at a chosen gain through an **app share with sound** (the app switches to a plain "question slide" for the duration) or through **computer-audio share**. | `shareApp({action:"start", withSound:true})` or `shareComputerAudio()` | A brief shared slide with the question, plus low-level share audio. |

**Why the audio path is a share, not a mic mix:** the Zoom Apps SDK has no API for replacing or
mixing the outgoing microphone track (that is what `setInputDevicesAsync` gives us in Daily).
Share audio is the only audio an in-client app can send. Both share paths are mono and go through
Zoom's share-audio pipeline, so survival must be measured separately from the Daily mix (SPEC §6
validation item 1). If a real mic mix is required on Zoom, the options are a meeting bot (Meeting
SDK) or a virtual audio device on the recruiter's machine — see architecture.md §11.

## Gate

Nothing is sent unless all three hold: an interview is selected (it already carries the recording
+ analysis consent), the recruiter ticks the §6 disclosure attestation, and a canary is loaded.
Every send writes a `CanaryEvent` with `channel`, `delivery_method`, `platform: "zoom"`, and
either `gain_db` or `overlay_opacity`.

## Run it

```bash
# 1. review backend (owns the session log)
cd backend && .venv/bin/python -m interview_review.cli serve        # :8000

# 2. this server
cd zoom-app && npm install && cp .env.example .env && npm start      # :3400

# 3. expose it over HTTPS (Zoom only loads https home URLs)
ngrok http 3400
```

Then in the [Zoom App Marketplace](https://marketplace.zoom.us/) → Develop → Build App →
**General App**:

1. **App credentials** → copy Client ID / Client Secret into `zoom-app/.env`, set `PUBLIC_URL`
   to the ngrok URL, restart the server.
2. **Basic information**: Home URL = `PUBLIC_URL`; OAuth Redirect URL = `PUBLIC_URL/auth`;
   OAuth allow list = `PUBLIC_URL`. Domain allow list: your ngrok host and `appssdk.zoom.us`.
3. **Features → Surface**: enable *Zoom App SDK*, *In-client OAuth*, and *Meetings*. In the
   **Zoom App SDK** API list add: `getRunningContext`, `getUserContext`, `getMeetingUUID`,
   `runRenderingContext`, `closeRenderingContext`, `drawParticipant`, `clearParticipant`,
   `drawImage`, `clearImage`, `onRenderedAppOpened`, `shareApp`, `onShareApp`,
   `shareComputerAudio`.
4. **Scopes**: `zoomapp:inmeeting`.
5. **Local Test** → **Add** (or open `PUBLIC_URL/install`). The OAuth callback exchanges the code
   and redirects to a `zoomapp://` deep link that opens the app in the client.
6. Start a meeting, open **Apps** → this app.

The Zoom client webview is Chromium; the page also opens in a normal browser (without the SDK)
so you can check the interview list, canaries, overlay preview, and local audio preview.

## In the meeting

1. Pick the interview and tick the disclosure attestation.
2. Add the questions you plan to ask; **Start** one when you ask it (logged with timestamps).
3. Pick a canary (audio preloads immediately; the overlay preview updates).
4. **Visual**: *Start camera mode* once (your video now routes through the app, unchanged), then
   *Show on my video* right before asking the question. Tune opacity/size on the preview.
5. **Audio**: *Send canary*. With the slide method the app swaps to the stage view, starts the
   share with sound, plays the canary, and (by default) stops the share and comes back with the
   **ASK NOW** cue.
6. After transcription, `POST /interviews/{id}/canaries/{canary_id}/check` runs marker detection
   against the answer, as for the Daily room.

## Files

- `server.js` — Express: Zoom's required security headers, `/install` + `/auth` OAuth, `/api/*`
  proxy to the backend, static app and `/canaries/*` from `web/public/canaries`.
- `public/app.js` — the app. `startCameraMode` / `sendVisual` (Layers API) and `sendAudio`
  (share paths); `armed()` is the consent gate every send passes through.
- `public/index.html` — the recruiter console and the candidate-safe stage view.

## Known limits

- **Camera mode needs your video on** and a client that supports the Layers API (5.11+).
  Draw calls can fail if issued before the off-screen webview opens; the app waits for
  `onRenderedAppOpened` (2.5 s ceiling) before drawing.
- **`shareApp` shares this page.** The app hides its console and shows the stage while shared,
  and restores it on `onShareApp: stop`. If you start a share from Zoom's own UI, the same swap
  happens.
- **`shareComputerAudio`** prompts the recruiter once and shares all system audio; stopping it is
  done from Zoom's share bar. A reported client bug caps the system volume at its level when the
  share started — set volume first.
- **Not verified**: the `X-Zoom-App-Context` header is not decrypted (the demo has no auth on the
  backend either). Add it before any real candidate data.
- Whole-word marker matching only, no clean-mic separate recording — same status as the Daily
  room.

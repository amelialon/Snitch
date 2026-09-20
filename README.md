# Interview Integrity Review

A second-look tool for recruiters. It reviews a recorded interview and returns a few timestamped
moments worth a closer look, each with the evidence behind it — plus a separate list of places
where spoken claims and the CV disagree. It never scores a candidate or recommends a decision.

Read [context.md](context.md) first (what this is and the rules it must not break), then
[SPEC.md](SPEC.md) (product behavior) and [architecture.md](architecture.md) (how it is built).

## Clone setup

```bash
cp .env.example backend/.env              # optional — offline demo needs no keys
cp web/.env.local.example web/.env.local    # optional — defaults to http://localhost:8000
```

Never commit `backend/.env`, `web/.env.local`, or `*-service-account.json`.

## Run the demo (no API keys)

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python samples/make_sample.py          # writes a synthetic interview transcript
.venv/bin/python -m interview_review.cli run samples/sample_interview.json \
    --cv samples/sample_cv.txt --consent-by you@example.com
```

That prints a full review using the offline adapters (rule-based segmentation, no vendors).
Add keys in `backend/.env` (see [.env.example](.env.example)) to swap in AssemblyAI, Claude,
GPTZero, and OpenAI one at a time; every report names which adapters produced it.

## Run the app

```bash
cd backend && .venv/bin/python -m interview_review.cli serve   # API on :8000
cd web && npm install && npm run dev                            # app on :3000
```

Upload a recording (or a transcript `.json`) plus an optional CV, and review the result.

### Live interviews and screen sharing

Open **Live interviews**, create an interview, and copy its invitation link for the candidate.
Both participants join inside this app; no Daily/Zoom account or external room URL is required.
The interviewer starts a recorded interview after confirming consent. Both cameras, both
microphones, and any shared screen are captured. Screen/system audio and audio canaries are excluded.
Shared screens include an adaptive visual watermark, composited before transmission and recording.
Adjust its visibility before starting screen sharing; each sharing session gets a fresh saved identifier.

Choose **End interview & create review** to finalize the video, upload it, and open its review
while transcription/analysis runs. If a candidate leaves, the interviewer also finalizes and
saves the recording. Failed uploads retain a browser copy with retry and download controls.
Reopen the same room in the same browser to recover locally saved chunks after interruption.
An existing completed review is preserved when another interview is recorded from its room.

The local app address works on this computer. Other devices need a reachable HTTPS deployment
and matching API/CORS configuration. Restrictive networks may need an operator-configured TURN
relay via `WEBRTC_ICE_SERVERS` (JSON RTCIceServer array). No external account setup is part of the
participant flow. Use one backend worker for the in-memory signaling room registry. Automated
review uses the project's configured transcription/analysis adapters; recording alone needs no
vendor API key. See [live recording validation](docs/live-recording-validation.md).

Restart the Python backend after updating it so the new live-session routes are available.
On Windows, from `backend`: `.\.venv\Scripts\python.exe -m interview_review.cli serve`.

## Deploy (backend on Railway, web on Vercel)

The API and its background pipeline jobs are one long-running process, so the backend cannot be a
serverless function; it runs as a container on Railway. The web app is static-friendly Next.js and
goes on Vercel. Neither needs code changes, only environment variables.

**Backend (Railway):** create a service from this repo with root directory `backend`. It picks up
[backend/Dockerfile](backend/Dockerfile) and [backend/railway.json](backend/railway.json)
(one replica, no sleeping, `/health` check). Set:

| Variable | Value |
|---|---|
| `STORE` | `firebase` — the container's disk is wiped on every deploy, so `local` would lose recordings |
| `FIREBASE_CREDENTIALS` | the service-account key file's **JSON contents** (no file to point at on Railway) |
| `FIREBASE_STORAGE_BUCKET` | `your-project-id.firebasestorage.app` |
| `ASSEMBLYAI_API_KEY`, `OPENAI_API_KEY`, `GPTZERO_API_KEY` | as in `.env.example`; omit any to use the offline adapter |
| `WEB_ORIGIN` | the Vercel URL(s), comma-separated, e.g. `https://your-app.vercel.app,http://localhost:3000` |
| `WEBRTC_ICE_SERVERS` | optional TURN relay for live interviews on restrictive networks |

Keep it at one replica and one worker: the live-interview signaling registry is in process memory,
and a background review job dies with its process if the service is scaled to zero.

**Web (Vercel):** import the repo with root directory `web` and set
`NEXT_PUBLIC_API_URL=https://<your-railway-service>.up.railway.app`.

**Access:** the API has no auth. A deployed URL must be treated as the demo environment in
context.md rule 11 — mock or explicitly consented recordings only — and should sit behind a
deployment password before anyone outside the team is given the link (architecture.md §7).

## Tests

```bash
cd backend && .venv/bin/pytest        # 34 tests, no network
cd web && npx tsc --noEmit
```

## Layout

- `backend/` — the pipeline and API. `review.py` is the pure core that decides flags;
  `adapters/` holds the vendor and storage implementations behind `ports.py`.
- `web/` — Next.js app: upload, live progress, and the review page.
- `zoom-app/` — Zoom App that injects a canary (visual on your camera, audio via share) inside a
  Zoom meeting and logs it to the backend. See [zoom-app/README.md](zoom-app/README.md).
- `firebase/` — deny-all security rules for the no-auth demo.

## Status

Working: upload → transcribe → segment → baseline → timing/delivery/content signals → fusion →
report, with CV consistency and reviewer feedback. In-app WebRTC interviews with screen sharing,
browser recording/recovery, and automatic upload into the review pipeline.
Zoom App (`zoom-app/`) with the canaries: visual overlay on the outgoing camera (Layers API)
and audio via app-share-with-sound; needs a Marketplace app + ngrok (see its README).
Gaze/prosody signals, separate clean-mic recording, and the bias eval set are post-demo
(architecture.md §10–§11).

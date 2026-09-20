# Architecture

## Current live call and recording flow

The native WebRTC implementation replaces Daily and the live canary/watermark interface.
`live.py` supplies two-person WebSocket signaling under `/live-interviews/{id}/signal` and
`GET /live-config` for optional operator-configured ICE servers. Only the host creates the
audio/camera/screen transceivers; the candidate answers using those negotiated transceivers.
The signaling registry is process-local and requires one API worker. Deployment across machines
needs reachable HTTPS/WSS and may require TURN; no external website is used by participants.

`InterviewRecorder` mixes the interviewer and remote microphone into one audio bus and records
a 1280×720 canvas containing both cameras plus any shared screen. MediaRecorder emits chunks
every three seconds; IndexedDB stores recovery copies. The browser retains a completed video
until the server accepts it. End/peer departure finalizes recording before stopping tracks.
Abrupt tab/browser termination may lose the last unflushed chunk; reopen the room for recovery.
The page's unload guard warns about leaving while recording/uploading, but SPA navigation can
still require recovery on return. Browser background throttling can reduce video frame rate.

`POST /live-interviews/{id}/recording` validates a consented WebM/MP4 upload, attaches it to an
unrecorded live interview (or creates a new review when the original already has a recording),
then runs the existing pipeline. A persistent receipt keyed by recording UUID deduplicates
retries. Upload finalization is serialized within the single API worker. Background processing
is still the existing in-process task model; process failure may require a manual rerun.
Historical canary record models remain compatible with old reviews; new calls emit no canaries.

The screen-share implementation notes below describe the superseded watermark prototype.

## Live screen-share implementation (2026-09-19)

`web/lib/screen-overlay.ts` owns capture-frame readiness, local pixel analysis and a canvas
compositor. A 15 fps canvas stream feeds Daily `startScreenShare({mediaStream})`; no CSS overlay
is relied upon for transmission. An 8×8 candidate search samples the complete padded text
footprint at a maximum analysis width of 640 pixels every 450 ms. It computes RGB variance,
luminance, and adjacent-pixel edge density, with hysteresis and smooth movement. These heuristics
cannot guarantee avoidance of every UI control. Browser background throttling may reduce fps.

`ScreenShare` handles chooser cancellation, SDK readiness/error events, track end/mute, navigation,
call leave and pending-start cancellation. It persists the identifier before transmission and
fails closed if that save fails. End-timestamp failures offer retry while the component remains
mounted; an abrupt tab/process termination can leave the end timestamp absent.

`POST /live-interviews` creates a consented, recording-free record with `stage=live`.
`PUT/GET /interviews/{id}/screen-shares/{uuid}` stores/reads a separate JSON artifact per share;
identity and settings are immutable and writes are idempotent. `POST .../{uuid}/check` performs
whole-identifier matching against submitted text, without feeding a verdict into the pipeline.
Concurrent interviews need distinct Daily room URLs; this demo does not provision Daily rooms.

`/live/calibrate` uses two local RTCPeerConnections with VP8 preference and a 1 Mbps send cap,
then snapshots the decoded receiver video. It supports blind recovery entry and JSON export.
It is a local codec check, not an SFU/network/device certification. Remote test procedure and
observations are in `docs/screen-share-validation.md`.

How the demo system is put together. Product behavior lives in [SPEC.md](SPEC.md); background, glossary, and decisions live in [context.md](context.md).

This is revision 2. Revision 1 was reviewed against the deep-module vocabulary (module, interface, depth, seam, adapter) and cut down; §9 records what was removed and why.

## 1. System overview

```
┌──────────────────────┐   REST    ┌──────────────────────────────────────────────┐
│  Web (Next.js)       │──────────►│  Backend (one Python package)                │
│  /        list       │           │                                              │
│  /new     upload     │◄──────────│  api.py ──► pipeline.py ──► review.py (pure) │
│  /i/{id}  review     │   JSON    │                 │                            │
└──────────────────────┘           │     ┌───────────┼───────────┬─────────────┐  │
                                   │     ▼           ▼           ▼             ▼  │
                                   │   Store    Transcriber   Analyst   AiTextDetector
                                   └─────┬───────────┬───────────┬─────────────┬──┘
                                         │           │           │             │
                              local disk │ Firebase  │ AssemblyAI│ OpenAI      │ GPTZero
                              (dev/test) │ (deployed)│           │             │
```

Two deployables: `web/` and `backend/`. The web app talks **only** to the backend API. It has no Firebase dependency and no vendor keys.

Deployment shape: `web/` on Vercel; `backend/` as one container on a long-running host (Railway, via `backend/Dockerfile` + `backend/railway.json`). The backend cannot be serverless: `POST /interviews` hands the pipeline to a FastAPI background task that outlives the request, `/live-interviews/{id}/signal` is a WebSocket, and the signaling room registry lives in process memory — so exactly one replica, one worker, never scaled to zero. `FirebaseStore` is mandatory there (ephemeral disk); `FIREBASE_CREDENTIALS` may hold the key JSON itself since the host has no files. See README "Deploy".

## 2. Modules

| Module | Interface (what callers must know) | Hides |
|---|---|---|
| `review.py` | `review(transcript, segmentation, evidence, config) → ReviewResult`. Pure: no I/O, no clock, no randomness. | Baseline construction, question-type adjustment, all timing/delivery/content signal math, style suppression, the ≥2-families rule, confidence labels, ranking, the 0–5 cap, skip reporting |
| `pipeline.py` | `run_pipeline(interview_id, deps, force=False)`. Never raises; outcome lands on the interview record. | Step order, caching of paid steps, progress updates, which failures are fatal vs. reported as skipped, CV text extraction, narrative fallback, emotion-language guard |
| `api.py` | HTTP routes (§5) | Upload handling, background execution, media serving, live-session logging |
| `canary.py` | `check_marker(text, marker)`, and the `QuestionEvent`/`CanaryEvent`/`SessionLog` records | Whole-word marker matching; the append-only live-session log |
| `ports.py` | The five seams below | — |

`review.py` is the core deep module: one function in, everything the product promises about flags behind it. It is also the primary test surface.

### Seams

Each seam exists because two adapters really do vary across it.

| Seam | Interface | Adapters |
|---|---|---|
| `Store` | `create_interview`, `get_interview`, `list_interviews`, `update_interview`, `delete_interview`, `put_file`, `has_file`, `local_path`, `public_url` | `LocalStore` (disk; dev, tests, CLI) · `FirebaseStore` (Firestore + Cloud Storage) |
| `Transcriber` | `transcribe(path) → Transcript` | `AssemblyAITranscriber` · `JsonTranscriber` (reads a transcript JSON; offline demo + tests) |
| `Analyst` | `segment(turns)`, `judge_depth(parent, follow_ups)`, `explain_flags(contexts)` | `OpenAIAnalyst` (OpenAI Responses API, structured outputs, server-side key) · `HeuristicAnalyst` (rule-based; offline demo + tests) |
| `AiTextDetector` | `score(text) → float` | `GPTZeroDetector` · none configured → signal reported as skipped |
| `CvAnalyzer` | `find_inconsistencies(cv_text, units) → [CvFinding]` | `OpenAICvAnalyzer` (OpenAI Responses API, structured outputs, server-side key) · none configured → section reported as skipped |

The `Analyst` interface is one method per operation, not a generic `complete(prompt)`: each is independently fakeable and returns one typed shape. CV consistency is its **own seam** (`CvAnalyzer`), separate from the `Analyst` even though both happen to use OpenAI — that separation is what keeps a CV finding from ever creating or strengthening a flag (SPEC §3.6). One `OPENAI_API_KEY` powers both.

With no API keys set, the backend wires the offline adapters and the whole product runs locally against a transcript JSON. The report states which adapters produced it.

## 3. Pipeline steps

| # | Step | Uses | Cached | On failure |
|---|---|---|---|---|
| 1 | Transcribe | `Transcriber` | `transcript.json` | **fatal** |
| 2 | Segment + classify (one LLM call: units, follow-up nesting, candidate speaker, question type, difficulty, baseline tags) | `Analyst.segment` | `segmentation.json` | **fatal** |
| 3 | Gather content evidence: AI-text score per answer ≥50 words (incl. baseline answers), depth judgment per unit with follow-ups | `AiTextDetector`, `Analyst.judge_depth` | — | skip that signal, report it |
| 4 | Review (baseline → signals → fusion) | `review.py` | — | fatal (it's pure; failure = bug) |
| 5 | CV consistency | `Analyst.find_cv_inconsistencies` | — | skip section, report it |
| 6 | Narratives (explanation, alternatives, verification question per flag) | `Analyst.explain_flags` | — | deterministic template fallback |

Output: one `report.json` (units, signals, flags, CV findings, skipped list, adapter names). Steps 1–2 are cached because they cost money and don't change when thresholds do; everything else re-runs in seconds. Caching is plain overwrite-on-`force`, no versioning.

**The flag decision has no LLM in it.** Step 4 is deterministic rules over a `ReviewConfig` of thresholds. The LLM supplies evidence (step 3) and prose (step 6). Narratives containing emotion or deception language are discarded in favor of the template.

### Signals in the demo

All computed from ASR word timestamps and text. No audio or video processing.

| Family | Signal | Anomalous when |
|---|---|---|
| A timing | `pause_then_fluent` | Latency exceeds the candidate's baseline (robust z-score) after a per-question-type allowance, **and** the answer opens fluently (no fillers/thinking-aloud in the first words) |
| B delivery | `disfluency_drop` | Filler rate falls far below the candidate's own baseline on a long answer |
| B delivery | `even_pace` | Word-gap variability falls far below baseline (read-speech regularity) |
| C content | `ai_text` | GPTZero score is high **and** well above the score of the candidate's own baseline answers |
| C content | `depth_collapse` | Analyst judges that a substantial answer was followed by shallow/restated follow-up answers |

Interview-level pass: a signal anomalous in most eligible answers is treated as the candidate's natural style, suppressed, and reported. A flag needs ≥2 families on the same unit group (parent + follow-ups).

Post-demo signals (prosody via audio, gaze via video, canary) emit the same `Signal` shape and plug into fusion unchanged.

## 4. Data

```
Interview (record)                     Files per interview
  id, candidate_label                    recording.<ext>
  status: processing | ready | failed    cv.<ext>, cover_letter.<ext>
  stage, progress                        transcript.json
  context_flags, consent                 segmentation.json
  summary {flag_count, duration, …}      report.json
  feedback {flag_id → useful, reason}
  error, owner_id, org_id, timestamps
```

- `LocalStore`: `data/{id}/interview.json` + `data/{id}/files/*`.
- `FirebaseStore`: Firestore `interviews/{id}` + Cloud Storage `interviews/{id}/*`. The report is a file, not subcollections: it's read whole, written whole, and transcripts exceed Firestore's 1 MiB document limit anyway.
- Reports are immutable once written; reviewer feedback lives on the interview record, keyed by stable flag ID (`flag-{unit_id}`).
- A "partial" result is not a status. Skipped signals are listed in every report, and `ready` with skips is normal.

## 5. API

| Method | Path | Does |
|---|---|---|
| `POST` | `/interviews` | Multipart: label, context flags, consent attestation, recording, optional CV/cover letter. Rejects without consent. Stores files, starts the pipeline in the background, returns the interview. |
| `GET` | `/interviews` | List |
| `GET` | `/interviews/{id}` | Interview + report when ready. The web app polls this while `processing`. |
| `GET` | `/interviews/{id}/transcript` | Words with speaker and timing, for the synced transcript |
| `GET` | `/interviews/{id}/media` | Recording with HTTP range support (local) or redirect to a signed URL (Firebase) |
| `POST` | `/interviews/{id}/rerun` | Re-run; `force=true` also re-runs cached steps |
| `POST` | `/interviews/{id}/flags/{flag_id}/feedback` | useful / not useful + reason |
| `DELETE` | `/interviews/{id}` | Remove record and all files |
| `GET` | `/health` | Liveness + which adapters are wired |

## 6. Frontend

Next.js (App Router) + TypeScript + Tailwind. Client components fetching the API; one hand-written `types.ts`; polling every 2s while processing.

Review page: player with flag markers on a timeline (clicking seeks to 5s before the moment, so the reviewer hears the question), transcript synced to playback with flagged units highlighted, flag cards (explanation, confidence, signals grouped by family with evidence numbers, alternative explanations, verification question, useful/not-useful), a visually separate CV section, and an always-visible skipped-signals section. Never rendered: a score, a verdict, a reject recommendation, or sorting by flag count.

## 7. Security posture (demo, no auth)

- Web never touches Firebase. Firestore and Storage rules are **deny-all**; the backend uses the Admin SDK. No auth therefore exposes the API, not the database.
- The API is unauthenticated: run locally or behind a deployment password. Mock or explicitly consented recordings only.
- Vendor keys and the Firebase service account live in the backend environment only.
- Candidate audio/text goes to three vendors; DPAs and zero-retention settings are required before real data.
- Adding auth later = token-verifying middleware in `api.py` + filtering by `owner_id`/`org_id`, which every record already carries.

## 8. Repo layout

```
backend/
  pyproject.toml
  src/interview_review/
    models.py        Pydantic shapes (single source of truth)
    review.py        pure core: baseline, signals, fusion
    narrative.py     template explanations + emotion-language guard
    ports.py         Store, Transcriber, Analyst, AiTextDetector
    pipeline.py      run_pipeline
    api.py           FastAPI app factory
    wiring.py        env → adapters
    cli.py           run a review from the terminal
    adapters/        local_store, firebase_store, assemblyai, claude_analyst,
                     heuristic_analyst, gptzero, json_transcriber
  tests/             one file per agreed seam (below)
  samples/           synthetic interview transcript + CV for the offline demo
web/
  app/               /, /new, /i/[id], /live/[id]
  components/  lib/
zoom-app/            Zoom App: canary injection inside a Zoom meeting (§11)
  server.js          headers, OAuth install, /api proxy, static
  public/            app.js, index.html, styles.css
firebase/            deny-all rules
```

**Test seams** (tests exist only at these): `review()` · `run_pipeline()` with offline adapters and `LocalStore` · the HTTP API · the `Store` contract. Vendor adapters are thin translations and are not unit-tested against mocks of their own HTTP calls.

Rule: nothing under `review.py`/`pipeline.py` imports `api.py`. The CLI and the API are two callers of the same `run_pipeline`.

## 9. What revision 1 had that this doesn't

| Removed | Why |
|---|---|
| 13 stages with versioned artifacts, lineage headers, config hashes | Fails the deletion test for a demo: nothing reads them. Caching two paid steps gives the real benefit. |
| Separate `clean`, `classify`, `report`, and per-family signal stages | Shallow: each was a thin pass-through with its own artifact. Merged. |
| Browser reading Firestore directly + writes via API | Two data paths and an open-read database with no auth. One path through the API; deny-all rules. |
| TypeScript types generated from Pydantic | Build machinery for ~10 types. |
| Silero VAD (PyTorch), parselmouth, ffmpeg | ~2 GB of dependencies. Demo signals need only word timestamps; pauses of interest are seconds long, well within ASR timing accuracy. |
| Separate `api/` and `pipeline/` packages | One deployable. The import rule gives the same isolation. |
| Firestore subcollections for units/flags/findings | The report is read and written whole. |
| `ready_partial`, `queued`, `awaiting_upload` statuses | Skips are always listed; create+upload+start is one request. |
| Celery/Redis | A background task is enough until there's a second machine. |

## 10. After the demo

| Change | Trigger |
|---|---|
| Auth middleware + per-org filtering | Before any real candidate data |
| Retention job, append-only audit log | Before any pilot |
| Pipeline on Cloud Run jobs; direct-to-storage signed uploads | First deployment with multi-GB files or concurrent users |
| Prosody signals (audio), gaze signals (video, quality-gated) | Phase 2 |
| Eval harness + per-group false-positive gate over a labeled dataset | Before any signal is trusted in production |
| Live two-person interview room + outgoing-audio mix | Phase 3, after the video-SDK decision (§11) and lab validation |
| Zoom mic-path audio (meeting bot or virtual device) | Only if share-audio survival (§11 Zoom App) fails validation |

## 11. Live canary (Phase 3, partially built)

The canary is the disclosed integrity measure from SPEC §6: a pre-generated spoken instruction
mixed at low level into the interviewer's outgoing call audio, to test whether a real-time AI
copilot picks it up. It runs **only** in a session where the candidate consented to "measures to
detect the use of unauthorized real-time assistance tools" — the same consent attestation the
rest of the product requires. It is one signal in the canary family, subject to the ≥2-families
rule; a triggered marker is never proof on its own.

**This app does not generate audio.** A separate part of the project produces the `.wav` files;
this app loads, schedules, previews, mixes, transmits, logs, and analyzes them.

Built now:

| Piece | Where | Notes |
|---|---|---|
| Canary manifest (`AudioCanary[]`) | `web/public/canaries/manifest.json` | Dev source; later a backend endpoint |
| Preload + decode + gain + local Preview | `web/lib/canary.ts` | `decodeAudioData` at select time, cached; `dbToGain`; Preview plays to the recruiter's own speakers only — never transmitted |
| Question + canary event records | `backend/.../canary.py` | `QuestionEvent` (question/answer timestamps for latency analysis), `CanaryEvent` (canary id, marker, gain, sent/finished, delivery method) |
| Session log endpoints | `api.py` `/interviews/{id}/questions`, `/canaries`, `/canaries/{id}/check`, `GET /session` | Append-only `session_log.json` per interview |
| Marker detection | `check_marker(text, marker)` | Whole-word, case-insensitive (MVP); records `response_contained_marker` |

**Live room (built, Daily).** SDK = `@daily-co/daily-js`, chosen because it accepts a custom
outgoing `MediaStreamTrack` via `setInputDevicesAsync({ audioSource })` — verified against its
bundled `index.d.ts`, no invented methods.

| Piece | Where |
|---|---|
| Outgoing-audio mixer | `web/lib/live-audio.ts` — `OutgoingAudioMixer`: one `MediaStreamAudioDestinationNode` fed by the mic source, plus a gained canary buffer only while sending. SDK-agnostic (hands out a `MediaStreamTrack`), so it is unit-testable. |
| Daily wrapper | `web/lib/daily.ts` — `join` then `setInputDevicesAsync({ audioSource: mixer.outgoingTrack })`; participant tiles from `participants()` |
| Room UI | `web/app/live/[id]/page.tsx` — video tiles, question controls with timestamps, canary select/preload/preview/gain/Send/Send+Ask, status; writes events to the §5 session endpoints |

The canary is not routed to the recruiter's speakers, so they hear it only via Preview — except
in **audible dev mode** (default on), which also monitors it locally so you first prove the
candidate hears mic + canary near 0 dB, then lower the gain. The source buffer stays clean; gain
is applied only at send. The mic is never interrupted. Needs `NEXT_PUBLIC_DAILY_ROOM_URL`; without
it the room shows a config notice.

**Zoom App (built, `zoom-app/`).** A second delivery surface for the same canaries, for
interviews that happen on Zoom rather than in our Daily room. It runs inside the Zoom client's
meeting sidebar (Zoom Apps SDK via `https://appssdk.zoom.us/sdk.js`), fronted by a small Express
server that adds Zoom's required security headers, handles the one-time OAuth install, and
proxies `/api/*` to the backend's §5 session endpoints so the page stays same-origin.

| Channel | Mechanism | `delivery_method` |
|---|---|---|
| Visual | Layers API camera mode: `runRenderingContext({view:"camera"})`, `drawParticipant` (self) then `drawImage` of a transparent text strip at a chosen opacity/size/position for N seconds, then `clearImage`. Alters only the recruiter's **outgoing** video. | `zoom-camera-overlay` |
| Audio | The Zoom Apps SDK cannot replace or mix the mic track. The canary is played (gain applied at playback) through `shareApp({action:"start", withSound:true})` — the page swaps to a candidate-safe "question slide" while shared — or `shareComputerAudio()`. | `zoom-share-app-sound`, `zoom-computer-audio` |

`CanaryEvent` gained `channel` (`audio`/`visual`), `platform`, and `overlay_opacity` so the two
surfaces log comparably; Daily-room events now carry `platform: "daily"`. The consent gate is
the same: no interview + §6 attestation + loaded canary, no send.

Open question 5 (bot vs. virtual device) is narrowed, not closed: for a true mic-path mix on
Zoom the choices remain a Meeting-SDK bot or a virtual audio device; the Zoom App gives the
visual channel cleanly and an audio channel via share audio only.

**Still to do:** recording the interviewer's clean mic *separately* from the canary-mixed
outgoing track (so forensic transcription never runs on contaminated audio) — Daily's raw-tracks /
recording hooks, not yet wired. Semantic marker matching (currently whole-word). For the Zoom
app: decrypt the `X-Zoom-App-Context` header, and measure share-audio survival separately from
the Daily mix (SPEC §6 validation 1).

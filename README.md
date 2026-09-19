# Interview Integrity Review

A second-look tool for recruiters. It reviews a recorded interview and returns a few timestamped
moments worth a closer look, each with the evidence behind it — plus a separate list of places
where spoken claims and the CV disagree. It never scores a candidate or recommends a decision.

Read [context.md](context.md) first (what this is and the rules it must not break), then
[SPEC.md](SPEC.md) (product behavior) and [architecture.md](architecture.md) (how it is built).

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

## Tests

```bash
cd backend && .venv/bin/pytest        # 34 tests, no network
cd web && npx tsc --noEmit
```

## Layout

- `backend/` — the pipeline and API. `review.py` is the pure core that decides flags;
  `adapters/` holds the vendor and storage implementations behind `ports.py`.
- `web/` — Next.js app: upload, live progress, and the review page.
- `firebase/` — deny-all security rules for the no-auth demo.

## Status

Working: upload → transcribe → segment → baseline → timing/delivery/content signals → fusion →
report, with CV consistency and reviewer feedback. Live interview room (Daily) with the canary
tooling — manifest load, preload, preview, gain, Send / Send+Ask into the outgoing audio mix,
question timestamps, and marker detection. Set `NEXT_PUBLIC_DAILY_ROOM_URL` to use the room.
Gaze/prosody signals, separate clean-mic recording, and the bias eval set are post-demo
(architecture.md §10–§11).

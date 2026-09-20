# CLAUDE.md

Read [context.md](context.md) first — what this project is, why, and the rules that must not be
broken. Then [SPEC.md](SPEC.md) (product behavior) and [architecture.md](architecture.md) (system
design). Keep those three in sync with any change; this file is a pointer and quick-reference, not
a fourth copy of the content.

## What this is

A post-interview review tool for recruiters: analyzes a recorded interview + CV, returns 0–5
timestamped moments worth a second look (possible real-time AI copilot use), plus a separate CV
consistency section. It never scores or recommends rejection — the reviewer decides.

## Non-negotiable product rules

Do not violate these even for "just the demo" (full list with reasons in context.md):

1. No overall score, verdict, or reject recommendation — anywhere.
2. No ranking/sorting candidates by flag count.
3. A single signal never creates a flag — requires anomalies in ≥2 distinct signal families.
4. Zero flags is a normal result; never pad to a minimum.
5. Signals are relative to the candidate's own baseline, never absolute thresholds.
6. Never label emotion or deception (no "nervous," "stressed," "lying") — mechanics only.
7. Skipped signals are reported, never silently dropped, never count as evidence.
8. The flag decision is deterministic rules (`review.py`), not an LLM. LLMs extract/explain only.
9. Every flag carries alternative benign explanations and a suggested verification question.
10. No processing without attested consent to recording + automated analysis.
11. No real candidate data in the demo environment (it has no auth).

## Repo layout

```
backend/src/interview_review/
  models.py     Pydantic shapes — single source of truth
  review.py     pure core: baseline, signals, fusion (no I/O, no LLM in the flag decision)
  pipeline.py   run_pipeline: step order, caching, progress, fatal-vs-skip handling
  api.py        FastAPI app factory
  narrative.py  template explanations + emotion-language guard
  ports.py      Store, Transcriber, Analyst, AiTextDetector, CvAnalyzer seams
  wiring.py     env -> adapters
  cli.py        run a review from the terminal
  adapters/     local_store, firebase_store, assemblyai, openai_analyst,
                openai_cv_analyzer, heuristic_analyst, gptzero, json_transcriber
backend/tests/  one file per agreed seam: review, pipeline, api, store contract, canary
web/            Next.js (App Router) app: /, /new, /i/[id], /live/[id]
firebase/       deny-all Firestore/Storage rules (no-auth demo)
```

Import rule: nothing under `review.py`/`pipeline.py` imports `api.py`. The CLI and API are two
callers of the same `run_pipeline`. The pipeline package never imports from the API.

Vendor adapters (`Store`, `Transcriber`, `Analyst`, `AiTextDetector`, `CvAnalyzer` in `ports.py`)
are thin and mockable; with no API keys set, the backend wires offline adapters
(`LocalStore`, `JsonTranscriber`, `HeuristicAnalyst`) and the whole product runs locally.

## Working conventions

- The browser never writes to Firestore; all mutations go through the backend API.
- Artifacts/reports are immutable once written; reviewer feedback lives on the interview record,
  keyed by stable flag ID.
- Adding a signal or changing a threshold: state its expected effect on false positives for
  non-native and neurodivergent candidates (see context.md's bias caveats).
- CV consistency is its own seam (`CvAnalyzer`), deliberately kept out of fusion even though it
  shares a vendor with `Analyst` — a CV finding must never create or strengthen a flag.

## Commands

```bash
# backend
cd backend && .venv/bin/pytest                                   # tests, no network
cd backend && .venv/bin/python -m interview_review.cli serve     # API on :8000

# web
cd web && npm run dev        # app on :3000
cd web && npx tsc --noEmit   # typecheck
```

See [README.md](README.md) for full clone/setup steps.

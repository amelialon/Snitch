# Project Context

Read this first. It is the short version of what this project is, what has been decided and why, and the rules that anyone (human or AI assistant) working in this repo must not break. Details live in [SPEC.md](SPEC.md) (product behavior) and [architecture.md](architecture.md) (system design).

_Last updated: 2026-09-19. Status: pre-code; spec and architecture written, nothing built yet._

## What this is

A review tool for recruiters and HR. A recruiter uploads a recorded interview plus the candidate's CV. The system analyzes it and returns **0–5 timestamped moments worth a second look**, where several independent signals suggest the candidate may have been using real-time AI assistance, plus a separate list of places where spoken claims contradict the CV.

It is a **second-look tool, not a lie detector.** It produces evidence and a suggested follow-up question. The recruiter makes every decision.

## Why it exists

Real-time interview copilots (tools that listen to the interviewer, generate an answer with an LLM, and show it to the candidate on an overlay or second screen) have made remote interviews unreliable. Recruiters suspect it but can't point to anything concrete. This tool gives them specific moments to review and a way to verify, instead of a gut feeling.

## Who uses it

- **Primary user:** recruiter or hiring manager reviewing an interview after it happened.
- **Affected non-user:** the candidate. They never see the tool, but every design choice affects them. Most constraints below exist to protect honest candidates from false accusations.

## Non-negotiable rules

These are product invariants. Do not add features, UI, fields, or prompts that violate them, even if asked for "just the demo."

1. **No overall cheating score, verdict, or reject recommendation.** Not in the UI, not in the data model, not in an LLM prompt's output.
2. **No ranking or sorting candidates by flag count.**
3. **A single signal never creates a flag.** Flags require anomalies in ≥2 distinct signal *families*.
4. **Zero flags is a normal result.** Never pad to a minimum.
5. **All behavioral signals are relative to the candidate's own baseline**, adjusted for question type and difficulty. No absolute thresholds.
6. **Never label emotion or deception** ("nervous," "stressed," "evasive," "lying"). Describe mechanics only: pause length, filler rate, pace, gaze direction. This is a legal line (EU AI Act prohibits emotion inference in hiring), not a style preference.
7. **Skipped signals are reported, never silently dropped**, and never count as evidence in either direction.
8. **The flag decision is deterministic rules, not an LLM.** LLMs extract, classify, and explain. They do not decide what gets flagged.
9. **Every flag carries alternative benign explanations and a suggested verification question.**
10. **No processing without attested consent** to both recording and automated analysis.
11. **No real candidate data in the demo environment** (it has no auth).

## Glossary

| Term | Meaning |
|---|---|
| **Unit / Q–A unit** | One interviewer question and the candidate's answer. Follow-up questions are child units of their parent. |
| **Baseline** | The candidate's own normal: speaking rate, filler rate, response latency, prosody, gaze. Built from small talk and easy questions. |
| **Signal** | One measurement on one unit, expressed as deviation from baseline (e.g. "pause 3.4σ longer than this candidate's norm for this question type"). |
| **Family** | A group of correlated signals that count as one for corroboration: **A** timing, **B** delivery, **C** content, **D** visual, **E** canary. |
| **Flag** | A unit where ≥2 families are anomalous. Has a confidence label (low / medium / high) set by rule. |
| **Fusion** | The deterministic step that turns signals into flags. |
| **Depth collapse** | A polished answer followed by a shallow, generic, or restated answer when probed with a follow-up. Strongest content signal; hardest for a copilot to fake. |
| **Pause-then-fluent** | Long silence followed by an immediately structured, filler-free answer. The core timing pattern. |
| **Raw vs. clean transcript** | Raw keeps fillers, false starts, repairs (used for signals). Clean is for display and content analysis. |
| **Artifact** | The versioned JSON output of one pipeline stage, stored in Firebase Storage. |
| **Canary** | Experimental Phase 3 idea: a low-level spoken instruction mixed into the interviewer's audio ("use the word lighthouse") that a copilot's speech recognition may pick up and obey. Not in the demo. |
| **CV consistency** | Comparison of spoken factual claims against the CV. Reported separately; never part of fusion. |
| **Copilot** | The cheating tool being detected: real-time ASR → LLM → answer shown to the candidate. |

## Decisions made

| Decision | Choice | Why |
|---|---|---|
| Output format | 0–5 flagged moments, no score | A score invites auto-rejection and hides the evidence. Minimum of zero avoids forced false positives. |
| Flag rule | ≥2 signal families | Signals within a family are correlated (latency and disfluency move together); agreement inside a family isn't corroboration. |
| Confidence | Ordinal label by rule | No calibration data exists yet; probabilities would be invented. |
| Fusion | Deterministic rules + versioned threshold config | Reproducible, auditable, tunable from feedback without prompt drift. |
| CV findings | Separate section, outside fusion | Résumé accuracy and live assistance are different questions. |
| Question typing | LLM classifies type + difficulty | Long pauses on hard design questions are normal; the baseline must be adjusted or the tool punishes thinking. |
| Frontend | Next.js + TypeScript + Tailwind + shadcn/ui | Standard, fast to build. |
| Backend | Python: FastAPI + a standalone pipeline package | All analysis libraries are Python; pipeline must be callable from both the API and the eval harness. |
| Database / storage | **Firebase** (Firestore + Storage) | Team preference. Resumable uploads and realtime progress come for free. Large artifacts go to Storage because of Firestore's 1 MiB doc limit. |
| Transcription | Hosted ASR with fillers enabled (AssemblyAI or Deepgram) | Default Whisper drops fillers, which destroys the disfluency signal. Vendor choice still open. |
| AI-text detection | **GPTZero API** | Team decision. Used as one Family C signal only; see caveats below. |
| Segmentation / depth / write-ups | **OpenAI API** (Responses API + structured outputs) | Typing, segmentation, depth-collapse judgment, flag explanations. Its own seam (`Analyst` → `OpenAIAnalyst`). Changed from Claude. |
| CV consistency | **OpenAI API** (Responses API + structured outputs) | A separate seam (`CvAnalyzer`), deliberately kept off the flag path even though it shares the vendor. One `OPENAI_API_KEY` powers both. Key is server-side only, never in the browser or an API response. |
| Auth | **None for the demo** | Demo scope. Mitigated by: web app never touches Firebase (all writes via backend), deny-all rules, mock data only, not publicly deployed. `owner_id`/`org_id` fields exist from day one. |
| Clips | Seek ranges on the original video | No clip files to cut or store. |
| Phasing | Audio-only MVP → video signals → live canary | Audio carries most of the signal; gaze needs a quality gate; the canary must sit in a live call. |
| Canary audio | Generated by a **separate part of the project**; this app only loads/schedules/mixes/logs/analyzes | Given `.wav` + `instruction` + `expectedMarker` + `durationMs`. This app never synthesises audio. |
| Canary use gate | Only in a live session with the SPEC §6 disclosure consent | It is a disclosed integrity measure, not a covert channel; one signal in the canary family, never proof alone. |

## Known caveats to keep in mind

- **GPTZero is trained on written text.** Spoken transcripts are out of distribution. Raw transcripts will nearly always read as human; clean transcripts lose the features that mark real speech. The normalization sent to GPTZero must be validated on honest vs. assisted recordings before any threshold is trusted. AI-text detectors also show elevated false positives on non-native English, so this signal gets no special weight.
- **Network lag inflates latency.** Measured response time includes conferencing delay. The baseline stage estimates it; high jitter makes timing signals unreliable.
- **Rehearsed answers resemble read answers.** Depth collapse on follow-ups is the discriminator: prepared candidates survive probing.
- **Timing signals are adversarially fragile.** Copilots will learn to fake pauses and fillers. Content and follow-up signals are the durable investment.
- **Bias risk is the central product risk.** Non-native speakers, neurodivergent candidates, and people with offset camera setups naturally show atypical latency, fluency, or gaze. Every signal must pass a per-group false-positive gate on the eval set before it counts in production.
- **Legal exposure is real.** EU AI Act (high-risk hiring AI; emotion inference banned), NYC Local Law 144, Illinois AIVIA and BIPA, GDPR biometrics, all-party recording consent. Counsel review is required before any pilot with real candidates.

## Demo scope

**In:** upload (recording + CV), consent attestation, transcription, segmentation, question typing, baseline, timing + delivery + content signals (incl. GPTZero), CV consistency (OpenAI), fusion, review page with synced player/transcript/flag cards, useful / not-useful feedback, skipped-signals reporting. Canary tooling: manifest load, preload/decode, Preview (local only), gain (dB→linear), whole-word marker detection, and question/canary event logging with timestamps.

**Out:** auth, multi-tenant orgs, gaze/video signals (reported as "not enabled"), the **live two-person call room and the outgoing-audio mix** (blocked on a video-SDK choice — see architecture.md §11), retention jobs, audit log, the bias eval set (structure only; no dataset), deployment beyond local or password-protected.

## Open questions

1. ASR vendor: AssemblyAI vs. Deepgram (compare filler fidelity and diarization on a sample interview).
2. Which transcript normalization goes to GPTZero (needs a small experiment; do this early).
3. Can we obtain interviewer-side local recordings, or only platform recordings? Sets the ceiling on timing reliability.
4. Show low-confidence flags in v1, or hold them until calibration data exists?
5. Canary delivery mechanism (meeting bot vs. desktop virtual audio device), if Phase 3 proceeds.
6. Product name. The working folder name "Interview_Cheater" reads as a tool *for* cheating.

## Working conventions

- `pipeline/schemas/` (Pydantic) is the source of truth for all data shapes; TypeScript types are generated from it.
- The browser never writes to Firestore; all mutations go through the API.
- The pipeline package never imports from the API and runs from a CLI against local disk for tests and eval.
- Artifacts are versioned and never overwritten; every flag records the pipeline version and threshold config hash that produced it.
- Vendor clients (`asr`, `claude`, `gptzero`) are thin and mockable; tests never hit real vendors.
- When a change touches signals or thresholds, state its expected effect on false positives for non-native and neurodivergent candidates.
- Keep the three docs in sync: product behavior → SPEC.md, system design → architecture.md, decisions and their reasons → this file.

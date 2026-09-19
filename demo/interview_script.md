# Test interview script — Karthikraj (candidate) × Interviewer

Purpose: record a short, **consented** mock interview to test the review tool. Some answers are
delivered naturally (should NOT be flagged); some are delivered like a real-time AI copilot is
feeding them (should be flagged). You know the ground truth, so you can check the tool got it right.

## Roles
- **INTERVIEWER** — asks the questions, reacts naturally.
- **CANDIDATE (Karthikraj)** — answers. This is his CV, so answers draw on it.

## Say this on camera first (consent — the tool requires it)
> INTERVIEWER: "Just to confirm on the record — you're okay with this interview being recorded and
> analyzed by automated tools?"  CANDIDATE: "Yes, that's fine."

## How to deliver each answer (this is the whole trick)
- 🟢 **NATURAL** — you're given *bullet points*, not a script. Improvise in your own words, be
  yourself, use "um/uh", pause and think out loud. Look at the camera/person.
- 🔴 **AI-STYLE** — read the **verbatim** text off a second screen. **Before you start, sit silent
  for ~5–7 seconds** (as if waiting for a copilot to generate), then read it **evenly and flat,
  with no fillers**, at a steady pace. This is what a read-off-a-screen answer sounds like.
- 🟡 **DEPTH-COLLAPSE** — you nailed the polished answer, but when probed you can't go deeper. Give
  a short, vague, restated answer. Improvise the weakness.

Keep it conversational — **don't talk over each other** (the tool separates speakers by voice).
Aim for 6–10 minutes. Start with the small talk; that's what teaches the tool your normal voice.

---

## 1. 🟢 NATURAL — rapport (baseline)
**INTERVIEWER:** Hey, thanks for hopping on. Did the link work okay?
**CANDIDATE (improvise from):** yeah it worked fine / bit of a rush before this / good to be here.

## 2. 🟢 NATURAL — rapport (baseline)
**INTERVIEWER:** How's your week going over in Toronto?
**CANDIDATE (improvise from):** busy, mid-sprint at Trax / weather / settling into NOC / whatever's true.

## 3. 🟢 NATURAL — autobiographical (baseline)
**INTERVIEWER:** Give me the quick version of what you're building at Trax right now.
**CANDIDATE (improvise from):** AI pipeline that audits building-permit submissions against the
municipality's requirement checklists → retrieval + LLM verdicts with page-level citations → in
pilot with the City of Kitchener → started Jan 2026. Ramble a bit, it's fine.

## 4. 🔴 AI-STYLE — knowledge (pause 5–7s, then read flat)
**INTERVIEWER:** Your CV mentions RRF-fused retrieval. What exactly is Reciprocal Rank Fusion?
**CANDIDATE (read verbatim):**
> Reciprocal Rank Fusion is a rank aggregation method that combines multiple ranked result lists
> into a single ranking. For each document it computes a score equal to the sum, over all result
> lists, of one divided by a constant k plus the rank of that document in that list, where k is
> typically set to sixty. Because it depends only on rank position and not on the underlying
> scores, it is robust to differences in scale between systems such as dense vector similarity and
> sparse lexical matching, which makes it particularly effective for hybrid retrieval.

## 5. 🟡 DEPTH-COLLAPSE — follow-up (improvise the weak answer)
**INTERVIEWER:** Why RRF specifically, instead of just normalizing both scores and adding them?
**CANDIDATE (improvise, vague & restated):** um... yeah, basically it just worked better for us...
the scores from the two systems aren't really comparable so RRF kind of handles that... I'd have
to look at the exact reason again but that was the main thing.

## 6. 🟢 NATURAL — behavioral (real experience)
**INTERVIEWER:** Tell me about that validator you built for the requirements database.
**CANDIDATE (improvise from):** 14 assertions over the requirements DB / it caught a silent
regression that had switched off retrieval filtering and seal checks on 248 of 355 live
requirements / that's basically why you built it — nothing was catching it before.

## 7. 🔴 AI-STYLE — knowledge (pause 5–7s, then read flat)
**INTERVIEWER:** In plain terms, what's the difference between dense and sparse retrieval?
**CANDIDATE (read verbatim):**
> Sparse retrieval represents text as high-dimensional, mostly-zero vectors based on term
> frequency, as in BM25, and matches documents on exact lexical overlap. Dense retrieval encodes
> text into low-dimensional continuous embeddings with a neural model, capturing semantic
> similarity even when the wording differs. Sparse methods excel at exact keyword and rare-term
> matching, while dense methods excel at synonyms and paraphrase, so hybrid retrieval combines both
> to get the precision of lexical matching and the recall of semantic matching.

## 8. 🟢 NATURAL — problem-solving (think out loud; long pause is FINE here)
**INTERVIEWER:** Say retrieval quality drops in prod tomorrow. How do you start debugging it?
**CANDIDATE (improvise, genuinely think aloud):** "hmm, let me think"... check the eval harness
first / did something change recently / look at which queries fail / is it the dense side or the
sparse side / check the fusion step / etc. It's fine to pause — just narrate your thinking.

## 9. 🔴 AI-STYLE — knowledge (pause 5–7s, then read flat)
**INTERVIEWER:** On Perfingo you went single-table DynamoDB with no GSIs or scans. Why?
**CANDIDATE (read verbatim):**
> In DynamoDB, a single-table design stores multiple entity types in one table and models access
> patterns through carefully chosen partition and sort keys. Global secondary indexes and scans are
> avoided because a scan reads the entire table and does not scale with data size, while every
> additional index increases write cost and storage. By materialising the net balance directly
> under a partition and sort key, group settlement lookups become a single constant-time read
> against the primary key rather than an aggregation across many items.

## 10. 🟢 NATURAL — co-curricular (real experience)
**INTERVIEWER:** You co-founded the AI Society at NUS — what was that like?
**CANDIDATE (improvise from):** first AI-focused CCA in NUS Computing / grew to 150+ members / ran
workshops, hackathons, industry partnerships / managed a 10-person committee. Be yourself.

## 11. 🔴 AI-STYLE — optional, if you want one more (pause 5–7s, read flat)
**INTERVIEWER:** Your CAPTCHA project used CTC loss. What is CTC, briefly?
**CANDIDATE (read verbatim):**
> Connectionist Temporal Classification is a loss function for sequence prediction when the
> alignment between input and output is unknown. It introduces a blank token and sums the
> probabilities of all alignments that collapse to the target sequence after removing blanks and
> merging repeated characters, which lets the model train on variable-length sequences, such as the
> characters in a CAPTCHA image, without needing per-character segmentation of the input.

## 12. 🟢 NATURAL — closing
**INTERVIEWER:** Anything you want to ask me?
**CANDIDATE (improvise):** a couple of normal questions — team, what you're working on, etc.

---

## What the tool should do with this (your answer key)
- **Baseline** comes from #1–#3 (natural small talk). Enough easy talk here for the tool to learn
  Karthikraj's normal pace and filler rate.
- **Should get flagged** (≥2 signal families line up): the 🔴 answers **#4, #7, #9, #11**, because
  each has a long pre-answer pause, then filler-free even delivery (read-aloud), and textbook
  wording. **#4 + #5** together should be the strongest — polished answer *and* a depth collapse
  on the follow-up.
- **Should NOT get flagged:** every 🟢 answer, including **#8** — that one has a long pause too, but
  because you think out loud ("hmm, let me think") it's not the pause-then-fluent pattern. If the
  tool flags #8, that's a false positive worth noting.
- **CV / consistency section:** should be basically empty — your answers match the CV. (If you want
  to test that section, deliberately misstate one fact, e.g. say "team of 20" or a wrong date.)

## Tips for a clean recording
- Two people, clearly taking turns, minimal crosstalk (helps speaker separation).
- Decent mic; quiet room.
- Export as `.mp4` / `.m4a` / `.wav` and upload it on the **New review** page with Karthikraj's CV.
- Real transcription (AssemblyAI) + OpenAI + GPTZero run on upload — a few cents, a few minutes.

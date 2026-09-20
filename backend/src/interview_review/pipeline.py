"""run_pipeline: one interview in, one report out. Callers: the API's background task and the CLI.

Never raises. The outcome lands on the interview record: `ready` with a report, or `failed`
with a readable error. Only transcription and segmentation failures are fatal; every other
problem is reported in the report's skipped list.
"""

from __future__ import annotations

import logging
from pathlib import Path

from . import align
from .models import (
    FILLERS,
    ContentEvidence,
    CvFinding,
    Flag,
    HiddenPromptResult,
    Report,
    Segmentation,
    SentenceAiScore,
    Skipped,
    Transcript,
    UnitAiText,
    UnitHiddenPrompt,
    UnitView,
    normalize_word,
    to_turns,
)
from .narrative import build_ai_text_summary, build_cv_alignment, build_delivery_pattern, guarded, guarded_summary, template_narrative, template_summary
from .canary import HIDDEN_PROMPT
from .models import HiddenPromptAnswer
from .ports import Deps, FlagContext, ReportDigest, load_model, save_model
from .review import resolve_units, review, strip_fillers

PIPELINE_VERSION = "0.2.0"
_MAX_CV_CHARS = 60_000
_MIN_HIDDEN_PROMPT_WORDS = 8  # a shorter answer has no room for an analogy

log = logging.getLogger(__name__)


def run_pipeline(interview_id: str, deps: Deps, *, force: bool = False) -> None:
    store = deps.store
    try:
        interview = store.get_interview(interview_id)
        if interview is None:
            raise KeyError(f"interview {interview_id} does not exist")
        store.update_interview(interview_id, {"status": "processing", "error": None, "progress": 0.0})
        skipped: list[Skipped] = [Skipped(signal="visual", reason="gaze analysis is not enabled in this version")]

        def stage(name: str, progress: float) -> None:
            store.update_interview(interview_id, {"stage": name, "progress": progress})

        stage("transcribing", 0.05)
        transcript = None if force else load_model(store, interview_id, "transcript.json", Transcript)
        if transcript is None:
            if not store.has_file(interview_id, interview.files["recording"]):
                raise FileNotFoundError(
                    "the recording never reached storage (the upload was interrupted). Delete this review and upload again."
                )
            with store.local_path(interview_id, interview.files["recording"]) as path:
                transcript = deps.transcriber.transcribe(path)
            save_model(store, interview_id, "transcript.json", transcript)

        stage("segmenting", 0.4)
        segmentation = None if force else load_model(store, interview_id, "segmentation.json", Segmentation)
        if segmentation is None:
            segmentation = deps.analyst.segment(to_turns(transcript))
            save_model(store, interview_id, "segmentation.json", segmentation)

        stage("analyzing", 0.6)
        units = resolve_units(transcript, segmentation)
        evidence = _gather_content_evidence(units, deps, skipped, transcript, segmentation.candidate_speaker)
        result = review(
            transcript, segmentation, evidence, config=deps.config, context_flags=interview.context_flags
        )

        stage("checking CV", 0.8)
        cv_findings, cv_checked = _cv_findings(
            interview.files, interview_id, units, deps, skipped, transcript, segmentation.candidate_speaker
        )

        stage("checking hidden prompt", 0.85)
        hidden_prompt = _hidden_prompt_check(interview, units, deps, skipped, transcript, segmentation.candidate_speaker)

        stage("writing up", 0.9)
        flags = _narrate(result.flags, units, deps)

        ai_text_summary = build_ai_text_summary(evidence.ai_text)
        cv_alignment = build_cv_alignment(cv_findings, cv_checked)
        delivery_pattern = build_delivery_pattern(result.signals)
        summary_note = _summarize(deps, flags, ai_text_summary, cv_alignment, cv_checked, delivery_pattern)

        report = Report(
            units=units,
            candidate_speaker=segmentation.candidate_speaker,
            baseline=result.baseline,
            signals=result.signals,
            flags=flags,
            cv_findings=cv_findings,
            skipped=skipped + result.skipped,
            adapters={
                "store": store.name,
                "transcriber": deps.transcriber.name,
                "analyst": deps.analyst.name,
                "detector": deps.detector.name if deps.detector else "none",
                "cv_analyzer": deps.cv_analyzer.name if deps.cv_analyzer else "none",
                "hidden_prompt_judge": deps.hidden_prompt_judge.name if deps.hidden_prompt_judge else "none",
            },
            pipeline_version=PIPELINE_VERSION,
            ai_text_summary=ai_text_summary,
            ai_text=list(evidence.ai_text.values()),
            cv_alignment=cv_alignment,
            delivery_pattern=delivery_pattern,
            hidden_prompt=hidden_prompt,
            summary_note=summary_note,
        )
        save_model(store, interview_id, "report.json", report)
        store.update_interview(
            interview_id,
            {
                "status": "ready",
                "stage": "done",
                "progress": 1.0,
                "summary": {
                    "flag_count": len(flags),
                    "cv_finding_count": len(cv_findings),
                    "skipped_count": len(report.skipped),
                    "duration_sec": round(transcript.duration or (transcript.words[-1].end if transcript.words else 0)),
                },
            },
        )
    except Exception as exc:  # the caller is a background task: the record is the only place to report
        log.exception("review of %s failed", interview_id)
        try:
            store.update_interview(interview_id, {"status": "failed", "error": str(exc) or type(exc).__name__})
        except Exception:
            log.exception("could not record failure for %s", interview_id)


def _gather_content_evidence(
    units: list[UnitView], deps: Deps, skipped: list[Skipped], transcript: Transcript, candidate_speaker: str
) -> ContentEvidence:
    evidence = ContentEvidence()

    if deps.detector is None:
        skipped.append(Skipped(signal="ai_text", reason="no AI-text detector is configured (set GPTZERO_API_KEY)"))
    else:
        try:
            for unit in units:
                if len(unit.answer.split()) >= deps.config.min_answer_words:
                    # Fillers stripped: detectors are trained on written text. See SPEC §9.
                    raw = deps.detector.analyze(strip_fillers(unit.answer))
                    evidence.ai_scores[unit.id] = raw.overall_score
                    evidence.ai_text[unit.id] = _locate_ai_sentences(
                        unit, raw, transcript, candidate_speaker, deps.config
                    )
        except Exception as exc:
            evidence.ai_scores.clear()  # partial coverage would bias which answers can be flagged
            evidence.ai_text.clear()
            skipped.append(Skipped(signal="ai_text", reason=f"the AI-text detector failed: {exc}"))

    by_parent: dict[str, list[UnitView]] = {}
    for unit in units:
        if unit.parent_id:
            by_parent.setdefault(unit.parent_id, []).append(unit)
    views = {u.id: u for u in units}
    for parent_id, follow_ups in by_parent.items():
        if parent_id not in views:
            continue
        try:
            evidence.depth[parent_id] = deps.analyst.judge_depth(views[parent_id], follow_ups)
        except Exception as exc:
            skipped.append(Skipped(signal="depth_collapse", unit_id=parent_id, reason=f"could not be judged: {exc}"))
    return evidence


def _locate_ai_sentences(unit: UnitView, raw, transcript: Transcript, candidate_speaker: str, config) -> UnitAiText:
    """Best-effort: walk the vendor's sentences in order against the filler-stripped word list
    (what was actually sent to the detector) so each one can be located and colored."""
    words = align.words_in_span(transcript.words, unit.answer_start, unit.answer_end, candidate_speaker)
    filtered = [w for w in words if normalize_word(w.text) not in FILLERS]
    sentences: list[SentenceAiScore] = []
    pointer = 0
    for s in raw.sentences:
        span = align.locate_phrase(filtered[pointer:], s.text)
        if span is not None:
            start, end = span
            sentences.append(SentenceAiScore(text=s.text, start=start, end=end, score=s.score, cls=_bucket(s.score, config)))
        pointer = min(pointer + max(1, len(s.text.split())), len(filtered))
    return UnitAiText(unit_id=unit.id, overall_class=raw.overall_class, overall_score=raw.overall_score, sentences=sentences)


def _bucket(score: float, config) -> str:
    if score >= config.ai_score_min:
        return "ai"
    if score >= config.ai_score_mixed:
        return "mixed"
    return "human"


def _cv_findings(
    files: dict[str, str],
    interview_id: str,
    units: list[UnitView],
    deps: Deps,
    skipped: list[Skipped],
    transcript: Transcript,
    candidate_speaker: str,
) -> tuple[list[CvFinding], int]:
    checkable = [u for u in units if not u.is_baseline]
    names = [files[role] for role in ("cv", "cover_letter") if role in files]
    if not names:
        skipped.append(Skipped(signal="cv_consistency", reason="no CV or cover letter was provided"))
        return [], 0
    if deps.cv_analyzer is None:
        skipped.append(Skipped(signal="cv_consistency", reason="no CV analyzer is configured (set OPENAI_API_KEY)"))
        return [], 0
    try:
        texts = []
        for name in names:
            with deps.store.local_path(interview_id, name) as path:
                texts.append(_document_text(path))
        cv_text = "\n\n".join(texts)
        if len(cv_text) > _MAX_CV_CHARS:
            raise ValueError(f"the CV is unusually long ({len(cv_text)} characters); not analyzed rather than truncated")
        findings = deps.cv_analyzer.find_inconsistencies(cv_text, checkable)
        views = {u.id: u for u in units}
        located = [_locate_cv_quote(f, views, transcript, candidate_speaker) for f in findings]
        return located, len(checkable)
    except Exception as exc:
        skipped.append(Skipped(signal="cv_consistency", reason=str(exc)))
        return [], 0


def _locate_cv_quote(finding: CvFinding, views: dict[str, UnitView], transcript: Transcript, candidate_speaker: str) -> CvFinding:
    unit = views.get(finding.unit_id) if finding.unit_id else None
    if unit is None or not finding.transcript_quote:
        return finding
    words = align.words_in_span(transcript.words, unit.answer_start, unit.answer_end, candidate_speaker)
    span = align.locate_phrase(words, finding.transcript_quote)
    if span is None:
        return finding
    start, end = span
    return finding.model_copy(update={"start": start, "end": end})


def _hidden_prompt_check(
    interview, units: list[UnitView], deps: Deps, skipped: list[Skipped], transcript: Transcript, candidate_speaker: str
) -> HiddenPromptResult | None:
    """Which of the candidate's answers carried out the instruction hidden on their screen. Separate from
    fusion on purpose, like CV consistency: it is shown to the reviewer, and never creates a flag."""
    # Every review is checked. A recording that did not come from the live room never showed the
    # instruction, so it is checked against the standard one and the report says it was not shown.
    instruction = interview.hidden_prompt or HIDDEN_PROMPT
    if deps.hidden_prompt_judge is None:
        skipped.append(Skipped(signal="hidden_prompt", reason="no hidden-prompt judge is configured (set OPENAI_API_KEY)"))
        return None

    # The count is out of every question. An answer too short to carry out the instruction is not sent to
    # the judge; it counts as a question that did not match.
    eligible = [u for u in units if len(strip_fillers(u.answer).split()) >= _MIN_HIDDEN_PROMPT_WORDS]
    try:
        judgments = deps.hidden_prompt_judge.judge(
            instruction,
            [HiddenPromptAnswer(unit_id=u.id, question=u.question, answer=strip_fillers(u.answer)) for u in eligible],
        ) if eligible else []
    except Exception as exc:
        skipped.append(Skipped(signal="hidden_prompt", reason=f"the judge failed: {exc}"))
        return None

    verdicts = {j.unit_id: j for j in judgments}
    results: list[UnitHiddenPrompt] = []
    for unit in units:
        verdict = verdicts.get(unit.id)
        if verdict is None:
            results.append(UnitHiddenPrompt(unit_id=unit.id, followed=False, rationale="Answer too short to carry out the instruction."))
            continue
        start = end = None
        if verdict.followed:
            words = align.words_in_span(transcript.words, unit.answer_start, unit.answer_end, candidate_speaker)
            spoken = [w for w in words if normalize_word(w.text) not in FILLERS]
            span = align.locate_phrase(spoken, verdict.quote) if verdict.quote else None
            # A quote that cannot be located still marks the answer, just as a whole.
            start, end = span if span else (unit.answer_start, unit.answer_end)
        results.append(UnitHiddenPrompt(unit_id=unit.id, followed=verdict.followed, rationale=verdict.rationale, start=start, end=end))
    return HiddenPromptResult(
        instruction=instruction,
        shown_to_candidate=bool(interview.hidden_prompt),
        checked_count=len(results),
        matched_count=sum(1 for r in results if r.followed),
        units=results,
    )


def _summarize(deps: Deps, flags, ai_text_summary, cv_alignment, cv_checked: int, delivery_pattern) -> str:
    digest = ReportDigest(
        flag_count=len(flags),
        families=sorted({f for flag in flags for f in flag.families}),
        ai_class=ai_text_summary.dominant_class if ai_text_summary else None,
        ai_counts=ai_text_summary.counts if ai_text_summary else {},
        cv_level=cv_alignment.level if cv_checked else None,
        cv_contradictions=cv_alignment.contradiction_count,
        delivery_class=delivery_pattern.overall_class,
        delivery_note=delivery_pattern.description,
    )
    try:
        text = deps.analyst.summarize(digest)
    except Exception:
        log.exception("summary failed; using the template")
        text = template_summary(digest)
    return guarded_summary(text, digest)


def _document_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        text = "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
        if not text.strip():
            raise ValueError("the PDF has no extractable text (it may be a scan)")
        return text
    if suffix in {".txt", ".md"}:
        return path.read_text(errors="replace")
    raise ValueError(f"unsupported document type {suffix or '(none)'}; use PDF or plain text")


def _narrate(flags: list[Flag], units: list[UnitView], deps: Deps) -> list[Flag]:
    if not flags:
        return []
    views = {u.id: u for u in units}
    contexts = [
        FlagContext(flag=f, question=views[f.unit_id].question, answer=views[f.unit_id].answer)
        for f in flags
        if f.unit_id in views
    ]
    try:
        written = {n.flag_id: n for n in deps.analyst.explain_flags(contexts)}
    except Exception:
        log.exception("narratives failed; using the template")
        written = {}

    out = []
    for context in contexts:
        narrative = written.get(context.flag.id)
        narrative = guarded(narrative, context) if narrative else template_narrative(context)
        out.append(
            context.flag.model_copy(
                update={
                    "explanation": narrative.explanation,
                    "alternative_explanations": narrative.alternative_explanations or template_narrative(context).alternative_explanations,
                    "verification_prompt": narrative.verification_prompt,
                }
            )
        )
    return out

"""run_pipeline: one interview in, one report out. Callers: the API's background task and the CLI.

Never raises. The outcome lands on the interview record: `ready` with a report, or `failed`
with a readable error. Only transcription and segmentation failures are fatal; every other
problem is reported in the report's skipped list.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .models import ContentEvidence, CvFinding, Flag, Report, Segmentation, Skipped, Transcript, UnitView, to_turns
from .narrative import guarded, template_narrative
from .ports import Deps, FlagContext, load_model, save_model
from .review import resolve_units, review, strip_fillers

PIPELINE_VERSION = "0.1.0"
_MAX_CV_CHARS = 60_000

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
        evidence = _gather_content_evidence(units, deps, skipped)
        result = review(
            transcript, segmentation, evidence, config=deps.config, context_flags=interview.context_flags
        )

        stage("checking CV", 0.8)
        cv_findings = _cv_findings(interview.files, interview_id, units, deps, skipped)

        stage("writing up", 0.9)
        flags = _narrate(result.flags, units, deps)

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
            },
            pipeline_version=PIPELINE_VERSION,
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


def _gather_content_evidence(units: list[UnitView], deps: Deps, skipped: list[Skipped]) -> ContentEvidence:
    evidence = ContentEvidence()

    if deps.detector is None:
        skipped.append(Skipped(signal="ai_text", reason="no AI-text detector is configured (set GPTZERO_API_KEY)"))
    else:
        try:
            for unit in units:
                if len(unit.answer.split()) >= deps.config.min_answer_words:
                    # Fillers stripped: detectors are trained on written text. See SPEC §9.
                    evidence.ai_scores[unit.id] = deps.detector.score(strip_fillers(unit.answer))
        except Exception as exc:
            evidence.ai_scores.clear()  # partial coverage would bias which answers can be flagged
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


def _cv_findings(
    files: dict[str, str], interview_id: str, units: list[UnitView], deps: Deps, skipped: list[Skipped]
) -> list[CvFinding]:
    names = [files[role] for role in ("cv", "cover_letter") if role in files]
    if not names:
        skipped.append(Skipped(signal="cv_consistency", reason="no CV or cover letter was provided"))
        return []
    if deps.cv_analyzer is None:
        skipped.append(Skipped(signal="cv_consistency", reason="no CV analyzer is configured (set OPENAI_API_KEY)"))
        return []
    try:
        texts = []
        for name in names:
            with deps.store.local_path(interview_id, name) as path:
                texts.append(_document_text(path))
        cv_text = "\n\n".join(texts)
        if len(cv_text) > _MAX_CV_CHARS:
            raise ValueError(f"the CV is unusually long ({len(cv_text)} characters); not analyzed rather than truncated")
        return deps.cv_analyzer.find_inconsistencies(cv_text, [u for u in units if not u.is_baseline])
    except Exception as exc:
        skipped.append(Skipped(signal="cv_consistency", reason=str(exc)))
        return []


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

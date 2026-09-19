"""Behaviour of run_pipeline, observed through the Store, with fakes only at vendor boundaries."""

import io
from datetime import datetime, timezone

import pytest
from builders import InterviewBuilder, natural, polished

from interview_review.adapters.heuristic_analyst import HeuristicAnalyst
from interview_review.adapters.json_transcriber import JsonTranscriber
from interview_review.adapters.local_store import LocalStore
from interview_review.models import AiTextRaw, Consent, Interview, Report, Segmentation
from interview_review.pipeline import run_pipeline
from interview_review.ports import Deps, FlagNarrative, load_model


class ScriptedAnalyst(HeuristicAnalyst):
    """Stands in for the LLM: returns the segmentation the test scripted."""

    name = "scripted"

    def __init__(self, segmentation: Segmentation) -> None:
        self.segmentation = segmentation

    def segment(self, turns):
        return self.segmentation


class MarkerDetector:
    """Scores text as AI-written when it contains no fillers at all in its first 25 words."""

    name = "marker"

    def analyze(self, text: str) -> AiTextRaw:
        score = 0.97 if text.startswith(polished(25)) else 0.05
        return AiTextRaw(overall_class="ai" if score >= 0.8 else "human", overall_score=score, sentences=[])


class CountingTranscriber(JsonTranscriber):
    def __init__(self) -> None:
        self.calls = 0

    def transcribe(self, path):
        self.calls += 1
        return super().transcribe(path)


def suspicious_interview() -> InterviewBuilder:
    b = InterviewBuilder()
    b.small_talk()
    b.ask(natural(80), latency=1.0)
    b.ask(polished(30) + " " + natural(60), latency=7.0)
    b.ask(natural(80), latency=0.9)
    return b


@pytest.fixture
def store(tmp_path):
    return LocalStore(tmp_path)


def start(store, builder: InterviewBuilder, *, cv: bytes | None = None, **deps_overrides) -> Deps:
    transcript, segmentation = builder.build()
    interview = Interview(
        id="i1",
        candidate_label="Candidate A",
        consent=Consent(attested_by="recruiter", attested_at=datetime.now(timezone.utc)),
        files={"recording": "recording.json"} | ({"cv": "cv.txt"} if cv else {}),
    )
    store.create_interview(interview)
    store.put_file("i1", "recording.json", io.BytesIO(transcript.model_dump_json().encode()))
    if cv:
        store.put_file("i1", "cv.txt", io.BytesIO(cv))
    defaults = dict(
        store=store,
        transcriber=JsonTranscriber(),
        analyst=ScriptedAnalyst(segmentation),
        detector=MarkerDetector(),
    )
    return Deps(**(defaults | deps_overrides))


def report_of(store) -> Report:
    return load_model(store, "i1", "report.json", Report)


def test_a_completed_run_publishes_a_report_with_flags_and_names_its_adapters(store):
    deps = start(store, suspicious_interview())

    run_pipeline("i1", deps)

    interview = store.get_interview("i1")
    assert (interview.status, interview.progress) == ("ready", 1.0)
    assert interview.summary["flag_count"] == 1
    report = report_of(store)
    assert [f.unit_id for f in report.flags] == ["u6"]
    assert report.flags[0].explanation and report.flags[0].verification_prompt
    assert report.adapters == {
        "store": "local", "transcriber": "json-transcript", "analyst": "scripted",
        "detector": "marker", "cv_analyzer": "none",
    }


def test_every_report_says_which_signals_did_not_run(store):
    deps = start(store, suspicious_interview(), detector=None)

    run_pipeline("i1", deps)

    skipped = {s.signal for s in report_of(store).skipped}
    assert {"visual", "ai_text", "cv_consistency"} <= skipped
    assert store.get_interview("i1").status == "ready"


def test_a_failing_detector_is_reported_as_skipped_not_as_a_failed_review(store):
    class BrokenDetector:
        name = "broken"

        def analyze(self, text):
            raise RuntimeError("503 from vendor")

    deps = start(store, suspicious_interview(), detector=BrokenDetector())

    run_pipeline("i1", deps)

    assert store.get_interview("i1").status == "ready"
    reasons = [s.reason for s in report_of(store).skipped if s.signal == "ai_text"]
    assert reasons and "503" in reasons[0]


def test_a_transcription_failure_fails_the_review_with_a_readable_error(store):
    class BrokenTranscriber:
        name = "broken"

        def transcribe(self, path):
            raise RuntimeError("audio could not be decoded")

    deps = start(store, suspicious_interview(), transcriber=BrokenTranscriber())

    run_pipeline("i1", deps)

    interview = store.get_interview("i1")
    assert interview.status == "failed"
    assert "audio could not be decoded" in interview.error


def test_rerunning_does_not_pay_for_transcription_again_unless_forced(store):
    transcriber = CountingTranscriber()
    deps = start(store, suspicious_interview(), transcriber=transcriber)

    run_pipeline("i1", deps)
    run_pipeline("i1", deps)
    assert transcriber.calls == 1

    run_pipeline("i1", deps, force=True)
    assert transcriber.calls == 2


def test_narratives_that_label_emotion_or_deception_are_replaced(store):
    builder = suspicious_interview()
    _, segmentation = builder.build()

    class JudgmentalAnalyst(ScriptedAnalyst):
        def explain_flags(self, contexts):
            return [
                FlagNarrative(
                    flag_id=c.flag.id,
                    explanation="The candidate seemed nervous and was probably lying.",
                    alternative_explanations=[],
                    verification_prompt="Ask again.",
                )
                for c in contexts
            ]

    deps = start(store, builder, analyst=JudgmentalAnalyst(segmentation))

    run_pipeline("i1", deps)

    explanation = report_of(store).flags[0].explanation
    assert "nervous" not in explanation and "lying" not in explanation
    assert "second look" in explanation


def test_cv_findings_come_from_the_cv_analyzer_and_are_kept_apart_from_flags(store):
    from interview_review.models import CvFinding

    class ScriptedCvAnalyzer:
        name = "scripted-cv"

        def find_inconsistencies(self, cv_text, units):
            assert "ten years of Go" in cv_text
            return [CvFinding(claim="Led a team of 12", unit_id="u5", cv_evidence="CV says team of 4", classification="contradiction")]

    deps = start(store, suspicious_interview(), cv=b"ten years of Go", cv_analyzer=ScriptedCvAnalyzer())

    run_pipeline("i1", deps)

    report = report_of(store)
    assert [f.claim for f in report.cv_findings] == ["Led a team of 12"]
    assert [f.unit_id for f in report.flags] == ["u6"]  # a CV finding never creates or strengthens a flag


def test_a_cv_without_an_analyzer_is_reported_as_skipped(store):
    deps = start(store, suspicious_interview(), cv=b"ten years of Go")

    run_pipeline("i1", deps)

    reasons = [s.reason for s in report_of(store).skipped if s.signal == "cv_consistency"]
    assert reasons and "OPENAI_API_KEY" in reasons[0]


def test_the_report_carries_the_boxed_summaries_for_the_review_page(store):
    deps = start(store, suspicious_interview())

    run_pipeline("i1", deps)

    report = report_of(store)
    assert report.ai_text_summary is not None and report.ai_text_summary.analyzed_count > 0
    assert report.delivery_pattern.overall_class in ("normal", "medium", "abnormal")
    assert report.cv_alignment.checked_count == 0  # no CV was provided, so nothing was checked
    assert report.summary_note

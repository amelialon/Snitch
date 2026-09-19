"""Behaviour of the pure review core, through its one public function."""

from builders import InterviewBuilder, natural, polished

from interview_review.models import ContentEvidence, DepthJudgment
from interview_review.review import ReviewConfig, review


def run(builder: InterviewBuilder, evidence: ContentEvidence | None = None, **kwargs):
    transcript, segmentation = builder.build()
    return review(transcript, segmentation, evidence or ContentEvidence(), **kwargs)


def test_an_ordinary_interview_produces_no_flags():
    b = InterviewBuilder()
    b.small_talk()
    for _ in range(5):
        b.ask(natural(80), latency=1.0)

    result = run(b)

    assert result.flags == []


def test_long_pause_then_fluent_answer_with_ai_like_text_is_flagged():
    b = InterviewBuilder()
    b.small_talk()
    b.ask(natural(80), latency=1.0)
    # Fluent opening after the pause; delivery afterwards is this candidate's normal.
    suspect = b.ask(polished(30) + " " + natural(60), latency=7.0)
    b.ask(natural(80), latency=0.9)

    result = run(b, ContentEvidence(ai_scores={suspect: 0.97}))

    assert [f.unit_id for f in result.flags] == [suspect]
    assert result.flags[0].families == ["content", "timing"]


def test_a_single_signal_family_never_creates_a_flag():
    b = InterviewBuilder()
    b.small_talk()
    # Long pause then a fluent opening, but natural delivery afterwards and no content evidence.
    b.ask(polished(30) + " " + natural(60), latency=7.0)
    b.ask(natural(80), latency=1.0)

    result = run(b)

    assert any(s.anomalous and s.family == "timing" for s in result.signals)
    assert result.flags == []


def test_thinking_time_on_a_hard_design_question_is_not_anomalous():
    b = InterviewBuilder()
    b.small_talk()
    hard = b.ask(natural(90), latency=6.0, type="problem_solving", difficulty="hard")

    result = run(b, ContentEvidence(ai_scores={hard: 0.97}))

    timing = [s for s in result.signals if s.unit_id == hard and s.family == "timing"]
    assert [s.anomalous for s in timing] == [False]
    assert result.flags == []


def test_without_enough_small_talk_behavioural_signals_are_skipped_and_reported():
    b = InterviewBuilder()
    b.small_talk(exchanges=1, words_each=20)
    suspect = b.ask(polished(80), latency=7.0, even=True)

    result = run(b, ContentEvidence(ai_scores={suspect: 0.99}))

    assert {s.signal for s in result.skipped} == {"timing", "delivery"}
    assert not any(s.family in ("timing", "delivery") for s in result.signals)
    assert result.flags == []  # content alone is one family


def test_a_candidate_who_is_always_polished_is_not_flagged_for_their_style():
    b = InterviewBuilder()
    b.small_talk()
    ids = [b.ask(polished(80), latency=1.0, even=True) for _ in range(5)]

    result = run(b, ContentEvidence(ai_scores={ids[0]: 0.97}))

    assert result.flags == []
    assert {"disfluency_drop", "even_pace"} <= {s.signal for s in result.skipped}


def test_read_aloud_delivery_is_ignored_when_notes_were_permitted():
    b = InterviewBuilder()
    b.small_talk()
    b.ask(natural(80), latency=1.0)
    suspect = b.ask(polished(80), latency=1.0, even=True)
    b.ask(natural(80), latency=1.0)
    evidence = ContentEvidence(ai_scores={suspect: 0.97})

    assert [f.unit_id for f in run(b, evidence).flags] == [suspect]
    permitted = run(b, evidence, context_flags={"notes_permitted": True})
    assert permitted.flags == []
    assert "delivery" in {s.signal for s in permitted.skipped}


def test_ai_like_wording_is_discounted_when_the_candidates_small_talk_scores_the_same():
    b = InterviewBuilder()
    easy = [b.ask(natural(60), latency=0.7, type="rapport", difficulty="easy", baseline=True) for _ in range(4)]
    b.ask(natural(80), latency=1.0)
    suspect = b.ask(polished(30) + " " + natural(60), latency=7.0)
    scores = {unit_id: 0.85 for unit_id in easy} | {suspect: 0.9}

    result = run(b, ContentEvidence(ai_scores=scores))

    assert result.flags == []


def test_shallow_follow_up_answers_count_toward_the_parent_question_and_raise_confidence():
    b = InterviewBuilder()
    b.small_talk()
    b.ask(natural(80), latency=1.0)
    parent = b.ask(polished(80), latency=7.0, even=True)
    b.ask(natural(20), latency=0.8, parent=parent, question="Why that approach?")
    b.ask(natural(80), latency=1.0)
    evidence = ContentEvidence(
        depth={parent: DepthJudgment(collapsed=True, rationale="The follow-up restated the answer without reasons.")}
    )

    result = run(b, evidence)

    assert [(f.unit_id, f.confidence) for f in result.flags] == [(parent, "high")]
    assert result.flags[0].families == ["content", "delivery", "timing"]


def test_at_most_five_flags_are_reported():
    b = InterviewBuilder()
    b.small_talk()
    suspects = []
    for _ in range(7):
        suspects.append(b.ask(polished(30) + " " + natural(60), latency=7.0))
        b.ask(natural(80), latency=1.0)
        b.ask(natural(80), latency=0.9)

    result = run(b, ContentEvidence(ai_scores={s: 0.97 for s in suspects}))

    assert len(result.flags) == 5


def test_custom_thresholds_change_the_outcome_without_code_changes():
    b = InterviewBuilder()
    b.small_talk()
    b.ask(natural(80), latency=1.0)
    suspect = b.ask(polished(30) + " " + natural(60), latency=7.0)
    evidence = ContentEvidence(ai_scores={suspect: 0.85})

    assert len(run(b, evidence).flags) == 1
    assert run(b, evidence, config=ReviewConfig(ai_score_min=0.9)).flags == []

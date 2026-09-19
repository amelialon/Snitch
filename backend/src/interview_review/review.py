"""The pure core: transcript + segmentation + content evidence -> signals and flags.

No I/O, no clock, no randomness, no LLM. Everything the product promises about flags is
decided here, by rules over a ReviewConfig, so a flag is reproducible and auditable.
"""

from __future__ import annotations

import statistics

from pydantic import BaseModel, Field

from .models import (
    FILLERS,
    Baseline,
    Confidence,
    ContentEvidence,
    Evidence,
    Family,
    Flag,
    Segmentation,
    Signal,
    Skipped,
    Transcript,
    Unit,
    UnitView,
    Word,
    normalize_word,
    turn_words,
)

# Extra seconds of thinking time that is normal for a question, on top of the candidate's
# small-talk latency. Hard design questions legitimately take long; they must not look anomalous.
_ALLOWANCE: dict[str, dict[str, float]] = {
    "rapport": {"easy": 0.0, "medium": 0.0, "hard": 0.0},
    "autobiographical": {"easy": 0.0, "medium": 0.3, "hard": 0.6},
    "behavioral": {"easy": 0.5, "medium": 1.0, "hard": 1.5},
    "knowledge": {"easy": 0.2, "medium": 0.6, "hard": 1.2},
    "problem_solving": {"easy": 1.5, "medium": 3.0, "hard": 5.0},
    # Type adjustment unavailable: be generous rather than punish thinking.
    "unknown": {"easy": 1.0, "medium": 1.5, "hard": 2.5},
}

_THINKING_ALOUD = ("let me think", "let me see", "give me a second", "give me a moment", "good question")

# Behavioural families can reflect a person's natural style; content evidence cannot.
_STYLE_FAMILIES: frozenset[str] = frozenset({"timing", "delivery"})


class ReviewConfig(BaseModel):
    min_baseline_words: int = 100
    min_baseline_latencies: int = 3
    latency_scale_floor: float = 0.4
    latency_z: float = 2.5
    latency_z_strong: float = 4.0
    # Guard against a tiny baseline spread making sub-second differences look large.
    min_pause_sec: float = 2.0
    fluent_opening_words: int = 25
    min_answer_words: int = 50
    min_baseline_filler_rate: float = 1.5
    disfluency_drop_ratio: float = 0.35
    disfluency_drop_ratio_strong: float = 0.15
    even_pace_ratio: float = 0.6
    even_pace_ratio_strong: float = 0.45
    ai_score_min: float = 0.8
    ai_score_strong: float = 0.95
    ai_score_margin: float = 0.3
    style_fraction: float = 0.6
    style_min_units: int = 4
    max_flags: int = 5


class ReviewResult(BaseModel):
    baseline: Baseline | None
    signals: list[Signal]
    flags: list[Flag]
    skipped: list[Skipped] = Field(default_factory=list)


def review(
    transcript: Transcript,
    segmentation: Segmentation,
    evidence: ContentEvidence,
    *,
    config: ReviewConfig | None = None,
    context_flags: dict[str, bool] | None = None,
) -> ReviewResult:
    config = config or ReviewConfig()
    context_flags = context_flags or {}
    answers = _Answers(transcript, segmentation)
    skipped: list[Skipped] = []

    baseline = _build_baseline(answers, evidence, config)
    signals: list[Signal] = []

    if baseline is None:
        reason = (
            f"not enough easy conversation to learn this candidate's normal "
            f"(need about {config.min_baseline_words} words of small talk or easy answers)"
        )
        skipped += [Skipped(signal="timing", reason=reason), Skipped(signal="delivery", reason=reason)]
    else:
        if baseline.latency_median is None:
            skipped.append(
                Skipped(signal="timing", reason="too few baseline exchanges to learn typical response time")
            )
        else:
            signals += _timing_signals(answers, baseline, config)

        if context_flags.get("notes_permitted") or context_flags.get("open_book"):
            skipped.append(
                Skipped(signal="delivery", reason="notes were permitted, so read-aloud delivery is not meaningful")
            )
        else:
            signals += _delivery_signals(answers, baseline, config)

    signals += _content_signals(answers, evidence, baseline, config)
    skipped += _suppress_natural_style(signals, answers, config)

    flags = _fuse(signals, answers, config)
    return ReviewResult(baseline=baseline, signals=signals, flags=flags, skipped=skipped)


def resolve_units(transcript: Transcript, segmentation: Segmentation) -> list[UnitView]:
    """Units resolved to text and time, for display and for gathering content evidence."""
    return _Answers(transcript, segmentation).views()


def strip_fillers(text: str) -> str:
    return " ".join(t for t in text.split() if normalize_word(t) not in FILLERS)


# --- resolving units against the transcript --------------------------------------


class _Answers:
    """Looks up each unit's words and timing once."""

    def __init__(self, transcript: Transcript, segmentation: Segmentation) -> None:
        self.units = segmentation.units
        self.by_id = {u.id: u for u in self.units}
        self._turns = turn_words(transcript)
        self._candidate = segmentation.candidate_speaker

    def _words(self, turn_indices: list[int]) -> list[Word]:
        return [w for i in turn_indices if 0 <= i < len(self._turns) for w in self._turns[i]]

    def answer_words(self, unit: Unit) -> list[Word]:
        return [w for w in self._words(unit.answer_turns) if w.speaker == self._candidate]

    def question_words(self, unit: Unit) -> list[Word]:
        return self._words(unit.question_turns)

    def latency(self, unit: Unit) -> float | None:
        question, answer = self.question_words(unit), self.answer_words(unit)
        if not question or not answer:
            return None
        gap = answer[0].start - question[-1].end
        return gap if gap >= 0 else None  # overlap: talking over each other, not measurable

    def group_id(self, unit: Unit) -> str:
        return unit.parent_id if unit.parent_id in self.by_id else unit.id

    def is_baseline(self, unit: Unit) -> bool:
        # Rapport and any autobiographical answer are baseline material: the candidate is describing
        # their own experience, where they speak naturally and a copilot can't feed them their own
        # history. Difficulty is irrelevant here — a detailed answer about their own work is still
        # their normal voice, and it's often the bulk of the easy speech in a short interview.
        return unit.is_baseline or unit.type in ("rapport", "autobiographical")

    def views(self) -> list[UnitView]:
        out = []
        for unit in self.units:
            question, answer = self.question_words(unit), self.answer_words(unit)
            if not question or not answer:
                continue
            out.append(
                UnitView(
                    id=unit.id,
                    parent_id=unit.parent_id,
                    type=unit.type,
                    difficulty=unit.difficulty,
                    is_baseline=self.is_baseline(unit),
                    question=" ".join(w.text for w in question),
                    answer=" ".join(w.text for w in answer),
                    question_start=question[0].start,
                    answer_start=answer[0].start,
                    answer_end=answer[-1].end,
                )
            )
        return out


# --- measurements ---------------------------------------------------------------


def _filler_rate(words: list[Word]) -> float:
    return 100.0 * sum(w.is_filler for w in words) / len(words) if words else 0.0


def _gap_cv(words: list[Word]) -> float | None:
    gaps = [b.start - a.start for a, b in zip(words, words[1:]) if b.start > a.start]
    if len(gaps) < 10:
        return None
    mean = statistics.fmean(gaps)
    return statistics.pstdev(gaps) / mean if mean > 0 else None


def _opens_fluently(words: list[Word], n: int) -> bool:
    opening = words[:n]
    if any(w.is_filler for w in opening):
        return False
    text = " ".join(normalize_word(w.text) for w in opening)
    return not any(phrase in text for phrase in _THINKING_ALOUD)


# --- baseline -------------------------------------------------------------------


def _build_baseline(answers: _Answers, evidence: ContentEvidence, config: ReviewConfig) -> Baseline | None:
    units = [u for u in answers.units if answers.is_baseline(u)]
    words = [w for u in units for w in answers.answer_words(u)]
    if len(words) < config.min_baseline_words:
        return None

    latencies = [lat for u in units if (lat := answers.latency(u)) is not None]
    median = scale = None
    if len(latencies) >= config.min_baseline_latencies:
        median = statistics.median(latencies)
        mad = statistics.median(abs(x - median) for x in latencies)
        scale = max(mad * 1.4826, config.latency_scale_floor)

    cvs = [cv for u in units if (cv := _gap_cv(answers.answer_words(u))) is not None]
    ai = [evidence.ai_scores[u.id] for u in units if u.id in evidence.ai_scores]
    return Baseline(
        words=len(words),
        latency_median=median,
        latency_scale=scale,
        filler_rate=_filler_rate(words),
        gap_cv=statistics.median(cvs) if cvs else None,
        ai_score_median=statistics.median(ai) if ai else None,
    )


# --- signal families ------------------------------------------------------------


def _timing_signals(answers: _Answers, baseline: Baseline, config: ReviewConfig) -> list[Signal]:
    out = []
    for unit in answers.units:
        latency = answers.latency(unit)
        if latency is None or answers.is_baseline(unit):
            continue
        words = answers.answer_words(unit)
        expected = baseline.latency_median + _ALLOWANCE[unit.type][unit.difficulty]
        z = (latency - expected) / baseline.latency_scale
        fluent = _opens_fluently(words, config.fluent_opening_words)
        anomalous = z >= config.latency_z and latency >= config.min_pause_sec and fluent
        opening = "then a fluent, filler-free opening" if fluent else "then visible thinking aloud"
        out.append(
            Signal(
                unit_id=unit.id,
                family="timing",
                name="pause_then_fluent",
                value=round(latency, 2),
                baseline_value=round(baseline.latency_median, 2),
                deviation=round(z, 2),
                anomalous=anomalous,
                strong=anomalous and z >= config.latency_z_strong,
                evidence=Evidence(
                    start=answers.question_words(unit)[-1].end,
                    end=words[0].start,
                    note=(
                        f"{latency:.1f}s of silence before answering ({opening}); this candidate "
                        f"typically starts within {baseline.latency_median:.1f}s, and about "
                        f"{expected:.1f}s would be normal for this kind of question"
                    ),
                ),
            )
        )
    return out


def _delivery_signals(answers: _Answers, baseline: Baseline, config: ReviewConfig) -> list[Signal]:
    out = []
    for unit in answers.units:
        words = answers.answer_words(unit)
        if answers.is_baseline(unit) or len(words) < config.min_answer_words:
            continue
        span = dict(start=words[0].start, end=words[-1].end)

        if baseline.filler_rate >= config.min_baseline_filler_rate:
            rate = _filler_rate(words)
            ratio = rate / baseline.filler_rate
            out.append(
                Signal(
                    unit_id=unit.id,
                    family="delivery",
                    name="disfluency_drop",
                    value=round(rate, 2),
                    baseline_value=round(baseline.filler_rate, 2),
                    deviation=round(1 - ratio, 2),
                    anomalous=ratio <= config.disfluency_drop_ratio,
                    strong=ratio <= config.disfluency_drop_ratio_strong,
                    evidence=Evidence(
                        **span,
                        note=(
                            f"{rate:.1f} fillers per 100 words across {len(words)} words; this "
                            f"candidate's normal is {baseline.filler_rate:.1f}"
                        ),
                    ),
                )
            )

        cv = _gap_cv(words)
        if cv is not None and baseline.gap_cv:
            ratio = cv / baseline.gap_cv
            out.append(
                Signal(
                    unit_id=unit.id,
                    family="delivery",
                    name="even_pace",
                    value=round(cv, 2),
                    baseline_value=round(baseline.gap_cv, 2),
                    deviation=round(1 - ratio, 2),
                    anomalous=ratio <= config.even_pace_ratio,
                    strong=ratio <= config.even_pace_ratio_strong,
                    evidence=Evidence(
                        **span,
                        note=(
                            f"unusually even pacing (word-timing variability {cv:.2f} vs. this "
                            f"candidate's normal {baseline.gap_cv:.2f}), which is typical of reading aloud"
                        ),
                    ),
                )
            )
    return out


def _content_signals(
    answers: _Answers, evidence: ContentEvidence, baseline: Baseline | None, config: ReviewConfig
) -> list[Signal]:
    out = []
    own_normal = baseline.ai_score_median if baseline else None

    for unit in answers.units:
        score = evidence.ai_scores.get(unit.id)
        words = answers.answer_words(unit)
        if score is None or answers.is_baseline(unit) or not words:
            continue
        above_own_normal = own_normal is None or score - own_normal >= config.ai_score_margin
        anomalous = score >= config.ai_score_min and above_own_normal
        comparison = (
            f"this candidate's easy answers score {own_normal:.2f}"
            if own_normal is not None
            else "no easy answer was long enough to compare against"
        )
        out.append(
            Signal(
                unit_id=unit.id,
                family="content",
                name="ai_text",
                value=round(score, 2),
                baseline_value=own_normal,
                deviation=round(score - (own_normal or 0.0), 2),
                anomalous=anomalous,
                strong=anomalous and score >= config.ai_score_strong,
                evidence=Evidence(
                    start=words[0].start,
                    end=words[-1].end,
                    note=f"AI-text detector score {score:.2f} for the wording of this answer; {comparison}",
                ),
            )
        )

    for parent_id, judgment in evidence.depth.items():
        parent = answers.by_id.get(parent_id)
        follow_ups = [u for u in answers.units if u.parent_id == parent_id]
        spans = [w for u in follow_ups for w in answers.answer_words(u)]
        if parent is None or not spans:
            continue
        out.append(
            Signal(
                unit_id=parent_id,
                family="content",
                name="depth_collapse",
                value=1.0 if judgment.collapsed else 0.0,
                deviation=1.0 if judgment.collapsed else 0.0,
                anomalous=judgment.collapsed,
                strong=judgment.collapsed,
                evidence=Evidence(start=spans[0].start, end=spans[-1].end, note=judgment.rationale),
            )
        )
    return out


# --- interview-level pass and fusion --------------------------------------------


def _suppress_natural_style(signals: list[Signal], answers: _Answers, config: ReviewConfig) -> list[Skipped]:
    """A behaviour that is unusual in most answers is this person's style, not a moment worth a look."""
    skipped = []
    for name in sorted({s.name for s in signals if s.family in _STYLE_FAMILIES}):
        group = [s for s in signals if s.name == name]
        hits = [s for s in group if s.anomalous]
        if len(group) >= config.style_min_units and len(hits) / len(group) > config.style_fraction:
            for s in hits:
                s.anomalous = s.strong = False
            skipped.append(
                Skipped(
                    signal=name,
                    reason=(
                        f"present in {len(hits)} of {len(group)} answers, so it is treated as this "
                        f"candidate's natural style rather than evidence"
                    ),
                )
            )
    return skipped


_RANK: dict[Confidence, int] = {"low": 0, "medium": 1, "high": 2}


def _fuse(signals: list[Signal], answers: _Answers, config: ReviewConfig) -> list[Flag]:
    groups: dict[str, list[Signal]] = {}
    for s in signals:
        if s.anomalous and s.unit_id in answers.by_id:
            groups.setdefault(answers.group_id(answers.by_id[s.unit_id]), []).append(s)

    views = {v.id: v for v in answers.views()}
    flags = []
    for group_id, hits in groups.items():
        families: list[Family] = sorted({s.family for s in hits})
        if len(families) < 2:
            continue
        spans = [views[s.unit_id] for s in hits if s.unit_id in views]
        flags.append(
            Flag(
                id=f"flag-{group_id}",
                unit_id=group_id,
                start=min(v.question_start for v in spans),
                end=max(v.answer_end for v in spans),
                confidence=_confidence(families, hits),
                families=families,
                signals=hits,
            )
        )

    flags.sort(key=lambda f: (-_RANK[f.confidence], -len(f.families), -sum(s.strong for s in f.signals), f.start))
    return sorted(flags[: config.max_flags], key=lambda f: f.start)


def _confidence(families: list[Family], hits: list[Signal]) -> Confidence:
    decisive = any(s.name == "depth_collapse" or s.family == "canary" for s in hits)
    if len(families) >= 3 and decisive:
        return "high"
    every_family_strong = all(any(s.strong for s in hits if s.family == f) for f in families)
    if len(families) >= 3 or every_family_strong:
        return "medium"
    return "low"

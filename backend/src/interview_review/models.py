"""Data shapes shared by every module. Single source of truth; web/lib/types.ts mirrors these."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

QuestionType = Literal[
    "rapport", "autobiographical", "behavioral", "knowledge", "problem_solving", "unknown"
]
Difficulty = Literal["easy", "medium", "hard"]
Family = Literal["timing", "delivery", "content", "visual", "canary"]
Confidence = Literal["low", "medium", "high"]
Status = Literal["processing", "ready", "failed"]
AiTextClass = Literal["human", "mixed", "ai"]
DeliveryClass = Literal["normal", "medium", "abnormal"]
AlignmentScore = Literal["high", "medium", "low"]

FILLERS = frozenset({"um", "uh", "er", "erm", "ah", "hmm", "mm", "mhm", "uhm", "umm", "uhh"})
_WORD_CHARS = re.compile(r"[^a-z']")


def normalize_word(text: str) -> str:
    return _WORD_CHARS.sub("", text.lower())


# --- transcript -----------------------------------------------------------------


class Word(BaseModel):
    text: str
    start: float  # seconds
    end: float
    speaker: str
    confidence: float = 1.0

    @property
    def is_filler(self) -> bool:
        return normalize_word(self.text) in FILLERS


class Transcript(BaseModel):
    words: list[Word]
    duration: float = 0.0


class Turn(BaseModel):
    """Consecutive words by one speaker. The unit the Analyst segments over."""

    index: int
    speaker: str
    start: float
    end: float
    text: str


def turn_words(transcript: Transcript) -> list[list[Word]]:
    """Words grouped into turns: a turn is consecutive words by one speaker."""
    turns: list[list[Word]] = []
    for word in transcript.words:
        if turns and turns[-1][-1].speaker == word.speaker:
            turns[-1].append(word)
        else:
            turns.append([word])
    return turns


def to_turns(transcript: Transcript) -> list[Turn]:
    return [
        Turn(
            index=i,
            speaker=words[0].speaker,
            start=words[0].start,
            end=words[-1].end,
            text=" ".join(w.text for w in words),
        )
        for i, words in enumerate(turn_words(transcript))
    ]


# --- segmentation ---------------------------------------------------------------


class Unit(BaseModel):
    """One interviewer question and the candidate's answer. Follow-ups point at their parent."""

    id: str
    parent_id: str | None = None
    question_turns: list[int]
    answer_turns: list[int]
    type: QuestionType = "unknown"
    difficulty: Difficulty = "medium"
    is_baseline: bool = False


class Segmentation(BaseModel):
    candidate_speaker: str
    units: list[Unit]


# --- evidence and signals -------------------------------------------------------


class DepthJudgment(BaseModel):
    collapsed: bool
    rationale: str


class RawAiSentence(BaseModel):
    """One sentence as GPTZero split it, before alignment back to the transcript."""

    text: str
    score: float


class AiTextRaw(BaseModel):
    """What an AiTextDetector returns for one answer: the vendor's own classification plus
    sentence-level scores, unaligned to the transcript (the detector never sees word timing)."""

    overall_class: AiTextClass
    overall_score: float
    sentences: list[RawAiSentence] = Field(default_factory=list)


class SentenceAiScore(BaseModel):
    """One GPTZero sentence, located back in the transcript and bucketed for highlighting."""

    text: str
    start: float
    end: float
    score: float
    cls: AiTextClass


class UnitAiText(BaseModel):
    unit_id: str
    overall_class: AiTextClass
    overall_score: float
    sentences: list[SentenceAiScore] = Field(default_factory=list)


class AiTextSummary(BaseModel):
    """One-line-box view across every answer GPTZero scored."""

    dominant_class: AiTextClass
    counts: dict[str, int]  # "human" | "mixed" | "ai" -> count
    analyzed_count: int


class CvAlignment(BaseModel):
    level: AlignmentScore
    contradiction_count: int
    checked_count: int


class DeliveryPattern(BaseModel):
    overall_class: DeliveryClass
    description: str


class HiddenPromptAnswer(BaseModel):
    """One answer handed to a HiddenPromptJudge."""

    unit_id: str
    question: str
    answer: str


class HiddenPromptJudgment(BaseModel):
    """A judge's verdict on one answer: did it carry out the hidden instruction?"""

    unit_id: str
    followed: bool
    quote: str = ""  # verbatim words from the answer that show it; used to locate and highlight
    rationale: str = ""


class UnitHiddenPrompt(BaseModel):
    unit_id: str
    followed: bool
    rationale: str = ""
    start: float | None = None  # located quote when followed, else the whole answer
    end: float | None = None


class HiddenPromptResult(BaseModel):
    """How many of the candidate's answers carried out the hidden on-screen instruction. Display only:
    it never creates or strengthens a flag by itself (a single signal never does)."""

    instruction: str
    shown_to_candidate: bool = True  # False: an uploaded recording, checked against the standard prompt it never saw
    checked_count: int
    matched_count: int
    units: list[UnitHiddenPrompt] = Field(default_factory=list)


class ContentEvidence(BaseModel):
    """Evidence gathered from vendors before the pure review. A missing key means not evaluated."""

    ai_scores: dict[str, float] = Field(default_factory=dict)  # unit id -> 0..1
    ai_text: dict[str, UnitAiText] = Field(default_factory=dict)  # unit id -> timestamped detail
    depth: dict[str, DepthJudgment] = Field(default_factory=dict)  # parent unit id -> judgment


class Evidence(BaseModel):
    start: float
    end: float
    note: str


class Signal(BaseModel):
    unit_id: str
    family: Family
    name: str
    value: float
    baseline_value: float | None = None
    deviation: float
    anomalous: bool
    strong: bool = False
    evidence: Evidence


class Skipped(BaseModel):
    signal: str
    reason: str
    unit_id: str | None = None


class Baseline(BaseModel):
    words: int
    latency_median: float | None
    latency_scale: float | None
    filler_rate: float  # fillers per 100 words
    gap_cv: float | None  # variability of word-to-word gaps
    ai_score_median: float | None = None


# --- report ---------------------------------------------------------------------


class Flag(BaseModel):
    id: str
    unit_id: str
    start: float
    end: float
    confidence: Confidence
    families: list[Family]
    signals: list[Signal]
    explanation: str = ""
    alternative_explanations: list[str] = Field(default_factory=list)
    verification_prompt: str = ""


class CvFinding(BaseModel):
    """A spoken claim that contradicts the CV. Deliberately contradictions only — see context.md:
    an absent CV mention is not evidence of anything and must never be flagged."""

    claim: str
    unit_id: str | None = None
    cv_evidence: str
    classification: Literal["contradiction"] = "contradiction"
    transcript_quote: str = ""  # verbatim phrase from the answer; located in the transcript by pipeline.py
    start: float | None = None
    end: float | None = None


class UnitView(BaseModel):
    """A unit resolved to text and time, for display."""

    id: str
    parent_id: str | None
    type: QuestionType
    difficulty: Difficulty
    is_baseline: bool
    question: str
    answer: str
    question_start: float
    answer_start: float
    answer_end: float


class Report(BaseModel):
    units: list[UnitView]
    candidate_speaker: str
    baseline: Baseline | None
    signals: list[Signal]
    flags: list[Flag]
    cv_findings: list[CvFinding]
    skipped: list[Skipped]
    adapters: dict[str, str]
    pipeline_version: str
    ai_text_summary: AiTextSummary | None = None
    ai_text: list[UnitAiText] = Field(default_factory=list)
    # Optional: reports written before these existed must still load (reports are immutable).
    cv_alignment: CvAlignment | None = None
    delivery_pattern: DeliveryPattern | None = None
    hidden_prompt: HiddenPromptResult | None = None
    summary_note: str = ""


# --- interview record -----------------------------------------------------------


class Consent(BaseModel):
    attested_by: str
    attested_at: datetime
    text_version: str = "v1"


class Feedback(BaseModel):
    useful: bool
    reason: str = ""
    at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Interview(BaseModel):
    id: str
    candidate_label: str
    status: Status = "processing"
    stage: str = "queued"
    progress: float = 0.0
    context_flags: dict[str, bool] = Field(default_factory=dict)
    consent: Consent
    scheduled_for: datetime | None = None  # live rooms only: when the interview is planned to happen
    files: dict[str, str] = Field(default_factory=dict)  # role -> stored file name
    hidden_prompt: str | None = None  # the instruction the candidate's page displayed, if any (live room)
    fingerprints: dict[str, str] = Field(default_factory=dict)  # role -> sha256 of the uploaded bytes
    summary: dict[str, float | int | str] = Field(default_factory=dict)
    feedback: dict[str, Feedback] = Field(default_factory=dict)
    error: str | None = None
    owner_id: str = "demo"
    org_id: str = "demo"
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)

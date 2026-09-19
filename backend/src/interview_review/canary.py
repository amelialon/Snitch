"""Live-session records and canary marker detection.

A canary is a pre-generated spoken instruction (produced elsewhere) that a recruiter may mix
into the outgoing call audio during a consented interview, to test whether a real-time AI
copilot picks it up. This module holds the records the live room writes, and the check that runs
after transcription. It never decides guilt: a triggered marker is one signal in the canary
family, subject to the same corroboration rule as every other signal (SPEC §6).
"""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, Field


class QuestionEvent(BaseModel):
    """Timestamps for one interview question. Feeds response-latency analysis later."""

    id: str
    text: str = ""
    parent_id: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    answer_started_at: datetime | None = None
    answer_ended_at: datetime | None = None


class CanaryEvent(BaseModel):
    """One canary transmission during a live interview. Written when the recruiter sends it."""

    canary_id: str
    question_id: str | None = None
    expected_marker: str
    instruction: str = ""
    delivery_method: str = "outgoing-audio-mix"
    gain_db: float | None = None
    sent_at: datetime
    finished_at: datetime | None = None
    # Set after transcription by check_marker; None until then.
    response_contained_marker: bool | None = None
    matched_text: str | None = None
    # An honest candidate who asks "did you say lighthouse?" is a NON-hit (SPEC §6).
    candidate_acknowledged_hearing: bool = False


class SessionLog(BaseModel):
    """The live room's append-only log for one interview."""

    questions: list[QuestionEvent] = Field(default_factory=list)
    canaries: list[CanaryEvent] = Field(default_factory=list)


class MarkerMatch(BaseModel):
    triggered: bool
    expected_marker: str
    matched_text: str | None = None


def check_marker(answer_text: str, expected_marker: str) -> MarkerMatch:
    """MVP exact-word match. A later version may use semantic matching (paraphrase counts too)."""
    pattern = re.compile(rf"\b{re.escape(expected_marker.strip())}\b", re.IGNORECASE)
    found = pattern.search(answer_text)
    return MarkerMatch(
        triggered=found is not None,
        expected_marker=expected_marker,
        matched_text=found.group(0) if found else None,
    )

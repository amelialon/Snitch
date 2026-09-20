"""The five seams. Each is a real vendor or storage boundary; see architecture.md §2."""

from __future__ import annotations

import io
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, BinaryIO, Protocol, TypeVar

from pydantic import BaseModel

from .models import (
    AiTextClass,
    AiTextRaw,
    CvFinding,
    DepthJudgment,
    Flag,
    Interview,
    Segmentation,
    Transcript,
    Turn,
    UnitView,
)
from .review import ReviewConfig


class Unavailable(Exception):
    """An adapter cannot perform this operation. The pipeline reports it as a skipped signal."""


class Store(Protocol):
    name: str

    def create_interview(self, interview: Interview) -> None: ...
    def get_interview(self, interview_id: str) -> Interview | None: ...
    def list_interviews(self) -> list[Interview]: ...
    def update_interview(self, interview_id: str, fields: dict[str, Any]) -> None: ...
    def delete_interview(self, interview_id: str) -> None: ...
    def put_file(self, interview_id: str, name: str, src: BinaryIO) -> None: ...
    def has_file(self, interview_id: str, name: str) -> bool: ...
    def copy_file(self, src_id: str, dst_id: str, name: str) -> None:
        """Copy a file between interviews without routing the bytes through this process."""
        ...

    def local_path(self, interview_id: str, name: str) -> AbstractContextManager[Path]:
        """A readable local copy of the file, valid inside the context."""
        ...

    def public_url(self, interview_id: str, name: str) -> str | None:
        """A URL the browser can fetch directly, or None if the API should serve the file."""
        ...


class Transcriber(Protocol):
    name: str

    def transcribe(self, path: Path) -> Transcript: ...


class FlagContext(BaseModel):
    flag: Flag
    question: str
    answer: str


class FlagNarrative(BaseModel):
    flag_id: str
    explanation: str
    alternative_explanations: list[str]
    verification_prompt: str


class ReportDigest(BaseModel):
    """Computed, structured facts about one report - never raw text - handed to `Analyst.summarize`
    so the write-up can't smuggle in anything the deterministic builders didn't already decide."""

    flag_count: int
    families: list[str]
    ai_class: AiTextClass | None
    ai_counts: dict[str, int]
    cv_level: str | None
    cv_contradictions: int
    delivery_class: str
    delivery_note: str


class Analyst(Protocol):
    name: str

    def segment(self, turns: list[Turn]) -> Segmentation: ...
    def judge_depth(self, parent: UnitView, follow_ups: list[UnitView]) -> DepthJudgment: ...
    def explain_flags(self, contexts: list[FlagContext]) -> list[FlagNarrative]: ...
    def summarize(self, digest: ReportDigest) -> str: ...


class CvAnalyzer(Protocol):
    name: str

    def find_inconsistencies(self, cv_text: str, units: list[UnitView]) -> list[CvFinding]:
        """Spoken claims that contradict, or are conspicuously absent from, the CV."""
        ...


class AiTextDetector(Protocol):
    name: str

    def analyze(self, text: str) -> AiTextRaw:
        """The vendor's classification of this text, plus its own sentence-level scores."""
        ...


@dataclass
class Deps:
    store: Store
    transcriber: Transcriber
    analyst: Analyst
    detector: AiTextDetector | None = None
    cv_analyzer: CvAnalyzer | None = None
    config: ReviewConfig = field(default_factory=ReviewConfig)


# --- typed JSON files on top of Store -------------------------------------------

M = TypeVar("M", bound=BaseModel)


def save_model(store: Store, interview_id: str, name: str, model: BaseModel) -> None:
    store.put_file(interview_id, name, io.BytesIO(model.model_dump_json().encode()))


def load_model(store: Store, interview_id: str, name: str, cls: type[M]) -> M | None:
    if not store.has_file(interview_id, name):
        return None
    with store.local_path(interview_id, name) as path:
        return cls.model_validate_json(path.read_text(encoding="utf-8"))

"""CvAnalyzer adapter backed by the OpenAI API, using structured outputs."""

from __future__ import annotations

from typing import Literal

from openai import OpenAI
from pydantic import BaseModel

from ..models import CvFinding, UnitView

_INSTRUCTIONS = (
    "You are part of an interview review tool used by recruiters. Compare factual claims the candidate "
    "made in the interview against their CV and cover letter: employers, dates, titles, team sizes, "
    "technologies, scope, numbers.\n"
    "Report only:\n"
    "- contradiction: the spoken claim conflicts with the CV (different dates, title, employer, numbers).\n"
    "- unsupported: a significant claim (a role, a major project, a headline technology) that the CV would "
    "be expected to mention and does not.\n"
    "Do not report consistent claims, rounding differences, or minor omissions; CVs are summaries. "
    "cv_evidence quotes or describes what the CV says, or states that it is silent. unit_id is the id in "
    "square brackets of the answer where the claim was made. Describe facts only: never suggest "
    "dishonesty or intent, and never recommend a hiring outcome. An empty list is a normal result."
)


class _Finding(BaseModel):
    claim: str
    unit_id: str | None
    cv_evidence: str
    classification: Literal["contradiction", "unsupported"]


class _Findings(BaseModel):
    findings: list[_Finding]


class OpenAICvAnalyzer:
    name = "openai"

    def __init__(self, model: str = "gpt-5", client: OpenAI | None = None) -> None:
        self._client = client or OpenAI()
        self._model = model

    def find_inconsistencies(self, cv_text: str, units: list[UnitView]) -> list[CvFinding]:
        answers = "\n\n".join(f"[{u.id}] Q: {u.question}\nA: {u.answer}" for u in units)
        response = self._client.responses.parse(
            model=self._model,
            input=[
                {"role": "system", "content": _INSTRUCTIONS},
                {"role": "user", "content": f"CV AND COVER LETTER:\n{cv_text}\n\nINTERVIEW ANSWERS:\n{answers}"},
            ],
            text_format=_Findings,
        )
        parsed: _Findings | None = response.output_parsed
        if parsed is None:
            raise RuntimeError("the CV analyzer returned no usable result")
        known = {u.id for u in units}
        return [
            CvFinding(
                claim=f.claim,
                unit_id=f.unit_id if f.unit_id in known else None,
                cv_evidence=f.cv_evidence,
                classification=f.classification,
            )
            for f in parsed.findings
        ]

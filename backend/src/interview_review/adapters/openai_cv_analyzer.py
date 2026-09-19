"""CvAnalyzer adapter backed by the OpenAI API, using structured outputs."""

from __future__ import annotations

from openai import OpenAI
from pydantic import BaseModel

from ..models import CvFinding, UnitView

_INSTRUCTIONS = (
    "You are part of an interview review tool used by recruiters. Compare factual claims the candidate "
    "made in the interview against their CV and cover letter: employers, dates, titles, team sizes, "
    "technologies, scope, numbers.\n"
    "Report ONLY contradictions: the spoken claim directly conflicts with something the CV states "
    "(a different date, title, employer, team size, or number). If the CV is simply silent on a topic, "
    "or only loosely related, that is NOT a contradiction — do not report it. When you are not sure "
    "there is enough evidence to prove a conflict, do not report it either; an empty list is a normal "
    "and common result.\n"
    "For each contradiction:\n"
    "- claim: the fact as the candidate stated it, in your own words.\n"
    "- transcript_quote: copy a short phrase VERBATIM from the given answer text (a few consecutive "
    "words, exactly as written, not paraphrased) that contains the conflicting fact. This is used to "
    "locate and highlight it, so it must be an exact substring of the answer.\n"
    "- cv_evidence: what the CV actually says, quoted or closely paraphrased.\n"
    "- unit_id: the id in square brackets of the answer where the claim was made.\n"
    "Describe facts only: never suggest dishonesty or intent, and never recommend a hiring outcome."
)


class _Finding(BaseModel):
    claim: str
    unit_id: str | None
    transcript_quote: str
    cv_evidence: str


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
                transcript_quote=f.transcript_quote,
            )
            for f in parsed.findings
        ]

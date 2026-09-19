"""Analyst adapter backed by the OpenAI API (Responses API + structured outputs).

Handles segmentation, depth judgement, and flag write-ups. CV consistency is a separate seam
(OpenAICvAnalyzer). Both use the same OPENAI_API_KEY, server-side only.
"""

from __future__ import annotations

from openai import OpenAI
from pydantic import BaseModel

from ..models import DepthJudgment, Difficulty, QuestionType, Segmentation, Turn, Unit, UnitView
from ..ports import FlagContext, FlagNarrative

_CONTEXT = (
    "You are part of an interview review tool used by recruiters. It points a human reviewer at "
    "a few moments of a recorded interview that deserve a second look, with evidence. It never "
    "decides whether a candidate did anything wrong; the reviewer does. Honest candidates must "
    "not be harmed by careless output, so be precise and conservative."
)


class _SegUnit(BaseModel):
    question_turns: list[int]
    answer_turns: list[int]
    parent_index: int | None
    type: QuestionType
    difficulty: Difficulty
    is_baseline: bool


class _SegOut(BaseModel):
    candidate_speaker: str
    units: list[_SegUnit]


class _NarrativesOut(BaseModel):
    narratives: list[FlagNarrative]


class OpenAIAnalyst:
    name = "openai"

    def __init__(self, model: str = "gpt-5", client: OpenAI | None = None) -> None:
        self._client = client or OpenAI()
        self._model = model

    def _ask(self, instructions: str, material: str, shape: type[BaseModel]):
        response = self._client.responses.parse(
            model=self._model,
            input=[
                {"role": "system", "content": f"{_CONTEXT}\n\n{instructions}"},
                {"role": "user", "content": material},
            ],
            text_format=shape,
        )
        if response.output_parsed is None:
            raise RuntimeError("the analyst model returned no usable result")
        return response.output_parsed

    def segment(self, turns: list[Turn]) -> Segmentation:
        instructions = (
            "Split this interview transcript into question-answer units.\n"
            "- The transcript is a list of turns: [index] speaker (start-end seconds): text.\n"
            "- candidate_speaker is the speaker label of the person being interviewed.\n"
            "- A unit is the interviewer turn(s) that pose one question plus the candidate turn(s) that answer it. "
            "Refer to turns by index only. Short interviewer acknowledgements in the middle of an answer "
            "('mm-hmm', 'right') belong to the answer, not to a new unit. Skip turns that are neither a "
            "question nor an answer (introductions by the interviewer, scheduling, goodbyes).\n"
            "- parent_index: when a question probes the previous answer ('why that approach?', 'can you go "
            "deeper?'), set it to the position in your units list of the original question. Otherwise null.\n"
            "- type: rapport (small talk, logistics), autobiographical (their own history and role), "
            "behavioral (tell me about a time), knowledge (explain or define something), problem_solving "
            "(design, debug, or reason through something new), unknown.\n"
            "- difficulty: how much thinking time a competent candidate would reasonably need.\n"
            "- is_baseline: true for small talk and easy warm-up questions where nobody would need help. "
            "These teach the tool how this candidate normally speaks."
        )
        material = "\n".join(f"[{t.index}] {t.speaker} ({t.start:.1f}-{t.end:.1f}): {t.text}" for t in turns)
        out: _SegOut = self._ask(instructions, material, _SegOut)

        valid = {t.index for t in turns}
        units: list[Unit] = []
        position_to_id: dict[int, str] = {}
        for position, raw in enumerate(out.units):
            question = [i for i in raw.question_turns if i in valid]
            answer = [i for i in raw.answer_turns if i in valid]
            if not question or not answer:
                continue
            unit_id = f"u{len(units) + 1}"
            position_to_id[position] = unit_id
            units.append(
                Unit(
                    id=unit_id,
                    parent_id=position_to_id.get(raw.parent_index) if raw.parent_index is not None else None,
                    question_turns=question,
                    answer_turns=answer,
                    type=raw.type,
                    difficulty=raw.difficulty,
                    is_baseline=raw.is_baseline,
                )
            )
        if not units:
            raise RuntimeError("no question-answer exchanges were found in the transcript")
        return Segmentation(candidate_speaker=out.candidate_speaker, units=units)

    def judge_depth(self, parent: UnitView, follow_ups: list[UnitView]) -> DepthJudgment:
        instructions = (
            "An interviewer asked a question and then probed the answer with follow-ups. Judge one thing: "
            "did the depth of understanding hold up under probing?\n"
            "collapsed=true only when the original answer was detailed and well structured, and the follow-up "
            "answers were shallow, generic, or restated the original without adding reasons, specifics, or "
            "trade-offs that someone who understood their own answer would have. Brief but specific follow-up "
            "answers are NOT a collapse. When in doubt, collapsed=false.\n"
            "rationale: one or two plain sentences a recruiter can check against the recording. Describe what "
            "was said, not the candidate's state of mind. Never suggest emotion, dishonesty, or intent."
        )
        material = f"QUESTION: {parent.question}\nANSWER: {parent.answer}\n\n" + "\n\n".join(
            f"FOLLOW-UP QUESTION: {f.question}\nFOLLOW-UP ANSWER: {f.answer}" for f in follow_ups
        )
        return self._ask(instructions, material, DepthJudgment)

    def explain_flags(self, contexts: list[FlagContext]) -> list[FlagNarrative]:
        instructions = (
            "Deterministic rules have already selected these moments; you are writing them up for a recruiter. "
            "You are not deciding anything, and must not strengthen or weaken the evidence.\n"
            "For each flag write:\n"
            "- explanation: 2-3 plain sentences stating what was measured, using the numbers in the evidence "
            "notes, and that the combination is why it is worth a second look.\n"
            "- alternative_explanations: 2-3 ordinary, innocent reasons this pattern occurs, specific to this "
            "question and answer.\n"
            "- verification_prompt: one concrete follow-up question about THIS topic that the recruiter could "
            "ask live, which someone who understood their answer could handle easily.\n"
            "Describe mechanics only: pauses, filler words, pacing, wording, depth. Never describe emotion or "
            "state of mind, never suggest dishonesty or intent, and never recommend a hiring outcome. Use the "
            "flag_id given."
        )
        material = "\n\n".join(
            f"flag_id: {c.flag.id}\nQUESTION: {c.question}\nANSWER: {c.answer}\nEVIDENCE:\n"
            + "\n".join(f"- ({s.family}) {s.evidence.note}" for s in c.flag.signals)
            for c in contexts
        )
        out: _NarrativesOut = self._ask(instructions, material, _NarrativesOut)
        return out.narratives

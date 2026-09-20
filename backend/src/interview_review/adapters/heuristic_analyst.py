"""Analyst adapter that uses rules instead of an LLM. Offline demo and tests.

It is deliberately simple: good enough to run the product end to end without keys, not a
substitute for OpenAIAnalyst on real interviews. The report names which analyst produced it.
"""

from __future__ import annotations

import re
from collections import Counter

from ..models import DepthJudgment, Segmentation, Turn, Unit, UnitView, normalize_word
from ..narrative import template_narrative, template_summary
from ..ports import FlagContext, FlagNarrative, ReportDigest

_TYPE_PATTERNS: list[tuple[str, str, str]] = [
    ("rapport", "easy", r"how are you|how's your|weekend|weather|find the place|trouble (joining|connecting)|hear me|how was your"),
    ("behavioral", "medium", r"tell me about a time|describe a (time|situation)|give me an example|a time when"),
    ("autobiographical", "easy", r"about yourself|your (current|last|previous) role|your background|walk me through your (resume|cv)|what do you do"),
    ("problem_solving", "hard", r"how would you (design|build|implement|scale|approach)|design a|architect|whiteboard"),
    ("knowledge", "medium", r"what is|what's|what are|explain|difference between|define|how does"),
]
_FOLLOW_UP = re.compile(r"^(why|how so|how come|and |so |can you (elaborate|expand|go deeper)|what do you mean|could you (elaborate|expand))", re.I)
_BACKCHANNEL_MAX_WORDS = 3


class HeuristicAnalyst:
    name = "heuristic"

    def segment(self, turns: list[Turn]) -> Segmentation:
        words_by_speaker = Counter()
        for turn in turns:
            words_by_speaker[turn.speaker] += len(turn.text.split())
        if not words_by_speaker:
            raise ValueError("the transcript has no speech")
        candidate = words_by_speaker.most_common(1)[0][0]

        units: list[Unit] = []
        question: list[int] = []
        for turn in turns:
            if turn.speaker == candidate:
                if question:
                    units.append(self._unit(len(units), question, turn, turns, units))
                    question = []
                elif units:
                    units[-1].answer_turns.append(turn.index)
            elif units and not question and _is_backchannel(turn):
                units[-1].answer_turns.append(turn.index)  # "mm-hmm" mid-answer, not a new question
            else:
                question.append(turn.index)
        return Segmentation(candidate_speaker=candidate, units=units)

    def _unit(self, n: int, question: list[int], answer: Turn, turns: list[Turn], units: list[Unit]) -> Unit:
        text = " ".join(turns[i].text for i in question)
        kind, difficulty = _classify(text)
        previous = units[-1] if units else None
        is_follow_up = (
            previous is not None
            and previous.type != "rapport"
            and len(text.split()) <= 12
            and bool(_FOLLOW_UP.match(text.strip()))
        )
        if is_follow_up:
            kind, difficulty = previous.type, previous.difficulty
        return Unit(
            id=f"u{n + 1}",
            parent_id=(previous.parent_id or previous.id) if is_follow_up else None,
            question_turns=list(question),
            answer_turns=[answer.index],
            type=kind,
            difficulty=difficulty,
            is_baseline=kind == "rapport",
        )

    def judge_depth(self, parent: UnitView, follow_ups: list[UnitView]) -> DepthJudgment:
        parent_words = _content_words(parent.answer)
        if len(parent.answer.split()) < 60:
            return DepthJudgment(collapsed=False, rationale="The original answer was too short to compare depth.")
        shallow = []
        for follow_up in follow_ups:
            words = _content_words(follow_up.answer)
            restated = len(words & parent_words) / len(words) if words else 1.0
            if len(follow_up.answer.split()) < 30 and restated >= 0.6:
                shallow.append(follow_up)
        if shallow and len(shallow) == len(follow_ups):
            return DepthJudgment(
                collapsed=True,
                rationale=(
                    f"A detailed {len(parent.answer.split())}-word answer was followed by brief follow-up "
                    f"answers that mostly reused its wording instead of adding reasons or specifics"
                ),
            )
        return DepthJudgment(collapsed=False, rationale="Follow-up answers added new detail.")

    def explain_flags(self, contexts: list[FlagContext]) -> list[FlagNarrative]:
        return [template_narrative(c) for c in contexts]

    def summarize(self, digest: ReportDigest) -> str:
        return template_summary(digest)


def _classify(question: str) -> tuple[str, str]:
    lowered = question.lower()
    for kind, difficulty, pattern in _TYPE_PATTERNS:
        if re.search(pattern, lowered):
            return kind, difficulty
    return "unknown", "medium"


def _is_backchannel(turn: Turn) -> bool:
    return len(turn.text.split()) <= _BACKCHANNEL_MAX_WORDS and "?" not in turn.text


def _content_words(text: str) -> set[str]:
    return {w for t in text.split() if len(w := normalize_word(t)) > 3}

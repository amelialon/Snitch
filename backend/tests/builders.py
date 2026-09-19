"""Builds synthetic interviews with controlled timing, so tests can state behaviour as worked examples."""

from __future__ import annotations

from interview_review.models import Segmentation, Transcript, Unit, Word

# Spontaneous speech: uneven word-to-word gaps. Read speech: metronomic.
NATURAL_GAPS = [0.22, 0.48, 0.18, 0.75, 0.30, 0.26, 0.95, 0.20, 0.40, 0.33]
EVEN_GAP = 0.32

_VOCAB = (
    "we built the service around a queue so that the workers could pull jobs when they had "
    "capacity and the team owned the deployment pipeline which meant that releases were small "
    "and frequent and I worked closely with product to decide what mattered most each sprint"
).split()


def natural(n_words: int) -> str:
    """Spontaneous-sounding answer: a filler roughly every 12 words."""
    out: list[str] = []
    for i in range(n_words):
        out.append("um" if i % 12 == 5 else _VOCAB[i % len(_VOCAB)])
    return " ".join(out)


def polished(n_words: int) -> str:
    """Filler-free answer."""
    return " ".join(_VOCAB[i % len(_VOCAB)] for i in range(n_words))


class InterviewBuilder:
    def __init__(self) -> None:
        self.words: list[Word] = []
        self.units: list[Unit] = []
        self._t = 0.0
        self._turns = 0

    def _say(self, speaker: str, text: str, *, even: bool) -> int:
        for i, token in enumerate(text.split()):
            gap = EVEN_GAP if even else NATURAL_GAPS[i % len(NATURAL_GAPS)]
            self.words.append(Word(text=token, start=self._t, end=self._t + gap * 0.8, speaker=speaker))
            self._t += gap
        # the turn ends when its last word ends
        self._t = self.words[-1].end
        self._turns += 1
        return self._turns - 1

    def ask(
        self,
        answer: str,
        *,
        question: str = "Can you tell me about that?",
        latency: float = 0.8,
        type: str = "knowledge",
        difficulty: str = "medium",
        baseline: bool = False,
        parent: str | None = None,
        even: bool = False,
    ) -> str:
        self._t += 1.0
        q_turn = self._say("A", question, even=False)
        self._t += latency
        a_turn = self._say("B", answer, even=even)
        unit = Unit(
            id=f"u{len(self.units) + 1}",
            parent_id=parent,
            question_turns=[q_turn],
            answer_turns=[a_turn],
            type=type,
            difficulty=difficulty,
            is_baseline=baseline,
        )
        self.units.append(unit)
        return unit.id

    def small_talk(self, exchanges: int = 4, words_each: int = 40) -> None:
        for i in range(exchanges):
            self.ask(natural(words_each), latency=0.6 + 0.1 * (i % 3), type="rapport", difficulty="easy", baseline=True)

    def build(self) -> tuple[Transcript, Segmentation]:
        transcript = Transcript(words=self.words, duration=self._t)
        return transcript, Segmentation(candidate_speaker="B", units=self.units)

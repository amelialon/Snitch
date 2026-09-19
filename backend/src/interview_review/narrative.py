"""Plain-language flag narratives: the deterministic template, and the guard on LLM-written ones.

The product never labels emotion or deception (SPEC principle; also a legal line under the
EU AI Act). Narratives describe mechanics only. An LLM narrative that crosses the line is
replaced by the template.
"""

from __future__ import annotations

import re

from .ports import FlagContext, FlagNarrative

_BANNED = re.compile(
    r"\b(nervous\w*|anxi\w+|stress\w*|lying|lie[sd]?|liar|decepti\w+|deceiv\w+|dishonest\w*|"
    r"evasive\w*|guilt\w*|cheat\w*|fraud\w*|suspicious\w*)\b",
    re.IGNORECASE,
)

_ALTERNATIVES = {
    "timing": "A long pause can come from connection lag, translating from another language, or carefully recalling a prepared example.",
    "delivery": "Fluent, even delivery is also what a well-rehearsed answer sounds like.",
    "content": "Textbook-style wording is common when a candidate has studied standard material for this topic.",
    "visual": "People often look away from the camera to think, or to a second monitor where the call window sits.",
    "canary": "The marker word may have come up naturally in the candidate's own reasoning.",
}


def uses_banned_language(text: str) -> bool:
    return bool(_BANNED.search(text))


def template_narrative(context: FlagContext) -> FlagNarrative:
    flag = context.flag
    notes = "; ".join(s.evidence.note for s in flag.signals)
    return FlagNarrative(
        flag_id=flag.id,
        explanation=(
            f"{len(flag.families)} independent kinds of evidence lined up on this answer: {notes}. "
            f"Any one of these alone is ordinary; together they make this moment worth a second look."
        ),
        alternative_explanations=[_ALTERNATIVES[f] for f in flag.families],
        verification_prompt=(
            "In a live follow-up, ask the candidate to go one level deeper on this topic in their own "
            "words: a specific example from their work, what went wrong, and what they would change."
        ),
    )


def guarded(narrative: FlagNarrative, context: FlagContext) -> FlagNarrative:
    text = " ".join([narrative.explanation, narrative.verification_prompt, *narrative.alternative_explanations])
    if uses_banned_language(text) or not narrative.explanation.strip():
        return template_narrative(context)
    return narrative

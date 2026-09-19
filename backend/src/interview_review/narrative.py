"""Plain-language flag narratives: the deterministic template, and the guard on LLM-written ones.

The product never labels emotion or deception (SPEC principle; also a legal line under the
EU AI Act). Narratives describe mechanics only. An LLM narrative that crosses the line is
replaced by the template.
"""

from __future__ import annotations

import re

from .models import AiTextSummary, CvAlignment, CvFinding, DeliveryPattern, Signal, UnitAiText
from .ports import FlagContext, FlagNarrative, ReportDigest

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


# --- analysis-box summaries (deterministic classification; see review boxes on the front end) ---

_SIGNAL_PHRASES = {
    "pause_then_fluent": "a long pause before an otherwise fluent answer",
    "disfluency_drop": "unusually few pauses or fillers for this candidate",
    "even_pace": "unusually steady speaking rhythm",
}

_DELIVERY_FAMILIES = frozenset({"timing", "delivery"})


def build_delivery_pattern(signals: list[Signal]) -> DeliveryPattern:
    relevant = [s for s in signals if s.family in _DELIVERY_FAMILIES]
    anomalous = [s for s in relevant if s.anomalous]
    if any(s.strong for s in relevant):
        overall = "abnormal"
    elif anomalous:
        overall = "medium"
    else:
        overall = "normal"

    if not anomalous:
        description = "Pauses, fillers, and speaking rhythm were within this candidate's normal range."
    else:
        phrases = [_SIGNAL_PHRASES.get(name, name) for name in sorted({s.name for s in anomalous})]
        description = "; ".join(phrases).capitalize() + "."
    return DeliveryPattern(overall_class=overall, description=description)


def build_cv_alignment(findings: list[CvFinding], checked_count: int) -> CvAlignment:
    count = len(findings)
    level = "high" if count == 0 else "medium" if count == 1 else "low"
    return CvAlignment(level=level, contradiction_count=count, checked_count=checked_count)


_CLASS_RANK = {"human": 0, "mixed": 1, "ai": 2}


def build_ai_text_summary(ai_text: dict[str, UnitAiText]) -> AiTextSummary | None:
    if not ai_text:
        return None
    counts = {"human": 0, "mixed": 0, "ai": 0}
    for unit in ai_text.values():
        counts[unit.overall_class] += 1
    dominant = max(counts, key=lambda cls: (counts[cls] > 0, _CLASS_RANK[cls]))
    return AiTextSummary(dominant_class=dominant, counts=counts, analyzed_count=len(ai_text))


def template_summary(digest: ReportDigest) -> str:
    parts = []
    if digest.flag_count:
        parts.append(f"{digest.flag_count} moment{'s' if digest.flag_count != 1 else ''} worth a second look")
    else:
        parts.append("no moments were flagged")
    if digest.ai_class is not None:
        parts.append(f"AI-text signal reads {digest.ai_class}")
    if digest.cv_level is not None:
        parts.append(f"CV alignment is {digest.cv_level}")
    parts.append(f"delivery and pacing were {digest.delivery_class}")
    return ", ".join(parts).capitalize() + "."


def guarded_summary(text: str, digest: ReportDigest) -> str:
    if uses_banned_language(text) or not text.strip():
        return template_summary(digest)
    return text

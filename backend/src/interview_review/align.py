"""Locating vendor/LLM text back in the word-level transcript, for highlighting.

Pure: no I/O, no clock. GPTZero sentences and CV-analyzer quotes are strings; the transcript
pane needs timestamps. These two functions bridge that gap on a best-effort basis.
"""

from __future__ import annotations

from .models import Word, normalize_word


def words_in_span(
    words: list[Word], start: float, end: float, speaker: str | None = None, eps: float = 0.05
) -> list[Word]:
    """Words whose timing falls inside [start, end], optionally restricted to one speaker."""
    return [
        w
        for w in words
        if w.start >= start - eps and w.end <= end + eps and (speaker is None or w.speaker == speaker)
    ]


def locate_phrase(words: list[Word], phrase: str) -> tuple[float, float] | None:
    """The (start, end) time of `phrase` as a contiguous, normalized run within `words`.

    Both sides are normalized the same way text is before being sent to a vendor (see
    `strip_fillers`/`normalize_word`), so a verbatim quote lines up even if casing or
    punctuation differs. No match (paraphrase, or the vendor didn't quote verbatim) -> None;
    callers treat that as "can't be highlighted", not an error.
    """
    target = [t for tok in phrase.split() if (t := normalize_word(tok))]
    if not target:
        return None
    hay = [normalize_word(w.text) for w in words]
    n, m = len(hay), len(target)
    for i in range(n - m + 1):
        if hay[i : i + m] == target:
            return words[i].start, words[i + m - 1].end
    return None

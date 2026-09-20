"""locate_phrase / words_in_span: mapping vendor text back to transcript timestamps."""

from interview_review.align import locate_phrase, words_in_span
from interview_review.models import Word

WORDS = [
    Word(text="We", start=0.0, end=0.2, speaker="B"),
    Word(text="went", start=0.2, end=0.4, speaker="B"),
    Word(text="to", start=0.4, end=0.5, speaker="B"),
    Word(text="University", start=0.5, end=1.0, speaker="B"),
    Word(text="of", start=1.0, end=1.1, speaker="B"),
    Word(text="Toronto.", start=1.1, end=1.6, speaker="B"),
]


def test_an_exact_verbatim_phrase_is_located():
    span = locate_phrase(WORDS, "University of Toronto")
    assert span == (0.5, 1.6)


def test_casing_and_punctuation_differences_still_match():
    span = locate_phrase(WORDS, "university of toronto")
    assert span == (0.5, 1.6)


def test_a_phrase_that_is_not_a_verbatim_run_of_words_does_not_match():
    assert locate_phrase(WORDS, "a school in Canada") is None


def test_an_empty_phrase_does_not_match():
    assert locate_phrase(WORDS, "") is None


def test_words_in_span_filters_by_time_and_speaker():
    other_speaker = Word(text="Where?", start=-1.0, end=-0.1, speaker="A")
    out_of_range = Word(text="Later.", start=5.0, end=5.5, speaker="B")
    words = [other_speaker, *WORDS, out_of_range]

    result = words_in_span(words, 0.0, 1.6, speaker="B")

    assert result == WORDS

"""What every Store adapter must do. Runs against LocalStore; FirebaseStore needs a live project."""

import io
from datetime import datetime, timezone

import pytest

from interview_review.adapters.local_store import LocalStore
from interview_review.models import Consent, Feedback, Interview


@pytest.fixture
def store(tmp_path):
    return LocalStore(tmp_path)


def interview(interview_id: str = "i1") -> Interview:
    return Interview(
        id=interview_id,
        candidate_label="Candidate",
        consent=Consent(attested_by="r", attested_at=datetime.now(timezone.utc)),
    )


def test_partial_updates_leave_other_fields_alone(store):
    store.create_interview(interview())

    store.update_interview("i1", {"stage": "segmenting", "progress": 0.4})
    store.update_interview("i1", {"feedback": {"flag-u1": Feedback(useful=True, at=datetime.now(timezone.utc))}})

    saved = store.get_interview("i1")
    assert (saved.stage, saved.progress, saved.candidate_label) == ("segmenting", 0.4, "Candidate")
    assert saved.feedback["flag-u1"].useful is True


def test_files_round_trip_and_disappear_on_delete(store):
    store.create_interview(interview())
    store.put_file("i1", "cv.txt", io.BytesIO(b"ten years of Go"))

    with store.local_path("i1", "cv.txt") as path:
        assert path.read_bytes() == b"ten years of Go"

    store.delete_interview("i1")
    assert store.get_interview("i1") is None
    assert not store.has_file("i1", "cv.txt")


def test_newest_interviews_are_listed_first(store):
    store.create_interview(interview("older"))
    store.create_interview(interview("newer"))

    assert [i.id for i in store.list_interviews()] == ["newer", "older"]


def test_names_cannot_escape_the_store(store):
    store.create_interview(interview())

    with pytest.raises(ValueError):
        store.put_file("i1", "../../evil.txt", io.BytesIO(b"x"))
    with pytest.raises(ValueError):
        store.get_interview("../etc")

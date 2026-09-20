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


def test_files_can_be_copied_between_interviews(store):
    store.create_interview(interview("a"))
    store.create_interview(interview("b"))
    store.put_file("a", "cv.txt", io.BytesIO(b"ten years of Go"))

    store.copy_file("a", "b", "cv.txt")

    with store.local_path("b", "cv.txt") as path:
        assert path.read_bytes() == b"ten years of Go"
    assert store.has_file("a", "cv.txt")


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


# --- Firebase credentials: a key-file path locally, the key's JSON inline on Railway ---------------


def test_firebase_credentials_accept_a_path_or_inline_json():
    from interview_review.adapters.firebase_store import service_account

    assert service_account("./firebase-service-account.json") == "./firebase-service-account.json"
    assert service_account(' {"type": "service_account", "project_id": "demo"} ') == {
        "type": "service_account",
        "project_id": "demo",
    }


def test_firebase_credentials_reject_empty_or_broken_json():
    import pytest

    from interview_review.adapters.firebase_store import service_account

    with pytest.raises(ValueError, match="empty"):
        service_account("  ")
    with pytest.raises(ValueError, match="does not parse"):
        service_account('{"type": ')

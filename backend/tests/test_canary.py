"""Canary marker detection and the live-session event log through the API."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from interview_review.adapters.heuristic_analyst import HeuristicAnalyst
from interview_review.adapters.json_transcriber import JsonTranscriber
from interview_review.adapters.local_store import LocalStore
from interview_review.api import create_app
from interview_review.canary import check_marker
from interview_review.models import Consent, Interview
from interview_review.ports import Deps


def test_marker_detection_finds_the_word_only_as_a_whole_word():
    assert check_marker("It works like a lighthouse guiding ships.", "lighthouse").triggered
    assert check_marker("LIGHTHOUSE, basically.", "lighthouse").matched_text == "LIGHTHOUSE"
    # A substring is not a hit: "lighthousekeeper" contains it, "enlighten" does not match.
    assert not check_marker("We enlighten users about the flow.", "light").triggered
    assert not check_marker("No such concept here.", "orchard").triggered


@pytest.fixture
def client(tmp_path):
    store = LocalStore(tmp_path)
    store.create_interview(
        Interview(
            id="i1",
            candidate_label="A",
            consent=Consent(attested_by="r", attested_at=datetime.now(timezone.utc)),
        )
    )
    deps = Deps(store=store, transcriber=JsonTranscriber(), analyst=HeuristicAnalyst())
    return TestClient(create_app(deps))


def test_a_question_and_a_canary_can_be_logged_and_read_back(client):
    client.post("/interviews/i1/questions", json={"id": "q4", "text": "Design a rate limiter."})
    client.post(
        "/interviews/i1/canaries",
        json={
            "canary_id": "CAN-001",
            "question_id": "q4",
            "expected_marker": "lighthouse",
            "gain_db": -24,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    log = client.get("/interviews/i1/session").json()

    assert [q["id"] for q in log["questions"]] == ["q4"]
    assert log["canaries"][0]["expected_marker"] == "lighthouse"
    assert log["canaries"][0]["response_contained_marker"] is None


def test_checking_a_canary_against_an_answer_records_the_result(client):
    client.post(
        "/interviews/i1/canaries",
        json={"canary_id": "CAN-001", "expected_marker": "lighthouse", "sent_at": datetime.now(timezone.utc).isoformat()},
    )

    result = client.post(
        "/interviews/i1/canaries/CAN-001/check",
        json={"answer_text": "So it acts like a lighthouse for the workers."},
    ).json()

    assert result["triggered"] is True
    log = client.get("/interviews/i1/session").json()
    assert log["canaries"][0]["response_contained_marker"] is True
    assert log["canaries"][0]["matched_text"] == "lighthouse"


def test_a_visual_canary_records_its_channel_platform_and_opacity(client):
    client.post(
        "/interviews/i1/canaries",
        json={
            "canary_id": "CAN-002",
            "expected_marker": "orchard",
            "channel": "visual",
            "delivery_method": "zoom-camera-overlay",
            "platform": "zoom",
            "overlay_opacity": 0.35,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    event = client.get("/interviews/i1/session").json()["canaries"][0]

    assert event["channel"] == "visual"
    assert event["platform"] == "zoom"
    assert event["overlay_opacity"] == 0.35
    assert event["gain_db"] is None
    # Older events without the field default to audio, so existing Daily-room logs still load.
    assert client.post(
        "/interviews/i1/canaries",
        json={"canary_id": "CAN-001", "expected_marker": "lighthouse", "sent_at": datetime.now(timezone.utc).isoformat()},
    ).json()["canaries"][-1]["channel"] == "audio"

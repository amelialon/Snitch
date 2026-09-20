"""Behaviour of the HTTP API, exercised the way the web app uses it."""

import json

import pytest
from builders import InterviewBuilder, natural, polished
from fastapi.testclient import TestClient

from interview_review.adapters.heuristic_analyst import HeuristicAnalyst
from interview_review.adapters.json_transcriber import JsonTranscriber
from interview_review.adapters.local_store import LocalStore
from interview_review.api import create_app
from interview_review.models import AiTextRaw
from interview_review.ports import Deps


class MarkerDetector:
    name = "marker"

    def analyze(self, text: str) -> AiTextRaw:
        score = 0.97 if text.startswith(polished(25)) else 0.05
        return AiTextRaw(overall_class="ai" if score >= 0.8 else "human", overall_score=score, sentences=[])


def transcript_json() -> bytes:
    b = InterviewBuilder()
    for question in ["How are you today?", "How was your weekend?", "Any trouble joining the call?", "How's your week going?"]:
        b.ask(natural(40), question=question, latency=0.7)
    b.ask(natural(80), question="What is a race condition?", latency=1.0)
    b.ask(polished(30) + " " + natural(60), question="What is the difference between a process and a thread?", latency=7.0)
    b.ask(natural(80), question="What is an index in a database?", latency=0.9)
    return b.build()[0].model_dump_json().encode()


@pytest.fixture
def client(tmp_path):
    deps = Deps(
        store=LocalStore(tmp_path),
        transcriber=JsonTranscriber(),
        analyst=HeuristicAnalyst(),
        detector=MarkerDetector(),
    )
    return TestClient(create_app(deps))


def submit(client, **overrides):
    data = {"candidate_label": "Candidate A", "consent_attested": "true", "attested_by": "recruiter@example.com"}
    data.update(overrides)
    files = {"recording": ("interview.json", transcript_json(), "application/json")}
    return client.post("/interviews", data=data, files=files)


def test_an_upload_without_attested_consent_is_refused(client):
    response = submit(client, consent_attested="false")

    assert response.status_code == 400
    assert "consent" in response.json()["detail"].lower()
    assert client.get("/interviews").json() == []


def test_a_submitted_interview_becomes_a_reviewable_report(client):
    created = submit(client).json()

    body = client.get(f"/interviews/{created['id']}").json()

    assert body["interview"]["status"] == "ready"
    assert [f["unit_id"] for f in body["report"]["flags"]] == ["u6"]
    assert client.get(f"/interviews/{created['id']}/transcript").json()["words"]
    assert [i["id"] for i in client.get("/interviews").json()] == [created["id"]]


def test_the_api_never_exposes_a_score_or_verdict(client):
    created = submit(client).json()

    text = json.dumps(client.get(f"/interviews/{created['id']}").json()).lower()

    for forbidden in ('"score"', '"verdict"', '"cheating', '"recommendation"'):
        assert forbidden not in text


def test_reviewer_feedback_on_a_flag_is_kept(client):
    created = submit(client).json()
    url = f"/interviews/{created['id']}/flags/flag-u6/feedback"

    assert client.post(url, json={"useful": False, "reason": "connection dropped here"}).status_code == 200

    feedback = client.get(f"/interviews/{created['id']}").json()["interview"]["feedback"]
    assert feedback["flag-u6"]["useful"] is False
    assert feedback["flag-u6"]["reason"] == "connection dropped here"
    assert client.post(f"/interviews/{created['id']}/flags/nope/feedback", json={"useful": True}).status_code == 404


def test_context_flags_change_the_review(client):
    created = submit(client, context_flags=json.dumps({"notes_permitted": True})).json()

    report = client.get(f"/interviews/{created['id']}").json()["report"]

    assert "delivery" in {s["signal"] for s in report["skipped"]}


def test_the_recording_can_be_fetched_for_playback(client):
    created = submit(client).json()

    response = client.get(f"/interviews/{created['id']}/media")

    assert response.status_code == 200
    assert response.content == transcript_json()


def test_deleting_an_interview_removes_it_and_its_files(client):
    created = submit(client).json()

    assert client.delete(f"/interviews/{created['id']}").status_code == 204

    assert client.get(f"/interviews/{created['id']}").status_code == 404
    assert client.get(f"/interviews/{created['id']}/media").status_code == 404
    assert client.get("/interviews").json() == []


def test_unsupported_recording_types_are_refused(client):
    response = client.post(
        "/interviews",
        data={"candidate_label": "X", "consent_attested": "true", "attested_by": "r"},
        files={"recording": ("malware.exe", b"x", "application/octet-stream")},
    )

    assert response.status_code == 400


def test_the_same_recording_uploaded_again_reuses_the_earlier_review(tmp_path):
    class CountingTranscriber(JsonTranscriber):
        calls = 0

        def transcribe(self, path):
            CountingTranscriber.calls += 1
            return super().transcribe(path)

    deps = Deps(store=LocalStore(tmp_path), transcriber=CountingTranscriber(), analyst=HeuristicAnalyst(), detector=MarkerDetector())
    client = TestClient(create_app(deps))
    data = {"candidate_label": "Candidate A", "consent_attested": "true", "attested_by": "recruiter@example.com"}
    first = client.post("/interviews", data=data, files={"recording": ("take-1.json", transcript_json(), "application/json")}).json()

    second = client.post("/interviews", data=data, files={"recording": ("renamed copy.json", transcript_json(), "application/json")}).json()

    assert CountingTranscriber.calls == 1
    assert second["status"] == "ready" and second["id"] != first["id"]
    assert client.get(f"/interviews/{second['id']}").json()["report"] == client.get(f"/interviews/{first['id']}").json()["report"]
    assert client.get(f"/interviews/{second['id']}/transcript").json()["words"]
    assert client.get(f"/interviews/{second['id']}/media").content == transcript_json()  # the recording came along too


def test_a_different_recording_is_not_served_from_the_cache(client):
    submit(client)
    other = InterviewBuilder()
    other.ask(natural(80), question="Tell me about yourself.")
    files = {"recording": ("interview.json", other.build()[0].model_dump_json().encode(), "application/json")}
    data = {"candidate_label": "Candidate B", "consent_attested": "true", "attested_by": "recruiter@example.com"}

    created = client.post("/interviews", data=data, files=files).json()

    assert client.get(f"/interviews/{created['id']}").json()["report"]["flags"] == []


def test_a_failed_file_store_leaves_no_half_created_interview(tmp_path):
    class FailingStore(LocalStore):
        def put_file(self, interview_id, name, src):
            raise TimeoutError("write operation timed out")

    deps = Deps(store=FailingStore(tmp_path), transcriber=JsonTranscriber(), analyst=HeuristicAnalyst())
    client = TestClient(create_app(deps))

    response = submit(client)

    assert response.status_code == 502
    assert "try again" in response.json()["detail"]
    assert client.get("/interviews").json() == []

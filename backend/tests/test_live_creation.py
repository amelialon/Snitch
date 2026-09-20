import pytest
from fastapi.testclient import TestClient

from interview_review.adapters.heuristic_analyst import HeuristicAnalyst
from interview_review.adapters.json_transcriber import JsonTranscriber
from interview_review.adapters.local_store import LocalStore
from interview_review.api import create_app
from interview_review.canary import HIDDEN_PROMPT
from interview_review.ports import Deps


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(Deps(store=LocalStore(tmp_path), transcriber=JsonTranscriber(), analyst=HeuristicAnalyst())))


def create(client):
    response = client.post('/live-interviews', json={'candidate_label': 'Synthetic demo', 'attested_by': 'tester', 'consent_attested': True})
    assert response.status_code == 201
    return response.json()['id']


def test_live_creation_requires_consent_and_has_no_recording(client):
    assert client.post('/live-interviews', json={'candidate_label': 'Demo', 'attested_by': 'tester'}).status_code == 400
    interview = create(client)
    assert client.get(f'/interviews/{interview}').json()['interview']['stage'] == 'live'
    assert client.get(f'/interviews/{interview}/media').status_code == 404
    assert client.post(f'/interviews/{interview}/rerun').status_code == 400


def test_a_live_room_records_the_hidden_prompt_its_candidate_page_shows(client):
    interview = create(client)

    assert client.get(f'/interviews/{interview}').json()['interview']['hidden_prompt'] == HIDDEN_PROMPT

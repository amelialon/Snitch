from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from interview_review.adapters.heuristic_analyst import HeuristicAnalyst
from interview_review.adapters.json_transcriber import JsonTranscriber
from interview_review.adapters.local_store import LocalStore
from interview_review.api import create_app
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


def test_screen_share_persists_identity_and_checks_whole_identifier(client):
    interview = create(client)
    share = uuid4()
    started = datetime.now(timezone.utc)
    body = {'sharing_session_id': str(share), 'expected_marker': f'workingTotal_{share.hex[:10]}', 'started_at': started.isoformat(), 'opacity': .35, 'contrast': 80}
    path = f'/interviews/{interview}/screen-shares/{share}'
    assert client.put(path, json=body).status_code == 200
    assert client.put(path, json=body).status_code == 200
    assert client.get(path).json()['expected_marker'] == body['expected_marker']
    assert client.post(path + '/check', json={'answer_text': f"const {body['expected_marker']} = 0"}).json()['triggered']
    assert not client.post(path + '/check', json={'answer_text': body['expected_marker'] + 'Other'}).json()['triggered']
    assert client.put(path, json=body | {'opacity': .5}).status_code == 409
    assert client.put(path, json=body | {'finished_at': (started - timedelta(seconds=1)).isoformat()}).status_code == 400
    ended = body | {'finished_at': (started + timedelta(seconds=5)).isoformat()}
    assert client.put(path, json=ended).status_code == 200
    assert client.put(path, json=ended).status_code == 200
    assert client.put(path, json=body).status_code == 409


def test_screen_share_rejects_mismatches_and_invalid_settings(client):
    interview = create(client)
    share = uuid4()
    body = {'sharing_session_id': str(share), 'expected_marker': f'workingTotal_{share.hex[:10]}', 'started_at': datetime.now(timezone.utc).isoformat(), 'opacity': .35, 'contrast': 80}
    path = f'/interviews/{interview}/screen-shares/{share}'
    assert client.put(path, json=body | {'sharing_session_id': str(uuid4())}).status_code == 400
    assert client.put(path, json=body | {'opacity': 0}).status_code == 422
    assert client.put(path, json=body | {'started_at': '2026-09-19T12:00:00'}).status_code == 422
    assert client.get(path).status_code == 404
    assert client.put(f'/interviews/missing/screen-shares/{share}', json=body).status_code == 404

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from interview_review.adapters.heuristic_analyst import HeuristicAnalyst
from interview_review.adapters.local_store import LocalStore
from interview_review.api import create_app
from interview_review.models import Transcript
from interview_review.ports import Deps
from test_api import transcript_json


class SyntheticTranscriber:
    name = 'synthetic-test'
    calls = 0

    def transcribe(self, path):
        self.calls += 1
        assert path.read_bytes().startswith(b'\x1a\x45\xdf\xa3')
        return Transcript.model_validate_json(transcript_json())


@pytest.fixture
def fixture(tmp_path):
    transcriber = SyntheticTranscriber()
    client = TestClient(create_app(Deps(store=LocalStore(tmp_path), transcriber=transcriber, analyst=HeuristicAnalyst())))
    room = client.post('/live-interviews', json={'candidate_label': 'Synthetic call', 'attested_by': 'test', 'consent_attested': True}).json()['id']
    return client, room, transcriber


def upload(client, room, recording_id=None, data=b'\x1a\x45\xdf\xa3synthetic test container', consent=True):
    return client.post(f'/live-interviews/{room}/recording', data={'recording_id': str(recording_id or uuid4()), 'consent_attested': str(consent).lower()}, files={'recording': ('interview.webm', data, 'video/webm')})


def test_recording_becomes_a_playable_review_and_retry_is_idempotent(fixture):
    client, room, transcriber = fixture
    recording_id = uuid4()
    result = upload(client, room, recording_id)
    assert result.status_code == 202
    assert result.json()['review_id'] == room
    review = client.get(f'/interviews/{room}').json()
    assert review['interview']['status'] == 'ready'
    assert review['report'] is not None
    assert client.get(f'/interviews/{room}/media').content.startswith(b'\x1a\x45\xdf\xa3')
    assert upload(client, room, recording_id).json() == result.json()
    assert transcriber.calls == 1


def test_another_recording_preserves_the_previous_review(fixture):
    client, room, transcriber = fixture
    assert upload(client, room).status_code == 202
    original = client.get(f'/interviews/{room}').json()['interview']['files']['recording']
    next_review = upload(client, room).json()['review_id']
    assert next_review != room
    assert client.get(f'/interviews/{room}').json()['interview']['files']['recording'] == original
    assert client.get(f'/interviews/{next_review}').json()['interview']['status'] == 'ready'
    assert transcriber.calls == 2


def test_recording_requires_consent_nonempty_video_and_existing_room(fixture):
    client, room, transcriber = fixture
    assert upload(client, room, consent=False).status_code == 400
    assert upload(client, room, data=b'').status_code == 400
    assert upload(client, room, data=b'not video').status_code == 400
    assert upload(client, 'missing').status_code == 404
    assert transcriber.calls == 0


def test_two_participant_signaling_and_disconnect(fixture):
    client, room, _ = fixture
    with client.websocket_connect(f'/live-interviews/{room}/signal?role=host') as host:
        assert host.receive_json()['type'] == 'joined'
        with client.websocket_connect(f'/live-interviews/{room}/signal?role=candidate') as candidate:
            assert candidate.receive_json()['type'] == 'joined'
            assert host.receive_json()['type'] == 'peer-ready'
            assert candidate.receive_json()['type'] == 'peer-ready'
            host.send_json({'type': 'offer', 'description': {'sdp': 'test offer'}})
            assert candidate.receive_json()['description']['sdp'] == 'test offer'
            candidate.send_json({'type': 'answer', 'description': {'sdp': 'test answer'}})
            assert host.receive_json()['description']['sdp'] == 'test answer'
            candidate.send_json({'type': 'screen-state', 'active': True})
            assert host.receive_json()['active'] is True
            with client.websocket_connect(f'/live-interviews/{room}/signal?role=host') as duplicate:
                assert duplicate.receive_json()['type'] == 'error'
        assert host.receive_json()['type'] == 'peer-left'


def test_unknown_room_and_role_rejected(fixture):
    client, room, _ = fixture
    for url in ['/live-interviews/missing/signal', f'/live-interviews/{room}/signal?role=invalid']:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(url):
                pass

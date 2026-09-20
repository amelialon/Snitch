"""In-app two-person signaling and recording-to-review handoff (single API worker)."""

import asyncio
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .models import Consent, Interview
from .pipeline import run_pipeline
from .ports import Deps, load_model, save_model


class RecordingReceipt(BaseModel):
    review_id: str


_DOCUMENT_TYPES = {'.pdf', '.txt', '.md'}


def add_live_routes(app: FastAPI, deps: Deps) -> None:
    rooms: dict[str, dict[str, WebSocket]] = {}
    finalize_lock = threading.Lock()
    store = deps.store

    @app.get('/live-config')
    def config() -> dict:
        # Optional TURN servers for deployments across restrictive networks. No vendor account
        # or room setup is needed to use the app; local peers can connect without STUN/TURN.
        return {'iceServers': json.loads(os.environ.get('WEBRTC_ICE_SERVERS', '[]'))}

    @app.websocket('/live-interviews/{interview_id}/signal')
    async def signal(socket: WebSocket, interview_id: str, role: str = 'candidate') -> None:
        if role not in {'host', 'candidate'}:
            await socket.close(code=1008)
            return
        try:
            interview = await asyncio.to_thread(store.get_interview, interview_id)
        except ValueError:
            interview = None
        if interview is None:
            await socket.close(code=1008)
            return
        await socket.accept()
        room = rooms.setdefault(interview_id, {})
        if role in room:
            await socket.send_json({'type': 'error', 'message': 'This participant is already connected in another tab.'})
            await socket.close(code=1008)
            return
        room[role] = socket
        other_role = 'candidate' if role == 'host' else 'host'
        try:
            await socket.send_json({'type': 'joined'})
            if other_role in room:
                for peer in list(room.values()):
                    await peer.send_json({'type': 'peer-ready'})
            while True:
                message = await socket.receive_json()
                if not isinstance(message, dict) or len(json.dumps(message)) > 100_000:
                    await socket.close(code=1008)
                    break
                if message.get('type') not in {'offer', 'answer', 'ice', 'screen-state', 'end'}:
                    continue
                if message.get('type') == 'offer' and role != 'host':
                    continue
                peer = room.get(other_role)
                if peer:
                    await peer.send_json(message)
                if message.get('type') == 'end':
                    break
        except (WebSocketDisconnect, RuntimeError, ValueError):
            pass
        finally:
            if room.get(role) is socket:
                room.pop(role, None)
            peer = room.get(other_role)
            if peer:
                try:
                    await peer.send_json({'type': 'peer-left'})
                except (RuntimeError, WebSocketDisconnect):
                    pass
            if not room:
                rooms.pop(interview_id, None)
            try:
                await socket.close()
            except RuntimeError:
                pass

    @app.post('/live-interviews/{interview_id}/recording', status_code=202)
    def finish_recording(
        interview_id: str,
        background: BackgroundTasks,
        recording_id: UUID = Form(...),
        consent_attested: bool = Form(False),
        recording: UploadFile = File(...),
        # The New review form, filled in after the call: documents, conditions and who attests.
        attested_by: str = Form(''),
        context_flags: str = Form('{}'),
        cv: UploadFile | None = File(None),
        cover_letter: UploadFile | None = File(None),
    ) -> dict:
        if not consent_attested:
            raise HTTPException(400, 'Consent to recording and automated review is required.')
        try:
            flags = {str(k): bool(v) for k, v in json.loads(context_flags).items()}
        except (ValueError, AttributeError):
            raise HTTPException(400, 'context_flags must be a JSON object of booleans')
        documents: dict[str, UploadFile] = {}
        for role, upload in (('cv', cv), ('cover_letter', cover_letter)):
            if upload is not None and upload.filename:
                doc_suffix = Path(upload.filename).suffix.lower()
                if doc_suffix not in _DOCUMENT_TYPES:
                    raise HTTPException(400, f"Unsupported {role.replace('_', ' ')} type '{doc_suffix}'. Use PDF or plain text.")
                documents[role] = upload
        try:
            original = store.get_interview(interview_id)
        except ValueError:
            original = None
        if original is None:
            raise HTTPException(404, 'No such interview')
        suffix = Path(recording.filename or '').suffix.lower()
        if suffix not in {'.webm', '.mp4'}:
            raise HTTPException(400, 'Live recordings must be WebM or MP4 video.')
        signature = recording.file.read(12)
        recording.file.seek(0)
        if not ((suffix == '.webm' and signature.startswith(b'\x1a\x45\xdf\xa3')) or
                (suffix == '.mp4' and signature[4:8] == b'ftyp')):
            raise HTTPException(400, 'The recording is empty or is not a valid video container.')
        receipt_name = f'recording-receipt-{recording_id}.json'
        # Serializes retries within this demo's single API worker. A retry must never submit
        # another paid pipeline job or overwrite an existing review's recording.
        with finalize_lock:
            receipt = load_model(store, interview_id, receipt_name, RecordingReceipt)
            if receipt:
                return {'review_id': receipt.review_id}
            original = store.get_interview(interview_id)
            if original is None:
                raise HTTPException(404, 'No such interview')
            review_id = interview_id if not original.files.get('recording') else uuid4().hex[:12]
            name = f'recording-{recording_id}{suffix}'
            store.put_file(review_id, name, recording.file)
            extra_files = {}
            for role, upload in documents.items():
                extra_files[role] = f'{role}{Path(upload.filename or "").suffix.lower()}'
                store.put_file(review_id, extra_files[role], upload.file)
            consent = original.consent
            if attested_by.strip():
                consent = Consent(attested_by=attested_by.strip(), attested_at=datetime.now(timezone.utc),
                                  text_version=original.consent.text_version)
            if review_id == interview_id:
                store.update_interview(review_id, {
                    'files': original.files | {'recording': name} | extra_files, 'stage': 'queued',
                    'status': 'processing', 'progress': 0.0, 'error': None,
                    'context_flags': flags, 'consent': consent,
                })
            else:
                review = Interview(
                    id=review_id, candidate_label=original.candidate_label,
                    consent=consent, context_flags=flags, hidden_prompt=original.hidden_prompt,
                    files={'recording': name} | extra_files,
                )
                # Preserve optional CV/cover letter without reusing an old transcript/report.
                for role in ('cv', 'cover_letter'):
                    if role in original.files and role not in extra_files:
                        filename = original.files[role]
                        with store.local_path(interview_id, filename) as path, path.open('rb') as src:
                            store.put_file(review_id, filename, src)
                        review.files[role] = filename
                store.create_interview(review)
            save_model(store, interview_id, receipt_name, RecordingReceipt(review_id=review_id))
            background.add_task(run_pipeline, review_id, deps)
        return {'review_id': review_id}

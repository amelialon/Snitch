"""Store adapter on Firebase: Firestore `interviews/{id}` + Cloud Storage `interviews/{id}/*`.

Uses the Admin SDK, which bypasses security rules; the rules themselves deny all client access
(firebase/*.rules). Install with: pip install "interview-review[firebase]".
"""

from __future__ import annotations

import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, BinaryIO, Iterator

from pydantic_core import to_jsonable_python

from ..models import Interview


class FirebaseStore:
    name = "firebase"

    def __init__(self, credentials_path: str, bucket: str) -> None:
        import firebase_admin
        from firebase_admin import credentials, firestore, storage

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(credentials_path), {"storageBucket": bucket})
        self._docs = firestore.client().collection("interviews")
        self._bucket = storage.bucket()

    def _blob(self, interview_id: str, name: str):
        return self._bucket.blob(f"interviews/{interview_id}/{name}")

    def create_interview(self, interview: Interview) -> None:
        self._docs.document(interview.id).set(interview.model_dump(mode="json"))

    def get_interview(self, interview_id: str) -> Interview | None:
        snapshot = self._docs.document(interview_id).get()
        return Interview.model_validate(snapshot.to_dict()) if snapshot.exists else None

    def list_interviews(self) -> list[Interview]:
        found = [Interview.model_validate(s.to_dict()) for s in self._docs.stream()]
        return sorted(found, key=lambda i: i.created_at, reverse=True)

    def update_interview(self, interview_id: str, fields: dict[str, Any]) -> None:
        fields = fields | {"updated_at": datetime.now(timezone.utc)}
        self._docs.document(interview_id).update(to_jsonable_python(fields))

    def delete_interview(self, interview_id: str) -> None:
        for blob in self._bucket.list_blobs(prefix=f"interviews/{interview_id}/"):
            blob.delete()
        self._docs.document(interview_id).delete()

    def put_file(self, interview_id: str, name: str, src: BinaryIO) -> None:
        # Recordings are large and venue networks are slow: small resumable chunks, patient timeout.
        blob = self._blob(interview_id, name)
        blob.chunk_size = 8 * 1024 * 1024
        blob.upload_from_file(src, timeout=600)

    def has_file(self, interview_id: str, name: str) -> bool:
        return self._blob(interview_id, name).exists()

    @contextmanager
    def local_path(self, interview_id: str, name: str) -> Iterator[Path]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / Path(name).name
            self._blob(interview_id, name).download_to_filename(str(path))
            yield path

    def public_url(self, interview_id: str, name: str) -> str | None:
        return self._blob(interview_id, name).generate_signed_url(expiration=timedelta(hours=1), version="v4")

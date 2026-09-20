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

# Without an explicit chunk size the library sends recordings as 100 MiB resumable chunks, one HTTP
# write each, which times out on an ordinary uplink. Small chunks each get their own timeout and retry.
_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024  # must be a multiple of 256 KiB
_UPLOAD_TIMEOUT_SEC = 300
# Downloads likewise: chunked, so a dropped connection costs one chunk, with a retry budget that
# outlasts a 127 MB recording on a slow venue network instead of the library's 120 s default.
_DOWNLOAD_RETRY_DEADLINE_SEC = 1800


class FirebaseStore:
    name = "firebase"

    def __init__(self, credentials_path: str, bucket: str) -> None:
        import firebase_admin
        from firebase_admin import credentials, firestore, storage

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(credentials_path), {"storageBucket": bucket})
        self._docs = firestore.client().collection("interviews")
        self._bucket = storage.bucket()
        from google.cloud.storage.retry import DEFAULT_RETRY

        self._download_retry = DEFAULT_RETRY.with_deadline(_DOWNLOAD_RETRY_DEADLINE_SEC)

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
        blob = self._blob(interview_id, name)
        blob.chunk_size = _UPLOAD_CHUNK_BYTES
        blob.upload_from_file(src, timeout=_UPLOAD_TIMEOUT_SEC)

    def has_file(self, interview_id: str, name: str) -> bool:
        return self._blob(interview_id, name).exists()

    def copy_file(self, src_id: str, dst_id: str, name: str) -> None:
        self._bucket.copy_blob(self._blob(src_id, name), self._bucket, f"interviews/{dst_id}/{name}")

    @contextmanager
    def local_path(self, interview_id: str, name: str) -> Iterator[Path]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / Path(name).name
            blob = self._blob(interview_id, name)
            blob.chunk_size = _UPLOAD_CHUNK_BYTES
            blob.download_to_filename(str(path), timeout=_UPLOAD_TIMEOUT_SEC, retry=self._download_retry)
            yield path

    def public_url(self, interview_id: str, name: str) -> str | None:
        return self._blob(interview_id, name).generate_signed_url(expiration=timedelta(hours=1), version="v4")

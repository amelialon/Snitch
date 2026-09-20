"""Store adapter on local disk: data/{id}/interview.json + data/{id}/files/*. Dev, tests, CLI."""

from __future__ import annotations

import shutil
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Iterator

from ..models import Interview


class LocalStore:
    name = "local"

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _record(self, interview_id: str) -> Path:
        return self._dir(interview_id) / "interview.json"

    def _dir(self, interview_id: str) -> Path:
        return self.root / _safe(interview_id)

    def _file(self, interview_id: str, name: str) -> Path:
        return self._dir(interview_id) / "files" / _safe(name)

    def create_interview(self, interview: Interview) -> None:
        with self._lock:
            self._dir(interview.id).mkdir(parents=True, exist_ok=True)
            self._record(interview.id).write_text(interview.model_dump_json(indent=2))

    def get_interview(self, interview_id: str) -> Interview | None:
        path = self._record(interview_id)
        return Interview.model_validate_json(path.read_text()) if path.exists() else None

    def list_interviews(self) -> list[Interview]:
        found = [Interview.model_validate_json(p.read_text()) for p in self.root.glob("*/interview.json")]
        return sorted(found, key=lambda i: i.created_at, reverse=True)

    def update_interview(self, interview_id: str, fields: dict[str, Any]) -> None:
        with self._lock:
            current = self.get_interview(interview_id)
            if current is None:
                raise KeyError(interview_id)
            merged = current.model_dump() | fields | {"updated_at": datetime.now(timezone.utc)}
            self._record(interview_id).write_text(Interview.model_validate(merged).model_dump_json(indent=2))

    def delete_interview(self, interview_id: str) -> None:
        with self._lock:
            shutil.rmtree(self._dir(interview_id), ignore_errors=True)

    def put_file(self, interview_id: str, name: str, src: BinaryIO) -> None:
        path = self._file(interview_id, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as dst:
            shutil.copyfileobj(src, dst)

    def has_file(self, interview_id: str, name: str) -> bool:
        return self._file(interview_id, name).exists()

    def copy_file(self, src_id: str, dst_id: str, name: str) -> None:
        dst = self._file(dst_id, name)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self._file(src_id, name), dst)

    @contextmanager
    def local_path(self, interview_id: str, name: str) -> Iterator[Path]:
        path = self._file(interview_id, name)
        if not path.exists():
            raise FileNotFoundError(name)
        yield path

    def public_url(self, interview_id: str, name: str) -> str | None:
        return None


def _safe(part: str) -> str:
    """Ids and file names come from requests; never let them escape the store root."""
    if not part or part in {".", ".."} or "/" in part or "\\" in part or "\x00" in part:
        raise ValueError(f"unsafe path component: {part!r}")
    return part

"""Transcriber adapter for AssemblyAI. Disfluencies stay ON: fillers are signal, not noise."""

from __future__ import annotations

import time
from pathlib import Path

import httpx

from ..models import Transcript, Word

_BASE = "https://api.assemblyai.com/v2"


class AssemblyAITranscriber:
    name = "assemblyai"

    def __init__(self, api_key: str, *, poll_seconds: float = 3.0, timeout_seconds: float = 3600.0) -> None:
        self._headers = {"authorization": api_key}
        self._poll = poll_seconds
        self._timeout = timeout_seconds

    def transcribe(self, path: Path) -> Transcript:
        with httpx.Client(headers=self._headers, timeout=httpx.Timeout(60.0, write=None, read=300.0)) as http:
            with path.open("rb") as media:
                upload = http.post(f"{_BASE}/upload", content=media)
            upload.raise_for_status()

            job = http.post(
                f"{_BASE}/transcript",
                json={"audio_url": upload.json()["upload_url"], "speaker_labels": True, "disfluencies": True},
            )
            job.raise_for_status()
            job_id = job.json()["id"]

            deadline = time.monotonic() + self._timeout
            while True:
                status = http.get(f"{_BASE}/transcript/{job_id}")
                status.raise_for_status()
                body = status.json()
                if body["status"] == "completed":
                    return _to_transcript(body)
                if body["status"] == "error":
                    raise RuntimeError(f"transcription failed: {body.get('error', 'unknown error')}")
                if time.monotonic() > deadline:
                    raise TimeoutError("transcription did not finish in time")
                time.sleep(self._poll)


def _to_transcript(body: dict) -> Transcript:
    words: list[Word] = []
    speaker = "A"
    for w in body.get("words") or []:
        speaker = w.get("speaker") or speaker  # unlabeled words continue the current speaker
        words.append(
            Word(
                text=w["text"],
                start=w["start"] / 1000.0,
                end=w["end"] / 1000.0,
                speaker=speaker,
                confidence=w.get("confidence", 1.0),
            )
        )
    if not words:
        raise RuntimeError("the recording contains no recognizable speech")
    return Transcript(words=words, duration=float(body.get("audio_duration") or words[-1].end))

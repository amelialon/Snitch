"""Transcriber adapter for a transcript that already exists as JSON. Offline demo and tests."""

from __future__ import annotations

from pathlib import Path

from ..models import Transcript
from ..ports import Unavailable


class JsonTranscriber:
    name = "json-transcript"

    def transcribe(self, path: Path) -> Transcript:
        if path.suffix.lower() != ".json":
            raise Unavailable(
                "No speech-to-text service is configured (set ASSEMBLYAI_API_KEY). "
                "Without one, upload a transcript .json instead of a recording."
            )
        return Transcript.model_validate_json(path.read_text())

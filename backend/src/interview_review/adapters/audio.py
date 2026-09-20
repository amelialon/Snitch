"""Shrinks a recording to speech-quality MP3 for transcription.

The full recording stays in storage; only the copy sent to the speech-to-text vendor is converted, which
turns a multi-hundred-MB video into a few MB. Needs the `ffmpeg` binary; without it (or if it fails) the
original file is used, so transcription still works, just with a bigger upload.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)

_CONVERT_TIMEOUT_SEC = 1800


def mp3_for_transcription(src: Path, workdir: Path) -> Path:
    """Return a path to send for transcription: a mono 16 kHz MP3 made in `workdir`, or `src` itself when it
    is already an MP3 or cannot be converted."""
    if src.suffix.lower() == ".mp3":
        return src
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        log.warning("ffmpeg is not installed; sending %s to transcription unconverted", src.name)
        return src

    out = workdir / "transcription.mp3"
    command = [
        ffmpeg, "-nostdin", "-y", "-loglevel", "error",
        "-i", str(src),
        "-vn",
        # Pad a late-starting audio track with silence: transcript timestamps are used to seek the original
        # video, so the MP3 must share its timeline (a plain conversion would drop the start offset).
        "-af", "aresample=async=1:first_pts=0",
        "-ac", "1", "-ar", "16000", "-b:a", "64k",
        str(out),
    ]  # fmt: skip
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=_CONVERT_TIMEOUT_SEC)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        detail = exc.stderr.decode(errors="replace").strip()[-300:] if isinstance(exc, subprocess.CalledProcessError) else exc
        log.warning("could not convert %s to mp3 (%s); sending it unconverted", src.name, detail)
        return src
    return out if out.exists() and out.stat().st_size > 0 else src

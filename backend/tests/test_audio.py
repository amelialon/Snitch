"""The copy of a recording sent for transcription is a small MP3; the stored recording is never touched."""

import json
import shutil
import subprocess

import pytest

from interview_review.adapters import audio
from interview_review.adapters.assemblyai import AssemblyAITranscriber
from interview_review.adapters.audio import mp3_for_transcription

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")


def make_video(path, *, audio_delay=0.0, seconds=6):
    subprocess.run(
        [
            "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15",
            "-itsoffset", str(audio_delay), "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
            "-t", str(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path),
        ],
        check=True,
    )  # fmt: skip
    return path


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    )  # fmt: skip
    return json.loads(out.stdout)


@needs_ffmpeg
def test_a_video_becomes_a_smaller_audio_only_mp3(tmp_path):
    video = make_video(tmp_path / "interview.mp4")

    result = mp3_for_transcription(video, tmp_path)

    assert result.suffix == ".mp3"
    info = probe(result)
    assert [s["codec_type"] for s in info["streams"]] == ["audio"]
    assert info["streams"][0]["codec_name"] == "mp3"
    assert result.stat().st_size < video.stat().st_size
    assert video.exists()  # the stored recording is left alone


@needs_ffmpeg
def test_a_late_starting_audio_track_keeps_its_place_on_the_video_timeline(tmp_path):
    video = make_video(tmp_path / "late.mp4", audio_delay=1.0, seconds=6)

    result = mp3_for_transcription(video, tmp_path)

    # Without padding the leading second is dropped and every transcript timestamp drifts early.
    assert float(probe(result)["format"]["duration"]) == pytest.approx(6.0, abs=0.15)


def test_an_mp3_is_sent_as_it_is(tmp_path):
    mp3 = tmp_path / "already.mp3"
    mp3.write_bytes(b"not really audio")

    assert mp3_for_transcription(mp3, tmp_path) == mp3


def test_without_ffmpeg_the_original_is_used(tmp_path, monkeypatch):
    monkeypatch.setattr(audio.shutil, "which", lambda _name: None)
    video = tmp_path / "interview.mp4"
    video.write_bytes(b"video bytes")

    assert mp3_for_transcription(video, tmp_path) == video


@needs_ffmpeg
def test_a_file_ffmpeg_cannot_read_falls_back_to_the_original(tmp_path):
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"this is not a video")

    assert mp3_for_transcription(broken, tmp_path) == broken


@needs_ffmpeg
def test_the_transcriber_uploads_the_mp3_not_the_video(tmp_path, monkeypatch):
    video = make_video(tmp_path / "interview.mp4")
    seen = {}

    def fake_transcribe(self, path):
        seen["suffix"] = path.suffix
        seen["exists_during_call"] = path.exists()
        seen["smaller"] = path.stat().st_size < video.stat().st_size
        return "transcript"

    monkeypatch.setattr(AssemblyAITranscriber, "_transcribe", fake_transcribe)

    assert AssemblyAITranscriber("key").transcribe(video) == "transcript"
    assert seen == {"suffix": ".mp3", "exists_during_call": True, "smaller": True}

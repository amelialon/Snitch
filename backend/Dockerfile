# Backend image for a long-running host (Railway). The API and the pipeline's background jobs
# share this one process, so it must not be scaled to zero or beyond one worker (architecture.md §11).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# The transcriber extracts an MP3 from the recording before uploading it (adapters/audio.py).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src ./src
RUN pip install ".[firebase]"

# Recordings pass through here between Cloud Storage and the transcriber (tempfile in local_path).
ENV TMPDIR=/tmp
EXPOSE 8000

# Railway injects PORT; one worker keeps the in-memory signaling room registry consistent.
CMD ["sh", "-c", "uvicorn interview_review.api:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 75"]

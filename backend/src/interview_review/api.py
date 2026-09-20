"""HTTP API. The web app's only door into the system; it never touches storage or vendors directly."""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import AwareDatetime, BaseModel, Field

from .canary import HIDDEN_PROMPT, CanaryEvent, MarkerMatch, QuestionEvent, SessionLog, check_marker
from .models import Consent, Feedback, Interview, Report, Transcript
from .pipeline import PIPELINE_VERSION, run_pipeline
from .ports import Deps, load_model, save_model

_RECORDING_TYPES = {".mp4", ".webm", ".mov", ".mkv", ".m4v", ".mp3", ".wav", ".m4a", ".ogg", ".json"}
_DOCUMENT_TYPES = {".pdf", ".txt", ".md"}


def _sha256(src) -> str:
    digest = hashlib.sha256()
    src.seek(0)
    for chunk in iter(lambda: src.read(1 << 20), b""):
        digest.update(chunk)
    src.seek(0)
    return digest.hexdigest()


class FeedbackIn(BaseModel):
    useful: bool
    reason: str = ""


class CheckMarkerIn(BaseModel):
    answer_text: str


class LiveInterviewIn(BaseModel):
    candidate_label: str = Field(min_length=1, max_length=200)
    attested_by: str = Field(min_length=1, max_length=200)
    consent_attested: bool = False
    scheduled_for: AwareDatetime | None = None


def create_app(deps: Deps | None = None) -> FastAPI:
    if deps is None:
        from .wiring import build_deps

        deps = build_deps()
    store = deps.store

    app = FastAPI(title="Interview Integrity Review")
    from .live import add_live_routes
    add_live_routes(app, deps)
    app.add_middleware(
        CORSMiddleware,
        # Origins match exactly, so a pasted space or trailing slash would block the web app.
        allow_origins=[
            origin.strip().rstrip("/")
            for origin in os.environ.get("WEB_ORIGIN", "http://localhost:3000").split(",")
            if origin.strip()
        ],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def existing(interview_id: str) -> Interview:
        try:
            interview = store.get_interview(interview_id)
        except ValueError:
            interview = None
        if interview is None:
            raise HTTPException(404, "No such interview")
        return interview

    @app.get("/health")
    def health() -> dict:
        return {
            "ok": True,
            "adapters": {
                "store": store.name,
                "transcriber": deps.transcriber.name,
                "analyst": deps.analyst.name,
                "detector": deps.detector.name if deps.detector else "none",
                "cv_analyzer": deps.cv_analyzer.name if deps.cv_analyzer else "none",
                "hidden_prompt_judge": deps.hidden_prompt_judge.name if deps.hidden_prompt_judge else "none",
            },
        }

    @app.post("/interviews", status_code=201)
    def create_interview(
        background: BackgroundTasks,
        candidate_label: str = Form(...),
        consent_attested: bool = Form(False),
        attested_by: str = Form(""),
        context_flags: str = Form("{}"),
        recording: UploadFile = File(...),
        cv: UploadFile | None = File(None),
        cover_letter: UploadFile | None = File(None),
    ) -> Interview:
        if not consent_attested or not attested_by.strip():
            raise HTTPException(
                400, "Consent is required: confirm the candidate agreed to recording and automated analysis, and say who is attesting."
            )
        try:
            flags = {str(k): bool(v) for k, v in json.loads(context_flags).items()}
        except (ValueError, AttributeError):
            raise HTTPException(400, "context_flags must be a JSON object of booleans")

        uploads = {"recording": (recording, _RECORDING_TYPES)}
        if cv is not None and cv.filename:
            uploads["cv"] = (cv, _DOCUMENT_TYPES)
        if cover_letter is not None and cover_letter.filename:
            uploads["cover_letter"] = (cover_letter, _DOCUMENT_TYPES)

        names: dict[str, str] = {}
        for role, (upload, allowed) in uploads.items():
            suffix = Path(upload.filename or "").suffix.lower()
            if suffix not in allowed:
                raise HTTPException(400, f"Unsupported {role.replace('_', ' ')} type '{suffix}'. Allowed: {', '.join(sorted(allowed))}")
            names[role] = f"{role}{suffix}"  # stored under our name, never the uploaded one

        interview = Interview(
            id=uuid.uuid4().hex[:12],
            candidate_label=candidate_label.strip() or "Unnamed candidate",
            context_flags=flags,
            consent=Consent(attested_by=attested_by.strip(), attested_at=datetime.now(timezone.utc)),
            files=names,
            fingerprints={role: _sha256(upload.file) for role, (upload, _) in uploads.items()},
            stage="uploading to storage",  # can take minutes on a slow link; the pipeline sets the next stage
        )
        cached = _cached_source(interview)
        exact = cached is not None and cached.fingerprints == interview.fingerprints and cached.context_flags == interview.context_flags
        if exact:
            # A report from an older pipeline lacks newer checks (e.g. the hidden prompt): recompute it.
            old = load_model(store, cached.id, "report.json", Report)
            exact = old is not None and old.pipeline_version == PIPELINE_VERSION
        store.create_interview(interview)
        if exact:
            # Same recording, documents and flags as a finished review: nothing to upload or compute.
            # The files are copied inside the store, so this is fast even on a slow network.
            for name in list(cached.files.values()) + ["transcript.json", "segmentation.json", "report.json"]:
                store.copy_file(cached.id, interview.id, name)
            store.update_interview(
                interview.id,
                {"status": "ready", "stage": "done", "progress": 1.0, "summary": cached.summary, "files": cached.files},
            )
            return existing(interview.id)
        try:
            for role, (upload, _) in uploads.items():
                store.put_file(interview.id, names[role], upload.file)
        except Exception as exc:
            store.delete_interview(interview.id)  # no half-created record left in the list
            raise HTTPException(502, f"Could not store the upload, please try again ({type(exc).__name__}).") from exc
        if cached is not None:
            # Same recording with different documents or flags: reuse the transcript and segmentation
            # (the slow, expensive stages) and run the rest of the pipeline.
            for name in ("transcript.json", "segmentation.json"):
                if store.has_file(cached.id, name):
                    store.copy_file(cached.id, interview.id, name)

        background.add_task(run_pipeline, interview.id, deps)
        return interview

    def _cached_source(interview: Interview) -> Interview | None:
        """The newest ready interview with the same recording bytes; an exact full match wins."""
        same_recording = [
            i
            for i in store.list_interviews()
            if i.id != interview.id
            and i.status == "ready"
            and i.fingerprints.get("recording") == interview.fingerprints.get("recording")
        ]
        exact = [i for i in same_recording if i.fingerprints == interview.fingerprints and i.context_flags == interview.context_flags]
        return (exact or same_recording or [None])[0]

    @app.post("/live-interviews", status_code=201)
    def create_live_interview(body: LiveInterviewIn) -> Interview:
        if not body.consent_attested or not body.attested_by.strip() or not body.candidate_label.strip():
            raise HTTPException(400, "A candidate label and attestation of consent to recording and automated review are required.")
        interview = Interview(
            id=uuid.uuid4().hex[:12], candidate_label=body.candidate_label.strip(),
            stage="live", scheduled_for=body.scheduled_for,
            consent=Consent(attested_by=body.attested_by.strip(), attested_at=datetime.now(timezone.utc), text_version="live-recording-v1"),
            hidden_prompt=HIDDEN_PROMPT,  # the candidate's room always displays it
        )
        store.create_interview(interview)
        return interview

    @app.get("/interviews")
    def list_interviews() -> list[Interview]:
        return store.list_interviews()

    @app.get("/interviews/{interview_id}")
    def get_interview(interview_id: str) -> dict:
        interview = existing(interview_id)
        report = load_model(store, interview_id, "report.json", Report) if interview.status == "ready" else None
        return {"interview": interview, "report": report}

    @app.get("/interviews/{interview_id}/transcript")
    def get_transcript(interview_id: str) -> Transcript:
        existing(interview_id)
        transcript = load_model(store, interview_id, "transcript.json", Transcript)
        if transcript is None:
            raise HTTPException(404, "The transcript is not ready yet")
        return transcript

    @app.get("/interviews/{interview_id}/media")
    def get_media(interview_id: str):
        name = existing(interview_id).files.get("recording")
        if not name:
            raise HTTPException(404, "This live interview has no recording")
        url = store.public_url(interview_id, name)
        if url:
            return RedirectResponse(url)
        # A store without public URLs keeps files on local disk, so the path outlives the context.
        with store.local_path(interview_id, name) as path:
            return FileResponse(path)

    @app.post("/interviews/{interview_id}/rerun", status_code=202)
    def rerun(interview_id: str, background: BackgroundTasks, force: bool = False) -> dict:
        if not existing(interview_id).files.get("recording"):
            raise HTTPException(400, "Upload a recording before requesting analysis")
        store.update_interview(interview_id, {"status": "processing", "stage": "queued", "progress": 0.0})
        background.add_task(run_pipeline, interview_id, deps, force=force)
        return {"ok": True}

    @app.post("/interviews/{interview_id}/flags/{flag_id}/feedback")
    def give_feedback(interview_id: str, flag_id: str, body: FeedbackIn) -> dict:
        interview = existing(interview_id)
        report = load_model(store, interview_id, "report.json", Report)
        if report is None or flag_id not in {f.id for f in report.flags}:
            raise HTTPException(404, "No such flag")
        feedback = interview.feedback | {
            flag_id: Feedback(useful=body.useful, reason=body.reason.strip(), at=datetime.now(timezone.utc))
        }
        store.update_interview(interview_id, {"feedback": feedback})
        return {"ok": True}

    # --- live session: question and canary event logging (SPEC §6) --------------

    def session_log(interview_id: str) -> SessionLog:
        return load_model(store, interview_id, "session_log.json", SessionLog) or SessionLog()

    @app.get("/interviews/{interview_id}/session")
    def get_session(interview_id: str) -> SessionLog:
        existing(interview_id)
        return session_log(interview_id)

    @app.post("/interviews/{interview_id}/questions")
    def log_question(interview_id: str, event: QuestionEvent) -> SessionLog:
        existing(interview_id)
        log = session_log(interview_id)
        log.questions = [q for q in log.questions if q.id != event.id] + [event]
        save_model(store, interview_id, "session_log.json", log)
        return log

    @app.post("/interviews/{interview_id}/canaries")
    def log_canary(interview_id: str, event: CanaryEvent) -> SessionLog:
        existing(interview_id)
        log = session_log(interview_id)
        log.canaries.append(event)
        save_model(store, interview_id, "session_log.json", log)
        return log

    @app.post("/interviews/{interview_id}/canaries/{canary_id}/check")
    def check_canary(interview_id: str, canary_id: str, body: CheckMarkerIn) -> MarkerMatch:
        existing(interview_id)
        log = session_log(interview_id)
        event = next((c for c in reversed(log.canaries) if c.canary_id == canary_id), None)
        if event is None:
            raise HTTPException(404, "No such canary was sent in this interview")
        match = check_marker(body.answer_text, event.expected_marker)
        event.response_contained_marker = match.triggered
        event.matched_text = match.matched_text
        save_model(store, interview_id, "session_log.json", log)
        return match

    @app.delete("/interviews/{interview_id}", status_code=204)
    def delete_interview(interview_id: str) -> Response:
        existing(interview_id)
        store.delete_interview(interview_id)
        return Response(status_code=204)

    return app

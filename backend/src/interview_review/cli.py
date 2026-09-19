"""Command line: review a recording without the web app, or start the API."""

from __future__ import annotations

import argparse
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .models import Consent, Interview, Report
from .pipeline import run_pipeline
from .ports import load_model
from .wiring import build_deps


def main() -> None:
    parser = argparse.ArgumentParser(prog="interview-review")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="review one recording (or transcript .json) and print the result")
    run.add_argument("recording", type=Path)
    run.add_argument("--cv", type=Path)
    run.add_argument("--label", default="CLI candidate")
    run.add_argument("--consent-by", required=True, help="who attests the candidate consented to recording and analysis")

    serve = sub.add_parser("serve", help="start the API")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)

    args = parser.parse_args()
    if args.command == "serve":
        import uvicorn

        uvicorn.run("interview_review.api:create_app", factory=True, host=args.host, port=args.port)
        return

    deps = build_deps()
    files = {"recording": f"recording{args.recording.suffix.lower()}"}
    if args.cv:
        files["cv"] = f"cv{args.cv.suffix.lower()}"
    interview = Interview(
        id=uuid.uuid4().hex[:12],
        candidate_label=args.label,
        consent=Consent(attested_by=args.consent_by, attested_at=datetime.now(timezone.utc)),
        files=files,
    )
    deps.store.create_interview(interview)
    for role, source in (("recording", args.recording), ("cv", args.cv)):
        if source:
            with source.open("rb") as src:
                deps.store.put_file(interview.id, files[role], src)

    run_pipeline(interview.id, deps)

    done = deps.store.get_interview(interview.id)
    if done.status != "ready":
        raise SystemExit(f"Review failed: {done.error}")
    report = load_model(deps.store, interview.id, "report.json", Report)
    print(f"Interview {interview.id}: {len(report.flags)} moment(s) worth a second look\n")
    for flag in report.flags:
        print(f"[{_clock(flag.start)}-{_clock(flag.end)}] {flag.confidence} confidence, {' + '.join(flag.families)}")
        print(f"  {flag.explanation}")
        print(f"  Verify: {flag.verification_prompt}\n")
    for finding in report.cv_findings:
        print(f"CV {finding.classification}: {finding.claim} ({finding.cv_evidence})")
    print("Not analyzed:")
    for s in report.skipped:
        print(f"  - {s.signal}: {s.reason}")


def _clock(seconds: float) -> str:
    return f"{int(seconds // 60)}:{int(seconds % 60):02d}"


if __name__ == "__main__":
    main()

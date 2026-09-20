"""Isolated local browser test server; never uses vendor credentials or real interview storage."""
import tempfile
import uvicorn
from interview_review.adapters.heuristic_analyst import HeuristicAnalyst
from interview_review.adapters.local_store import LocalStore
from interview_review.api import create_app
from interview_review.ports import Deps
from test_live_recording import SyntheticTranscriber

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='interview-live-test-') as directory:
        app = create_app(Deps(store=LocalStore(directory), transcriber=SyntheticTranscriber(), analyst=HeuristicAnalyst()))
        uvicorn.run(app, host='127.0.0.1', port=8001)

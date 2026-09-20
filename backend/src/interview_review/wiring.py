"""Environment -> adapters. With no keys set, the offline adapters are wired and everything runs locally."""

from __future__ import annotations

import os

from dotenv import load_dotenv

from .ports import Deps


def build_deps() -> Deps:
    load_dotenv()
    env = os.environ.get

    if env("STORE", "local") == "firebase":
        from .adapters.firebase_store import FirebaseStore

        store = FirebaseStore(env("FIREBASE_CREDENTIALS", ""), env("FIREBASE_STORAGE_BUCKET", ""))
    else:
        from .adapters.local_store import LocalStore

        store = LocalStore(env("DATA_DIR", "data"))

    if env("ASSEMBLYAI_API_KEY"):
        from .adapters.assemblyai import AssemblyAITranscriber

        transcriber = AssemblyAITranscriber(env("ASSEMBLYAI_API_KEY"))
    else:
        from .adapters.json_transcriber import JsonTranscriber

        transcriber = JsonTranscriber()

    openai_model = env("OPENAI_MODEL", "gpt-5")
    if env("OPENAI_API_KEY"):
        from .adapters.openai_analyst import OpenAIAnalyst

        analyst = OpenAIAnalyst(model=openai_model)
    else:
        from .adapters.heuristic_analyst import HeuristicAnalyst

        analyst = HeuristicAnalyst()

    detector = cv_analyzer = hidden_prompt_judge = None
    if env("GPTZERO_API_KEY"):
        from .adapters.gptzero import GPTZeroDetector

        detector = GPTZeroDetector(env("GPTZERO_API_KEY"))
    if env("OPENAI_API_KEY"):
        from .adapters.openai_cv_analyzer import OpenAICvAnalyzer

        cv_analyzer = OpenAICvAnalyzer(model=openai_model)

        from .adapters.openai_hidden_prompt_judge import OpenAIHiddenPromptJudge

        hidden_prompt_judge = OpenAIHiddenPromptJudge(model=openai_model)

    return Deps(
        store=store,
        transcriber=transcriber,
        analyst=analyst,
        detector=detector,
        cv_analyzer=cv_analyzer,
        hidden_prompt_judge=hidden_prompt_judge,
    )

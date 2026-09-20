"""AiTextDetector adapter for GPTZero."""

from __future__ import annotations

import httpx

from ..models import AiTextClass, AiTextRaw, RawAiSentence

_URL = "https://api.gptzero.me/v2/predict/text"
_CLASSES: frozenset[AiTextClass] = frozenset({"human", "mixed", "ai"})


class GPTZeroDetector:
    name = "gptzero"

    def __init__(self, api_key: str) -> None:
        self._http = httpx.Client(headers={"x-api-key": api_key, "accept": "application/json"}, timeout=60.0)

    def analyze(self, text: str) -> AiTextRaw:
        response = self._http.post(_URL, json={"document": text})
        response.raise_for_status()
        document = response.json()["documents"][0]

        probabilities = document.get("class_probabilities") or {}
        score = probabilities.get("ai", document.get("completely_generated_prob"))
        if score is None:
            raise RuntimeError("GPTZero returned no AI probability for this text")

        predicted = document.get("predicted_class", "")
        overall_class: AiTextClass = predicted if predicted in _CLASSES else ("ai" if score >= 0.8 else "mixed" if score >= 0.5 else "human")

        sentences = [
            RawAiSentence(text=s.get("sentence", ""), score=float(s.get("generated_prob", s.get("completely_generated_prob", 0.0))))
            for s in document.get("sentences") or []
        ]
        return AiTextRaw(overall_class=overall_class, overall_score=float(score), sentences=sentences)

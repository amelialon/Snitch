"""AiTextDetector adapter for GPTZero."""

from __future__ import annotations

import httpx

_URL = "https://api.gptzero.me/v2/predict/text"


class GPTZeroDetector:
    name = "gptzero"

    def __init__(self, api_key: str) -> None:
        self._http = httpx.Client(headers={"x-api-key": api_key, "accept": "application/json"}, timeout=60.0)

    def score(self, text: str) -> float:
        response = self._http.post(_URL, json={"document": text})
        response.raise_for_status()
        document = response.json()["documents"][0]
        probabilities = document.get("class_probabilities") or {}
        value = probabilities.get("ai", document.get("completely_generated_prob"))
        if value is None:
            raise RuntimeError("GPTZero returned no AI probability for this text")
        return float(value)

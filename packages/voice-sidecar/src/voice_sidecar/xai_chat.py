"""Small xAI chat completions for voice decider and continuation."""

from __future__ import annotations

import json
import os

import httpx

from .stream import require_xai_api_key
from .stt import STTError


class ChatError(Exception):
    """Raised when chat completion fails."""


def chat_model() -> str:
    return os.environ.get("VOICE_LLM_MODEL", "grok-3-mini")


def chat_complete(
    *,
    system: str,
    user: str,
    max_tokens: int = 120,
    temperature: float = 0.0,
) -> str:
    api_key = require_xai_api_key()
    base_url = (os.environ.get("XAI_BASE_URL") or "https://api.x.ai/v1").rstrip("/")
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": chat_model(),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    try:
        resp = httpx.post(url, headers=headers, json=payload, timeout=30.0)
    except httpx.HTTPError as exc:
        raise ChatError(f"chat request failed: {exc}") from exc
    if resp.status_code != 200:
        raise ChatError(f"chat API error {resp.status_code}: {resp.text[:300]}")
    try:
        body = resp.json()
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise ChatError("chat API returned unexpected payload") from exc
    if not isinstance(content, str) or not content.strip():
        raise ChatError("chat API returned empty content")
    return content.strip()


def parse_json_object(text: str) -> dict[str, object]:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        stripped = "\n".join(line for line in lines if not line.startswith("```")).strip()
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise ChatError(f"expected JSON object, got: {text[:200]}") from exc
    if not isinstance(payload, dict):
        raise ChatError("expected JSON object")
    return payload

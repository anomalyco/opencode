"""Text-to-speech providers — Phase 2 ships xAI."""

from __future__ import annotations

import os

import httpx

from .stream import require_xai_api_key


class TTSError(Exception):
    """Raised when speech synthesis fails."""


class XaiTTS:
    """Synthesize speech via xAI POST /v1/tts (returns MP3 bytes)."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        voice_id: str | None = None,
        language: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        self.api_key = (api_key or require_xai_api_key()).strip()
        self.base_url = (base_url or os.environ.get("XAI_BASE_URL") or "https://api.x.ai/v1").rstrip("/")
        self.voice_id = voice_id or os.environ.get("VOICE_TTS_VOICE") or "eve"
        self.language = language or os.environ.get("VOICE_TTS_LANGUAGE") or "en"
        self.timeout = timeout

    def synthesize(self, text: str) -> bytes:
        stripped = text.strip()
        if not stripped:
            return b""
        url = f"{self.base_url}/tts"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {
            "text": stripped[:15000],
            "voice_id": self.voice_id,
            "language": self.language,
        }
        try:
            resp = httpx.post(url, headers=headers, json=payload, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise TTSError(f"request to {url} failed: {exc}") from exc
        if resp.status_code != 200:
            raise TTSError(f"TTS API error {resp.status_code}: {resp.text[:300]}")
        return resp.content


def default_tts() -> XaiTTS:
    return XaiTTS()

"""Speech-to-text providers.

The rest of the pipeline depends only on the ``SpeechToText`` protocol, so a
provider can be swapped (cloud → local whisper, xAI → another vendor) without
changes elsewhere. Phase 0 ships the xAI implementation.
"""

from __future__ import annotations

import os
from typing import Protocol, runtime_checkable

import httpx


class STTError(Exception):
    """Raised when transcription fails."""


@runtime_checkable
class SpeechToText(Protocol):
    def transcribe(self, wav_bytes: bytes) -> str:
        """Transcribe 16-bit PCM WAV audio and return the recognized text."""
        ...


class XaiSTT:
    """Transcribe via xAI's Speech-to-Text endpoint (POST /v1/stt).

    See https://docs.x.ai/developers/model-capabilities/audio/speech-to-text.
    The request is multipart/form-data with the ``file`` field last; there is no
    model parameter — the endpoint handles STT directly.

    Configuration (env vars, all overridable via constructor):
      XAI_API_KEY         required — the voice/API key.
      XAI_BASE_URL        default https://api.x.ai/v1
      VOICE_STT_LANGUAGE  default en
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        language: str | None = None,
        formatting: bool = True,
        timeout: float = 60.0,
    ) -> None:
        self.api_key = api_key or os.environ.get("XAI_API_KEY")
        if not self.api_key:
            raise STTError("XAI_API_KEY is not set")
        self.base_url = (base_url or os.environ.get("XAI_BASE_URL") or "https://api.x.ai/v1").rstrip("/")
        self.language = language or os.environ.get("VOICE_STT_LANGUAGE") or "en"
        self.formatting = formatting
        self.timeout = timeout

    def transcribe(self, wav_bytes: bytes) -> str:
        if not wav_bytes:
            return ""
        url = f"{self.base_url}/stt"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        # Form fields first; httpx encodes `files` last, satisfying the API's
        # requirement that `file` be the final multipart field.
        data = {"language": self.language, "format": "true" if self.formatting else "false"}
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        try:
            resp = httpx.post(url, headers=headers, data=data, files=files, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise STTError(f"request to {url} failed: {exc}") from exc
        if resp.status_code != 200:
            raise STTError(f"STT API error {resp.status_code}: {resp.text}")
        try:
            payload = resp.json()
        except ValueError as exc:
            raise STTError(f"STT API returned non-JSON response: {resp.text[:200]}") from exc
        return str(payload.get("text", "")).strip()


def default_stt() -> SpeechToText:
    """Build the configured STT provider. Phase 0: always xAI."""
    return XaiSTT()

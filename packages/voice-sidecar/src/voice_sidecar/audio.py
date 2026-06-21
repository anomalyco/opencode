"""Microphone capture and WAV encoding.

``sounddevice`` is imported lazily inside functions so that file-based commands
(``transcribe``) and ``--help`` work on machines without audio hardware.
"""

from __future__ import annotations

import io
import wave
from typing import Callable

import numpy as np

SAMPLE_RATE = 16_000  # 16 kHz mono is the standard input for speech models
CHANNELS = 1
SAMPLE_WIDTH = 2  # int16
BLOCK_MS = 30


def _sd():
    import sounddevice as sd  # lazy: avoids requiring PortAudio for non-audio commands

    return sd


def list_devices() -> str:
    return str(_sd().query_devices())


def to_wav_bytes(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(sample_rate)
        wf.writeframes(np.asarray(samples, dtype=np.int16).tobytes())
    return buf.getvalue()


def _rms(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    normalized = samples.astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(normalized**2)))


def record_fixed(seconds: float, device: str | int | None = None) -> bytes:
    """Record a fixed duration and return WAV bytes."""
    sd = _sd()
    frames = sd.rec(
        int(seconds * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        device=device,
    )
    sd.wait()
    return to_wav_bytes(frames.reshape(-1))


def record_until_silence(
    threshold: float = 0.02,
    silence_duration: float = 1.5,
    max_duration: float = 30.0,
    start_timeout: float = 10.0,
    device: str | int | None = None,
    on_state: Callable[[str], None] | None = None,
) -> bytes:
    """Record from the mic, auto-stopping after a run of silence.

    Waits up to ``start_timeout`` for speech to begin (RMS above ``threshold``),
    then captures until ``silence_duration`` of quiet, or ``max_duration`` total.
    Returns WAV bytes, or empty bytes if nothing was heard.
    """
    sd = _sd()
    block = int(SAMPLE_RATE * BLOCK_MS / 1000)
    block_seconds = block / SAMPLE_RATE

    collected: list[np.ndarray] = []
    started = False
    silence_run = 0.0
    elapsed = 0.0
    waited = 0.0

    if on_state:
        on_state("waiting")

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        blocksize=block,
        device=device,
    ) as stream:
        while True:
            data, _ = stream.read(block)
            samples = np.asarray(data).reshape(-1)
            level = _rms(samples)

            if not started:
                waited += block_seconds
                if level >= threshold:
                    started = True
                    if on_state:
                        on_state("recording")
                    collected.append(samples.copy())
                elif waited >= start_timeout:
                    return b""
                continue

            collected.append(samples.copy())
            elapsed += block_seconds
            if level < threshold:
                silence_run += block_seconds
                if silence_run >= silence_duration:
                    break
            else:
                silence_run = 0.0
            if elapsed >= max_duration:
                break

    if not collected:
        return b""
    return to_wav_bytes(np.concatenate(collected))

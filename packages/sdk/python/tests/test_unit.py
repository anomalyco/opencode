"""Unit tests for hand-written SDK code that don't require a live server."""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest


def test_top_level_exports():
    mod = importlib.import_module("opencode_ai")
    for name in (
        "AsyncServerHandle",
        "AuthenticatedClient",
        "Client",
        "ServerHandle",
        "ServerOptions",
        "create_opencode_server",
    ):
        assert hasattr(mod, name), f"opencode_ai is missing public export {name!r}"


def test_generated_models_importable():
    from opencode_ai.models import Agent, AssistantMessage, Config

    assert Agent is not None
    assert AssistantMessage is not None
    assert Config is not None


def test_generated_api_modules_present():
    from opencode_ai.api.default import (
        global_health,
        session_create,
        session_prompt,
    )

    for op in (global_health, session_create, session_prompt):
        for entry in ("sync", "sync_detailed", "asyncio", "asyncio_detailed"):
            assert callable(getattr(op, entry)), f"{op.__name__} is missing {entry}"


def test_server_options_defaults():
    from opencode_ai import ServerOptions

    opts = ServerOptions()
    assert opts.hostname == "127.0.0.1"
    assert opts.port == 4096
    assert opts.binary == "opencode"
    assert opts.timeout == pytest.approx(5.0)
    assert opts.config is None
    assert opts.extra_args == []


def test_overlay_kept_in_sync():
    """The committed tree must equal generator output + overlay.

    This is a fast safety net for local edits — CI runs the same check.
    """
    pkg_root = Path(__file__).resolve().parents[1]
    overlay = pkg_root / "scripts" / "_overlay"
    target = pkg_root / "src" / "opencode_ai"

    for src in overlay.rglob("*"):
        if src.is_dir():
            continue
        rel = src.relative_to(overlay)
        dst = target / rel
        assert dst.exists(), f"overlay file missing in tree: {rel}"
        assert src.read_bytes() == dst.read_bytes(), (
            f"overlay file diverges from committed tree: {rel}. Run scripts/generate.py to resync."
        )

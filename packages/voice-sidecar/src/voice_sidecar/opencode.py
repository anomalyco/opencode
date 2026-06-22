"""Phase 1 control plane: drive an opencode session over its HTTP API.

The sidecar is a headless client of the opencode server (the same server the TUI
and web app talk to). We use the **legacy session API** (`/session/...`) — the same
path as the web app's `promptAsync` — not the experimental V2 `/api/session` routes
(V2 wake is currently a no-op in-process).

Flow: create session → prompt_async → poll session status → read assistant reply.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
from pathlib import Path

import httpx


class OpencodeError(Exception):
    """Raised when the opencode server can't be reached or returns an error."""


def _state_dir() -> Path:
    xdg = os.environ.get("XDG_STATE_HOME")
    base = Path(xdg) if xdg else Path.home() / ".local" / "state"
    return base / "opencode"


def discover_server(url: str | None = None, password: str | None = None) -> tuple[str, str | None]:
    """Resolve the server URL and password from args, env, or the daemon's
    ``server.json`` / ``password`` files in the opencode state directory."""
    state = _state_dir()

    url = url or os.environ.get("OPENCODE_SERVER_URL")
    if url and "opencode.internal" in url:
        url = None
    if not url:
        server_file = state / "server.json"
        if server_file.exists():
            try:
                url = json.loads(server_file.read_text()).get("url")
            except (ValueError, OSError):
                url = None
    if not url:
        url = "http://127.0.0.1:4096"

    password = password or os.environ.get("OPENCODE_SERVER_PASSWORD")
    if not password:
        password_file = state / "password"
        if password_file.exists():
            try:
                password = password_file.read_text().strip()
            except OSError:
                password = None

    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    return url.rstrip("/"), password


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


class OpencodeClient:
    def __init__(
        self,
        url: str | None = None,
        password: str | None = None,
        username: str | None = None,
        directory: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        self.url, self.password = discover_server(url, password)
        self.username = username or os.environ.get("OPENCODE_SERVER_USERNAME") or "opencode"
        self.directory = str(
            Path(directory or os.environ.get("OPENCODE_DIRECTORY") or os.getcwd()).resolve()
        )
        headers = {"x-opencode-directory": self.directory}
        if self.password:
            token = base64.b64encode(f"{self.username}:{self.password}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"
        self._http = httpx.Client(base_url=self.url, headers=headers, timeout=timeout)
        self._model: dict | None = None

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            resp = self._http.request(method, path, **kwargs)
        except httpx.ConnectError as exc:
            raise OpencodeError(
                f"could not connect to opencode server at {self.url}. "
                "Is it running? Start one with `bun dev serve`."
            ) from exc
        except httpx.HTTPError as exc:
            raise OpencodeError(f"request to {path} failed: {exc}") from exc
        if resp.status_code >= 400:
            raise OpencodeError(f"{method} {path} → {resp.status_code}: {resp.text[:300]}")
        return resp

    def _chat_model(self, model_id: str) -> bool:
        lowered = model_id.lower()
        if "imagine" in lowered or "video" in lowered or "whisper" in lowered:
            return False
        return True

    def _resolve_model(self) -> dict:
        if self._model:
            return self._model

        provider = os.environ.get("OPENCODE_MODEL_PROVIDER")
        model_id = os.environ.get("OPENCODE_MODEL_ID")
        if provider and model_id:
            self._model = {"providerID": provider, "modelID": model_id}
            return self._model

        data = self._request("GET", "/provider").json()
        connected = data.get("connected") or []
        defaults = data.get("default") or {}

        if "opencode" in connected:
            opencode_model = defaults.get("opencode") or "big-pickle"
            if self._chat_model(opencode_model):
                self._model = {"providerID": "opencode", "modelID": opencode_model}
                return self._model

        if "xai" in connected:
            for candidate in ("grok-build-0.1", "grok-code", defaults.get("xai", "")):
                if candidate and self._chat_model(candidate):
                    self._model = {"providerID": "xai", "modelID": candidate}
                    return self._model

        for provider_id in connected:
            candidate = defaults.get(provider_id)
            if candidate and self._chat_model(candidate):
                self._model = {"providerID": provider_id, "modelID": candidate}
                return self._model

        raise OpencodeError(
            "no chat model found. Set OPENCODE_MODEL_PROVIDER and OPENCODE_MODEL_ID, "
            "or configure provider API keys."
        )

    def create_session(self, agent: str | None = None) -> str:
        payload: dict = {}
        if agent:
            payload["agent"] = agent
        data = self._request("POST", "/session", json=payload).json()
        return data["id"]

    def submit(self, session_id: str, text: str, agent: str | None = None, *, log_model: bool = True) -> None:
        model = self._resolve_model()
        if log_model:
            _log(f"  model {model['providerID']}/{model['modelID']} · workspace {self.directory}")
        payload = {
            "agent": agent or os.environ.get("OPENCODE_AGENT") or "build",
            "model": model,
            "parts": [{"type": "text", "text": text}],
        }
        self._request("POST", f"/session/{session_id}/prompt_async", json=payload)

    def wait_idle(self, session_id: str, timeout: float = 300.0) -> None:
        deadline = time.monotonic() + timeout
        seen_busy = False
        last_log = 0.0
        started = time.monotonic()
        while time.monotonic() < deadline:
            status_map = self._request("GET", "/session/status").json()
            status = status_map.get(session_id)
            if status and status.get("type") != "idle":
                seen_busy = True
            if seen_busy and session_id not in status_map:
                return
            if not seen_busy and time.monotonic() - started > 15.0:
                raise OpencodeError(
                    f"session {session_id} never started (still idle after 15s). "
                    "Check OPENCODE_DIRECTORY and model/provider config."
                )
            now = time.monotonic()
            if now - last_log >= 5.0:
                label = status.get("type") if status else "idle"
                _log(f"  waiting for opencode… session status={label}")
                last_log = now
            time.sleep(0.5)
        raise OpencodeError(f"session {session_id} did not become idle within {timeout}s")

    def last_assistant_text(self, session_id: str) -> str:
        messages = self._request(
            "GET", f"/session/{session_id}/message", params={"limit": 50}
        ).json()
        if not isinstance(messages, list):
            messages = messages.get("data", [])
        reply = ""
        tool_reply = ""
        for message in reversed(messages):
            info = message.get("info", {})
            if info.get("role") != "assistant":
                continue
            for part in message.get("parts", []):
                if part.get("type") == "text":
                    text = part.get("text", "").strip()
                    if text:
                        return text
                if part.get("type") != "tool" or tool_reply:
                    continue
                state = part.get("state", {})
                if state.get("status") != "completed":
                    continue
                result = state.get("result", "")
                if isinstance(result, str) and result.strip():
                    tool_reply = result.strip()
        return reply or tool_reply

    def abort(self, session_id: str) -> None:
        self._request("POST", f"/session/{session_id}/abort")

    def run_turn(
        self,
        session_id: str,
        text: str,
        agent: str | None = None,
        *,
        log_model: bool = True,
    ) -> str:
        """Submit a command, wait for completion, return the assistant's reply."""
        self.submit(session_id, text, agent, log_model=log_model)
        self.wait_idle(session_id)
        return self.last_assistant_text(session_id)

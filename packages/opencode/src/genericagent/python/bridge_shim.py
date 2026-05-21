#!/usr/bin/env python3
"""GenericAgent HTTP bridge shim.

Loads the GeneraticAgent runtime from a user-provided GenericAgent checkout
and exposes a minimal HTTP + SSE surface so the TypeScript bridge in
packages/opencode/src/genericagent/bridge.ts can proxy prompts to it.

Endpoints:
    GET  /health                   {"ok": bool, "model": str, "error"?: str}
    GET  /llms                     [{"index": int, "name": str, "current": bool}, ...]
    POST /prompt   body {"query"}  text/event-stream:
                                       data: {"type": "delta", "text": str}
                                       data: {"type": "done",  "text": str}
                                       data: {"type": "error", "message": str}
    POST /abort                    {"ok": true}
    POST /reset                    {"ok": true}
    POST /llm      body {"index"}  {"ok": true, "model": str}

Boot protocol:
    First stdout line after successful boot is "LISTEN_PORT:<port>\\n".
    On fatal boot error, prints "BOOT_ERROR:<message>\\n" and exits 1.

Python stdlib only (ThreadingHTTPServer + http.server). No pip deps.
"""

import argparse
import importlib
import json
import os
import queue
import re
import signal
import socket
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional


def _eprint(msg: str) -> None:
    """Print to stderr so TS parent can surface the error."""
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _announce(msg: str) -> None:
    """Print one-line protocol message to stdout (line-buffered)."""
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="GenericAgent HTTP bridge shim")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=0, help="0 = auto-pick")
    p.add_argument("--ga-dir", required=True, help="Path to GenericAgent project root")
    return p.parse_args()


def _validate_ga_dir(ga_dir: str) -> None:
    if not os.path.isdir(ga_dir):
        raise RuntimeError(f"--ga-dir does not exist or is not a directory: {ga_dir}")
    agentmain = os.path.join(ga_dir, "agentmain.py")
    if not os.path.isfile(agentmain):
        raise RuntimeError(f"agentmain.py not found in {ga_dir}")
    mykey = os.path.join(ga_dir, "mykey.py")
    if not os.path.isfile(mykey):
        raise RuntimeError(
            f"mykey.py not found in {ga_dir} — copy mykey_template.py to mykey.py and configure an LLM API key first"
        )


def _normalize_cwd(cwd: Optional[str]) -> Optional[str]:
    if not cwd:
        return None
    value = str(cwd).strip()
    if not value:
        return None
    value = os.path.abspath(os.path.expanduser(value))
    if not os.path.isdir(value):
        raise RuntimeError(f"cwd does not exist or is not a directory: {value}")
    return value


def _boot_agent(ga_dir: str):
    """Load the GeneraticAgent class and start its worker thread."""
    sys.path.insert(0, ga_dir)
    os.chdir(ga_dir)
    import agentmain  # type: ignore[import-not-found]

    original_handler = agentmain.GenericAgentHandler

    class BridgeGenericAgentHandler(original_handler):
        def __init__(self, parent, last_history=None, cwd="./temp"):
            super().__init__(parent, last_history, _current_task_cwd() or cwd)

    agentmain.GenericAgentHandler = BridgeGenericAgentHandler
    agent = agentmain.GeneraticAgent()
    if not agent.llmclients:
        raise RuntimeError(
            "GeneraticAgent loaded but has zero LLM clients configured. "
            f"Check mykey.py in {ga_dir} — variable names must contain 'api', 'config', or 'cookie'."
        )
    agent.next_llm(0)
    agent.inc_out = True
    agent.verbose = False
    worker = threading.Thread(target=agent.run, daemon=True, name="ga-worker")
    worker.start()
    return agent


_AGENT_LOCK = threading.Lock()
_AGENT = None  # type: ignore[var-annotated]
_TASK_LOCK = threading.Lock()
_TASK_CWD_LOCK = threading.Lock()
_TASK_CWD = None  # type: ignore[var-annotated]

_ACTIVE_DQ_LOCK = threading.Lock()
_ACTIVE_DQ = None  # type: ignore[var-annotated]


def _set_task_cwd(cwd: Optional[str]) -> None:
    global _TASK_CWD
    with _TASK_CWD_LOCK:
        _TASK_CWD = cwd


def _current_task_cwd() -> Optional[str]:
    with _TASK_CWD_LOCK:
        return _TASK_CWD


def _set_active_dq(dq) -> None:
    global _ACTIVE_DQ
    with _ACTIVE_DQ_LOCK:
        _ACTIVE_DQ = dq


def _clear_active_dq(dq) -> None:
    global _ACTIVE_DQ
    with _ACTIVE_DQ_LOCK:
        if _ACTIVE_DQ is dq:
            _ACTIVE_DQ = None


def _notify_active_dq_abort() -> None:
    with _ACTIVE_DQ_LOCK:
        dq = _ACTIVE_DQ
    if dq is None:
        _eprint("[bridge_shim] /abort: no active dq to notify")
        return
    try:
        dq.put({"_abort": True})
        _eprint("[bridge_shim] /abort: sentinel put to active dq")
    except Exception as e:
        _eprint(f"[bridge_shim] /abort: failed to put sentinel: {e}")


def _apply_agent_cwd(agent, cwd: Optional[str]) -> None:
    if not cwd:
        return
    try:
        handler = getattr(agent, "handler", None)
        if handler is not None:
            setattr(handler, "cwd", cwd)
    except Exception as e:
        _eprint(f"[bridge_shim] failed to set handler cwd: {e}")


def _agent():
    global _AGENT
    return _AGENT


def _set_agent(agent) -> None:
    global _AGENT
    _AGENT = agent


def _model_name(agent) -> str:
    try:
        return agent.get_llm_name()
    except Exception:
        return "unknown"


def _reset_history(agent) -> None:
    with _AGENT_LOCK:
        agent.history = []
        try:
            agent.llmclient.backend.history = []
        except Exception:
            pass
        try:
            agent.handler = None
        except Exception:
            pass


def _snapshot_agent_log(agent) -> str | None:
    import time as _time
    log_path = getattr(agent, "log_path", None)
    if not log_path or not os.path.isfile(log_path):
        return None
    try:
        with open(log_path, encoding="utf-8", errors="replace") as fh:
            content = fh.read()
    except Exception:
        return None
    if not content.strip():
        return None
    log_dir = os.path.dirname(log_path)
    os.makedirs(log_dir, exist_ok=True)
    stamp = _time.strftime("%Y%m%d_%H%M%S")
    snapshot = os.path.join(
        log_dir, f"model_responses_snapshot_{os.getpid()}_{stamp}_{_time.time_ns() % 1_000_000_000:09d}.txt"
    )
    try:
        with open(snapshot, "w", encoding="utf-8", errors="replace") as fh:
            fh.write(content)
        with open(log_path, "w", encoding="utf-8", errors="replace"):
            pass
    except Exception:
        return None
    return snapshot


_SESSION_MESSAGES_RE = re.compile(r"^/sessions/([^/]+)/messages$")
_SESSION_RESTORE_RE = re.compile(r"^/sessions/([^/]+)/restore$")


def _find_session_path(session_id: str):
    continue_cmd = importlib.import_module("frontends.continue_cmd")

    for path, _mtime, _preview, _rounds in continue_cmd.list_sessions():
        if os.path.splitext(os.path.basename(path))[0] == session_id:
            return path
    return None


class Handler(BaseHTTPRequestHandler):
    # Quiet the default stderr access log — noisy under streaming.
    def log_message(self, format, *args):  # noqa: A003
        return

    # ---- helpers ----

    def _write_json(self, status: int, body) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def _write_sse(self, payload: dict) -> bool:
        try:
            line = "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"
            self.wfile.write(line.encode("utf-8"))
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError):
            return False

    # ---- routes ----

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            agent = _agent()
            if agent is None:
                self._write_json(503, {"ok": False, "error": "agent_not_loaded"})
                return
            self._write_json(200, {"ok": True, "model": _model_name(agent)})
            return
        if self.path == "/llms":
            agent = _agent()
            if agent is None:
                self._write_json(503, {"ok": False, "error": "agent_not_loaded"})
                return
            try:
                items = [
                    {"index": int(idx), "name": str(name), "current": bool(is_current)}
                    for idx, name, is_current in agent.list_llms()
                ]
            except Exception as e:
                self._write_json(500, {"ok": False, "error": str(e)})
                return
            self._write_json(200, items)
            return
        if self.path == "/sessions":
            try:
                continue_cmd = importlib.import_module("frontends.continue_cmd")

                sessions = [
                    {
                        "id": os.path.splitext(os.path.basename(path))[0],
                        "path": path,
                        "mtime": float(mtime),
                        "preview": preview_text,
                        "rounds": int(n_rounds),
                    }
                    for path, mtime, preview_text, n_rounds in continue_cmd.list_sessions()
                ]
            except Exception as e:
                self._write_json(500, {"ok": False, "error": str(e)})
                return
            self._write_json(200, sessions)
            return
        session_messages_match = _SESSION_MESSAGES_RE.match(self.path)
        if session_messages_match:
            session_id = session_messages_match.group(1)
            try:
                continue_cmd = importlib.import_module("frontends.continue_cmd")

                path = _find_session_path(session_id)
                if path is None:
                    self._write_json(404, {"ok": False, "error": "session_not_found"})
                    return
                messages = continue_cmd.extract_ui_messages(path)
            except Exception as e:
                self._write_json(500, {"ok": False, "error": str(e)})
                return
            self._write_json(200, messages)
            return
        self._write_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):  # noqa: N802
        if self.path == "/prompt":
            self._handle_prompt()
            return
        if self.path == "/abort":
            _eprint("[bridge_shim] /abort received")
            agent = _agent()
            if agent is not None:
                try:
                    agent.abort()
                    _eprint("[bridge_shim] /abort: agent.abort() returned")
                except Exception as e:
                    _eprint(f"[bridge_shim] /abort: agent.abort() raised: {e}")
                    self._write_json(500, {"ok": False, "error": str(e)})
                    return
            else:
                _eprint("[bridge_shim] /abort: agent not loaded")
            _notify_active_dq_abort()
            self._write_json(200, {"ok": True})
            return
        if self.path == "/reset":
            agent = _agent()
            if agent is not None:
                _reset_history(agent)
            self._write_json(200, {"ok": True})
            return
        if self.path == "/snapshot":
            agent = _agent()
            if agent is None:
                self._write_json(503, {"ok": False, "error": "agent_not_loaded"})
                return
            snapshot = _snapshot_agent_log(agent)
            self._write_json(200, {"ok": True, "snapshot": snapshot})
            return
        if self.path == "/llm":
            agent = _agent()
            if agent is None:
                self._write_json(503, {"ok": False, "error": "agent_not_loaded"})
                return
            body = self._read_json()
            if not isinstance(body, dict) or not isinstance(body.get("index"), int):
                self._write_json(400, {"ok": False, "error": "index_required"})
                return
            try:
                agent.next_llm(int(body["index"]))
            except Exception as e:
                self._write_json(500, {"ok": False, "error": str(e)})
                return
            self._write_json(200, {"ok": True, "model": _model_name(agent)})
            return
        session_restore_match = _SESSION_RESTORE_RE.match(self.path)
        if session_restore_match:
            agent = _agent()
            if agent is None:
                self._write_json(503, {"ok": False, "error": "agent_not_loaded"})
                return
            session_id = session_restore_match.group(1)
            try:
                continue_cmd = importlib.import_module("frontends.continue_cmd")

                path = _find_session_path(session_id)
                if path is None:
                    self._write_json(404, {"ok": False, "error": "session_not_found"})
                    return
                with _AGENT_LOCK:
                    message, is_full = continue_cmd.restore(agent, path)
            except Exception as e:
                self._write_json(500, {"ok": False, "error": str(e)})
                return
            if isinstance(message, str) and message.startswith("❌"):
                self._write_json(400, {"ok": False, "error": message})
                return
            self._write_json(200, {"ok": True, "message": message, "full": bool(is_full)})
            return
        self._write_json(404, {"ok": False, "error": "not_found"})

    def _handle_prompt(self) -> None:
        body = self._read_json()
        query = (body.get("query") or "").strip() if isinstance(body, dict) else ""
        if not query:
            self._write_json(400, {"ok": False, "error": "query_required"})
            return
        agent = _agent()
        if agent is None:
            self._write_json(503, {"ok": False, "error": "agent_not_loaded"})
            return
        try:
            cwd = _normalize_cwd(body.get("cwd") if isinstance(body, dict) else None)
        except Exception as e:
            self._write_json(400, {"ok": False, "error": str(e)})
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        full_text = ""
        dq = None
        old_cwd = os.getcwd()
        _TASK_LOCK.acquire()
        try:
            _set_task_cwd(cwd)
            if cwd:
                os.chdir(cwd)
                _apply_agent_cwd(agent, cwd)
            effective_query = query if not cwd else f"[SYSTEM] Current working directory: {cwd}\n\n{query}"
            dq = agent.put_task(effective_query, source="bridge")
            _set_active_dq(dq)
            while True:
                try:
                    item = dq.get(timeout=600)
                except queue.Empty:
                    self._write_sse({"type": "error", "message": "timeout"})
                    return
                if item.get("_abort"):
                    _eprint("[bridge_shim] _handle_prompt: _abort sentinel received, closing stream")
                    self._write_sse({"type": "done", "text": full_text})
                    return
                if "tool_event" in item:
                    _eprint(f"[DEBUG bridge_shim] Received tool_event: {item['tool_event']}")
                    if not self._write_sse({"type": "tool_use", "data": item["tool_event"]}):
                        return
                if "next" in item:
                    delta = item.get("next") or ""
                    if delta:
                        full_text += delta
                        if not self._write_sse({"type": "delta", "text": delta}):
                            return
                if "done" in item:
                    final = item.get("done") or full_text
                    self._write_sse({"type": "done", "text": final})
                    return
        except Exception as e:
            self._write_sse(
                {
                    "type": "error",
                    "message": str(e),
                    "trace": traceback.format_exc(),
                }
            )
        finally:
            _set_task_cwd(None)
            if cwd:
                try:
                    os.chdir(old_cwd)
                except Exception as e:
                    _eprint(f"[bridge_shim] failed to restore cwd: {e}")
            if dq is not None:
                _clear_active_dq(dq)
            _TASK_LOCK.release()


def _find_port(host: str, preferred: int) -> int:
    if preferred != 0:
        return preferred
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def _install_signal_handlers(server: ThreadingHTTPServer) -> None:
    def _shutdown(_signum, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _shutdown)
        except (ValueError, OSError):
            pass


def main() -> int:
    args = _parse_args()
    try:
        _validate_ga_dir(args.ga_dir)
        agent = _boot_agent(args.ga_dir)
        _set_agent(agent)
    except Exception as e:
        _announce(f"BOOT_ERROR:{e}")
        _eprint(traceback.format_exc())
        return 1

    port = _find_port(args.host, args.port)
    try:
        server = ThreadingHTTPServer((args.host, port), Handler)
    except OSError as e:
        _announce(f"BOOT_ERROR:failed to bind {args.host}:{port} — {e}")
        return 1

    _install_signal_handlers(server)
    _announce(f"LISTEN_PORT:{port}")
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

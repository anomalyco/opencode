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
import json
import os
import queue
import signal
import socket
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


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


def _boot_agent(ga_dir: str):
    """Load the GeneraticAgent class and start its worker thread."""
    sys.path.insert(0, ga_dir)
    os.chdir(ga_dir)
    from agentmain import GeneraticAgent  # type: ignore[import-not-found]

    agent = GeneraticAgent()
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


class Handler(BaseHTTPRequestHandler):
    # Quiet the default stderr access log — noisy under streaming.
    def log_message(self, format, *args):  # noqa: A003
        return

    # ---- helpers ----

    def _write_json(self, status: int, body: dict) -> None:
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
        self._write_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):  # noqa: N802
        if self.path == "/prompt":
            self._handle_prompt()
            return
        if self.path == "/abort":
            agent = _agent()
            if agent is not None:
                try:
                    agent.abort()
                except Exception as e:
                    self._write_json(500, {"ok": False, "error": str(e)})
                    return
            self._write_json(200, {"ok": True})
            return
        if self.path == "/reset":
            agent = _agent()
            if agent is not None:
                _reset_history(agent)
            self._write_json(200, {"ok": True})
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

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        full_text = ""
        try:
            dq = agent.put_task(query, source="bridge")
            while True:
                try:
                    item = dq.get(timeout=600)
                except queue.Empty:
                    self._write_sse({"type": "error", "message": "timeout"})
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

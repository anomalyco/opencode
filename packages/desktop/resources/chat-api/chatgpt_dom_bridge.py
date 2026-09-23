"""Loopback transport for the dedicated Edge DOM adapter.

Only local commands and page-observed events cross this bridge. The browser
keeps its own login state and handles all ChatGPT network requests.
"""
from __future__ import annotations

import hmac
import json
import os
import queue
import re
import secrets
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import requests

STATE_FILE = Path(
    os.environ.get(
        "OPENCODE_CHAT_API_STATE_FILE",
        str(Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "chat-api" / "edge-dom-bridge.json"),
    )
)
CONNECTION_FILE = STATE_FILE.with_name("edge-dom-bridge-connection.json")
MAX_BODY = 256 * 1024
MAX_EVENTS = 512
TERMINAL = {"chat.completed", "chat.cancelled", "chat.error", "control.completed"}


class BridgeError(RuntimeError):
    def __init__(self, message, code="BRIDGE_ERROR"):
        super().__init__(message)
        self.code = code


class BridgeClient:
    def __init__(self, state_file=STATE_FILE, *, timeout=240):
        try:
            state = json.loads(Path(state_file).read_text(encoding="utf-8"))
            port = int(state["port"])
            if not 1 <= port <= 65535 or len(state["key"]) < 32:
                raise ValueError()
            self.url = f"http://127.0.0.1:{port}"
            self.key = state["key"]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise BridgeError("DOM 桥接未启动，请运行 python chatgpt_dom_bridge.py", "BRIDGE_OFFLINE") from exc
        self.timeout = timeout

    def _request(self, session, method, path, **kwargs):
        try:
            response = session.request(method, self.url + path,
                                       headers={"X-Chat-Bridge-Key": self.key},
                                       timeout=kwargs.pop("timeout", 15), **kwargs)
            data = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise BridgeError("桥接连接中断；消息可能已发送，请检查专用标签页", "UNKNOWN") from exc
        if response.status_code != 200 or not data.get("ok"):
            raise BridgeError(data.get("error", "桥接请求失败"), data.get("code", "BRIDGE_ERROR"))
        return data

    def stream(self, operation, **payload):
        """Yield sequenced page events; never retry an uncertain send."""
        with requests.Session() as session:
            session.trust_env = False
            job_id = self._request(session, "POST", "/start", json={"operation": operation, **payload})["id"]
            after = 0
            deadline = time.monotonic() + self.timeout
            try:
                while True:
                    if time.monotonic() >= deadline:
                        raise BridgeError("网页执行超时；请求状态未知，请检查专用标签页", "UNKNOWN")
                    data = self._request(session, "GET", "/events", params={"id": job_id, "after": after}, timeout=15)
                    for event in data["events"]:
                        if event.get("seq") != after + 1:
                            raise BridgeError("事件序号缺失", "EVENT_GAP")
                        after += 1
                        yield event
                        if event["type"] in TERMINAL:
                            return
            finally:
                try:
                    self._request(session, "POST", "/ack", json={"id": job_id}, timeout=3)
                except BridgeError:
                    pass

    def call(self, operation, **payload):
        for event in self.stream(operation, **payload):
            if event["type"] == "chat.error":
                raise BridgeError(event.get("message") or event.get("code") or "网页操作失败",
                                  event.get("code", "PAGE_ERROR"))
            if event["type"] in TERMINAL:
                return event.get("result", event)
        raise BridgeError("网页操作缺少终态", "UNKNOWN")


class Broker:
    def __init__(self):
        self.key = secrets.token_urlsafe(32)
        self.jobs = queue.Queue()
        self.pending = {}
        self.lock = threading.RLock()
        self.last_poll = 0.0
        self.active_chat = None
        self.owner_session = None

    def expire_abandoned_chat(self):
        """Release an orphan only after the page's maximum generation window."""
        job_id = self.active_chat
        item = self.pending.get(job_id) if job_id else None
        if item and not item["terminal"] and time.monotonic() - item["created"] > 220:
            self.publish(job_id, {"type": "chat.error", "code": "UNKNOWN",
                                  "message": "网页任务超过总期限；提交状态未知"})

    def start(self, payload):
        operation = payload.get("operation")
        if operation not in {"chat", "stop", "new", "open", "health"}:
            raise BridgeError("不支持的操作", "BAD_OPERATION")
        session_id = payload.get("client_session_id")
        if not isinstance(session_id, str) or not session_id:
            raise BridgeError("缺少客户端会话标识", "BAD_SESSION")
        if operation == "open":
            url = payload.get("url")
            parsed = urlsplit(url) if isinstance(url, str) else None
            if not parsed or parsed.scheme != "https" or parsed.netloc != "chatgpt.com" or not parsed.path.startswith("/c/"):
                raise BridgeError("会话地址无效", "BAD_URL")
        if time.monotonic() - self.last_poll > 15:
            raise BridgeError("扩展尚未连接 DOM 桥接，请在扩展设置页连接", "EXTENSION_OFFLINE")
        with self.lock:
            now = time.monotonic()
            self.expire_abandoned_chat()
            for old_id, item in list(self.pending.items()):
                if item.get("finished") and now - item["finished"] > 300:
                    self.pending.pop(old_id)
            if operation in {"chat", "new", "open"} and self.active_chat is not None:
                raise BridgeError("另一条消息正在生成", "BUSY")
            if operation in {"chat", "stop"} and self.owner_session != session_id:
                raise BridgeError("专用页面已由另一客户端接管，请显式开始新会话", "SESSION_LOST")
            if operation in {"new", "open"}:
                self.owner_session = session_id
            job_id = str(uuid.uuid4())
            self.pending[job_id] = {"events": [], "condition": threading.Condition(self.lock),
                                    "terminal": False, "created": time.monotonic()}
            if operation == "chat":
                self.active_chat = job_id
            self.jobs.put({"id": job_id, **payload})
            return job_id

    def next_job(self):
        self.last_poll = time.monotonic()
        try:
            job = self.jobs.get(timeout=5)
        except queue.Empty:
            return None
        with self.lock:
            return job if job["id"] in self.pending else None

    def publish(self, job_id, event):
        allowed = {"chat.accepted", "chat.submitted", "chat.delta", "chat.snapshot",
                   "chat.completed", "chat.cancelled", "chat.error", "control.completed"}
        if not isinstance(event, dict) or event.get("type") not in allowed:
            raise BridgeError("事件格式无效", "BAD_EVENT")
        with self.lock:
            item = self.pending.get(job_id)
            if item is None or item["terminal"]:
                raise BridgeError("请求不存在或已结束", "UNKNOWN_REQUEST")
            if len(item["events"]) >= MAX_EVENTS:
                event = {"type": "chat.error", "code": "EVENT_OVERFLOW", "message": "事件队列溢出"}
            event = {**event, "seq": len(item["events"]) + 1, "request_id": job_id}
            item["events"].append(event)
            if event["type"] in TERMINAL:
                item["terminal"] = True
                item["finished"] = time.monotonic()
                if self.active_chat == job_id:
                    self.active_chat = None
            item["condition"].notify_all()

    def events(self, job_id, after):
        with self.lock:
            item = self.pending.get(job_id)
            if item is None:
                raise BridgeError("请求状态已丢失，不能自动重发", "UNKNOWN_REQUEST")
            if after < 0 or after > len(item["events"]):
                raise BridgeError("事件序号无效", "EVENT_GAP")
            if after == len(item["events"]) and not item["terminal"]:
                item["condition"].wait(timeout=8)
            self.expire_abandoned_chat()
            return item["events"][after:after + 32]

    def ack(self, job_id):
        with self.lock:
            if job_id in self.pending and self.pending[job_id]["terminal"]:
                self.pending.pop(job_id)


def make_handler(broker):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def allowed(self, authenticated=True):
            origin = self.headers.get("Origin")
            trusted = origin is None or bool(re.fullmatch(r"chrome-extension://[a-p]{32}", origin))
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}" or not trusted:
                self.send_error(403)
                return False
            if authenticated and not hmac.compare_digest(self.headers.get("X-Chat-Bridge-Key", ""), broker.key):
                self.send_error(403)
                return False
            return True

        def respond(self, data, status=200):
            raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            if self.headers.get("Origin"):
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            try:
                self.wfile.write(raw)
            except OSError:
                pass

        def read_json(self):
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                raise ValueError("消息大小无效")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("消息不是 JSON 对象")
            return data

        def do_OPTIONS(self):
            if not self.allowed(authenticated=False):
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "https://chatgpt.com"))
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Chat-Bridge-Key")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return
            parsed = urlsplit(self.path)
            try:
                if parsed.path == "/next":
                    self.respond({"ok": True, "job": broker.next_job()})
                elif parsed.path == "/events":
                    params = parse_qs(parsed.query)
                    self.respond({"ok": True, "events": broker.events(params["id"][0], int(params["after"][0]))})
                elif parsed.path == "/health":
                    self.respond({"ok": True, "connected": time.monotonic() - broker.last_poll < 15})
                else:
                    self.respond({"ok": False, "code": "NOT_FOUND"}, 404)
            except (KeyError, IndexError, ValueError) as exc:
                self.respond({"ok": False, "code": "BAD_REQUEST", "error": str(exc)}, 400)
            except BridgeError as exc:
                self.respond({"ok": False, "code": exc.code, "error": str(exc)}, 409)

        def do_POST(self):
            if not self.allowed():
                return
            try:
                data = self.read_json()
                if self.path == "/start":
                    self.respond({"ok": True, "id": broker.start(data)})
                elif self.path == "/event":
                    broker.publish(data["id"], data["event"])
                    self.respond({"ok": True})
                elif self.path == "/ack":
                    broker.ack(data["id"])
                    self.respond({"ok": True})
                else:
                    self.respond({"ok": False, "code": "NOT_FOUND"}, 404)
            except (KeyError, TypeError, ValueError, UnicodeDecodeError) as exc:
                self.respond({"ok": False, "code": "BAD_REQUEST", "error": str(exc)}, 400)
            except BridgeError as exc:
                self.respond({"ok": False, "code": exc.code, "error": str(exc)}, 409)
    return Handler


def main():
    broker = Broker()
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        connection = json.loads(CONNECTION_FILE.read_text(encoding="utf-8"))
        if (
            not isinstance(connection.get("port"), int)
            or not 1 <= connection["port"] <= 65535
            or not isinstance(connection.get("key"), str)
            or len(connection["key"]) < 32
        ):
            raise ValueError()
    except (OSError, ValueError, TypeError):
        connection = {"port": 0, "key": secrets.token_urlsafe(32)}
    broker.key = connection["key"]
    server = ThreadingHTTPServer(("127.0.0.1", connection["port"]), make_handler(broker))
    state = {"port": server.server_port, "key": broker.key}
    CONNECTION_FILE.write_text(json.dumps(state), encoding="utf-8")
    if os.name != "nt":
        CONNECTION_FILE.chmod(0o600)
    STATE_FILE.write_text(json.dumps(state), encoding="utf-8")
    print(json.dumps({"state_file": str(STATE_FILE), "port": server.server_port}), flush=True)
    print("Extension connection configuration (local capability only):", flush=True)
    print(json.dumps(state), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        try:
            if json.loads(STATE_FILE.read_text(encoding="utf-8")).get("key") == broker.key:
                STATE_FILE.unlink()
        except (OSError, ValueError):
            pass


if __name__ == "__main__":
    main()

"""ChatGPT page client: text commands in, observable DOM events out.

The logged-in Edge page owns the actual ChatGPT session. This module neither
reads credentials nor constructs ChatGPT private HTTP requests.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import threading
import uuid
from dataclasses import dataclass
from typing import Callable

from chatgpt_dom_bridge import BridgeClient, BridgeError

DEFAULT_MODEL = "current"
DEFAULT_THINKING_EFFORT = None


class ChatGPTError(RuntimeError):
    def __init__(self, message, *, code="CHAT_ERROR", partial_text=""):
        super().__init__(message)
        self.code = code
        self.partial_text = partial_text


@dataclass
class ChatModel:
    slug: str
    title: str = ""
    description: str = ""
    reasoning_type: str = ""
    thinking_efforts: tuple = ()
    max_tokens: int = 0
    tags: tuple = ()


class ChatGPTClient:
    def __init__(self, *, model=None, thinking_effort=None, timeout=240,
                 transport="edge", bridge=None, auth_provider=None, session=None,
                 client_session_id=None):
        if transport != "edge":
            raise ValueError("ChatGPT 仅支持 Edge 页面 DOM transport")
        if auth_provider is not None or session is not None:
            raise ValueError("DOM transport 不接受凭据或 HTTP session")
        self.model = model
        self.thinking_effort = thinking_effort
        self.timeout = timeout
        self.bridge = bridge
        self.client_session_id = client_session_id or str(uuid.uuid4())
        self.conversation_id = None
        self.parent_message_id = None  # Deprecated: the browser owns this state.
        self.last_message_id = None
        self.default_model_slug = None
        self._needs_new = True
        self._lock = threading.Lock()
        self._active_request_id = None

    def _bridge(self):
        if self.bridge is None:
            self.bridge = BridgeClient(timeout=self.timeout)
        return self.bridge

    def _call(self, operation, **payload):
        try:
            return self._bridge().call(operation, client_session_id=self.client_session_id, **payload)
        except BridgeError as exc:
            raise ChatGPTError(str(exc), code=exc.code) from exc

    def health(self):
        return self._call("health")

    def list_models(self):
        health = self.health()
        return {"default_model_slug": None, "models": [], "categories": [],
                "current_model": "网页当前模型", "page_state": health.get("state")}

    def new_conversation(self):
        """Switch the dedicated page to a confirmed blank chat."""
        with self._lock:
            if self._active_request_id is not None:
                raise ChatGPTError("正在生成回答，不能开始新会话", code="BUSY")
            result = self._call("new")
            if result.get("state") != "READY" or not result.get("url", "").rstrip("/") == "https://chatgpt.com":
                raise ChatGPTError("新聊天页面尚未确认就绪", code="SESSION_LOST")
            self.conversation_id = None
            self.parent_message_id = self.last_message_id = None
            self._needs_new = False
            return result

    def open_conversation(self, url):
        """Restore a conversation URL owned by a desktop session."""
        with self._lock:
            if self._active_request_id is not None:
                raise ChatGPTError("正在生成回答，不能切换会话", code="BUSY")
            result = self._call("open", url=url)
            if result.get("state") != "READY" or result.get("url") != url:
                raise ChatGPTError("网页会话尚未恢复", code="SESSION_LOST")
            self.conversation_id = url
            self.parent_message_id = self.last_message_id = None
            self._needs_new = False
            return result

    def stop(self):
        with self._lock:
            target_id = self._active_request_id
        if target_id is None:
            raise ChatGPTError("当前没有可停止的回答", code="UNKNOWN_REQUEST")
        return self._call("stop", target_id=target_id)

    def close(self):
        pass

    def chat(self, prompt, *, model=None, on_text: Callable | None = None,
             on_event: Callable | None = None):
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("消息不能为空")
        selected_model = model or self.model
        if selected_model not in (None, "current", "auto"):
            raise ChatGPTError("当前 DOM 适配器不支持指定模型，请使用网页当前模型", code="UNSUPPORTED_CAPABILITY")
        if self.thinking_effort is not None:
            raise ChatGPTError("当前 DOM 适配器不支持指定思考强度", code="UNSUPPORTED_CAPABILITY")
        if self._needs_new:
            # The async facade overrides new_conversation(); this code runs in its worker thread.
            ChatGPTClient.new_conversation(self)
        text = ""
        revision = 0
        emitted = ""
        finished = False
        try:
            stream = self._bridge().stream("chat", text=prompt, client_session_id=self.client_session_id)
            for event in stream:
                event_type = event.get("type")
                if event_type == "chat.accepted":
                    with self._lock:
                        self._active_request_id = event.get("request_id")
                elif event_type == "chat.delta":
                    new_revision = event.get("revision")
                    if not isinstance(new_revision, int) or new_revision != revision + 1:
                        raise ChatGPTError("回答修订序号无效", code="EVENT_GAP", partial_text=text)
                    revision = new_revision
                    piece = event.get("text")
                    if not isinstance(piece, str):
                        raise ChatGPTError("回答增量格式无效", code="BAD_EVENT", partial_text=text)
                    text += piece
                elif event_type == "chat.snapshot":
                    new_revision = event.get("revision")
                    if not isinstance(new_revision, int) or new_revision != revision + 1:
                        raise ChatGPTError("回答修订序号无效", code="EVENT_GAP", partial_text=text)
                    revision = new_revision
                    snapshot = event.get("text")
                    if not isinstance(snapshot, str):
                        raise ChatGPTError("回答快照格式无效", code="BAD_EVENT", partial_text=text)
                    text = snapshot
                elif event_type == "chat.error":
                    raise ChatGPTError(event.get("message") or event.get("code") or "网页对话失败",
                                       code=event.get("code", "PAGE_ERROR"), partial_text=text)
                elif event_type == "chat.cancelled":
                    raise ChatGPTError("网页回答已停止", code="CANCELLED", partial_text=text)
                elif event_type == "chat.completed":
                    if event.get("revision") != revision:
                        raise ChatGPTError("最终修订序号不一致", code="EVENT_GAP", partial_text=text)
                    raw = text.encode("utf-8")
                    if len(raw) != event.get("bytes") or hashlib.sha256(raw).hexdigest() != event.get("sha256"):
                        raise ChatGPTError("最终回答与页面校验值不一致", code="INCOMPLETE_OUTPUT", partial_text=text)
                    if not text:
                        raise ChatGPTError("网页返回空回答", code="EMPTY_OUTPUT")
                    self.conversation_id = event.get("url")
                    finished = True
                if on_text and event_type in {"chat.delta", "chat.snapshot", "chat.completed"}:
                    # The active paragraph can be replaced during DOM rendering. Keep it
                    # pending; the SDK stream can only append already published text.
                    boundary = text.rfind("\n\n")
                    stable = text if finished else text[:boundary + 2] if boundary >= 0 else ""
                    if not text.startswith(emitted):
                        if finished:
                            raise ChatGPTError("已发送的回复发生修订，无法追加最终文本",
                                               code="STREAM_REVISED", partial_text=text)
                    elif stable.startswith(emitted) and len(stable) > len(emitted):
                        on_text(stable[len(emitted):])
                        emitted = stable
                if on_event:
                    on_event(event)
            if not finished:
                raise ChatGPTError("对话没有可信终态", code="UNKNOWN", partial_text=text)
            return text
        except BridgeError as exc:
            raise ChatGPTError(str(exc), code=exc.code, partial_text=text) from exc
        finally:
            with self._lock:
                self._active_request_id = None


def main(argv=None):
    parser = argparse.ArgumentParser(description="通过 Edge ChatGPT 页面进行对话")
    parser.add_argument("prompt", nargs="?")
    parser.add_argument("--model")
    parser.add_argument("--list-models", action="store_true")
    parser.add_argument("--health", action="store_true")
    args = parser.parse_args(argv)
    client = ChatGPTClient(model=args.model)
    try:
        if args.health:
            print(client.health())
        elif args.list_models:
            print(client.list_models()["current_model"])
        elif args.prompt:
            client.chat(args.prompt, on_text=lambda chunk: print(chunk, end="", flush=True))
            print()
        else:
            parser.error("请提供消息、--health 或 --list-models")
        return 0
    except (RuntimeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

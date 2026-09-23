"""One-shot JSON-line adapter for the desktop web-service model providers."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from pathlib import Path


def emit(kind: str, **values) -> None:
    sys.stdout.buffer.write((json.dumps({"type": kind, **values}, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


def session_path(provider: str, session_id: str) -> Path:
    root = Path(os.environ.get("OPENCODE_WEB_SERVICE_STATE_DIR", str(Path.home() / ".opencode-web-service")))
    root.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha256(f"{provider}\0{session_id}".encode("utf-8")).hexdigest()
    return root / f"{name}.json"


def load_state(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def save_state(path: Path, value: dict) -> None:
    temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def deepseek(
    session_id: str,
    prompt: str,
    *,
    reset: bool,
    system_hash: str,
    thinking_enabled: bool,
    search_enabled: bool,
) -> None:
    from deepseek_edge_auth import EdgeAuthError, EdgeBrowserAuth
    from deepseek_web_api import Conversation, DeepSeekClient, DeepSeekConfig, DeepSeekError

    auth = EdgeBrowserAuth()
    try:
        auth.get_credentials()
    except EdgeAuthError as error:
        try:
            client = DeepSeekClient()
        except DeepSeekError as fallback_error:
            raise RuntimeError(str(error)) from fallback_error
    else:
        client = DeepSeekClient(config=DeepSeekConfig(token=""), auth_provider=auth)

    path = session_path("deepseek-web", session_id)
    state = load_state(path)
    if reset or state.get("in_flight") or not state.get("session_id") or state.get("system_hash") != system_hash:
        remote = client.create_session()
        state = {
            "session_id": remote.session_id,
            "model_type": remote.model_type,
            "parent_message_id": None,
        }

    conversation = Conversation(
        client,
        session_id=state["session_id"],
        model_type=state.get("model_type"),
    )
    conversation.parent_message_id = state.get("parent_message_id")
    state["in_flight"] = True
    state["system_hash"] = system_hash
    save_state(path, state)
    final_text = ""
    try:
        for event in conversation.stream(
            prompt,
            thinking_enabled=thinking_enabled,
            search_enabled=search_enabled,
        ):
            if event.text:
                emit("delta", text=event.text)
            if event.snapshot is not None:
                final_text = event.snapshot
            state["parent_message_id"] = conversation.parent_message_id
            save_state(path, state)
    except DeepSeekError as error:
        raise RuntimeError(str(error)) from error
    if not final_text:
        raise RuntimeError("DeepSeek 网页没有返回最终文本")
    state["in_flight"] = False
    save_state(path, state)
    emit("result", text=final_text)


def chatgpt(session_id: str, prompt: str, *, full_prompt: str, reset: bool, system_hash: str) -> None:
    from chatgpt_web_api import ChatGPTClient, ChatGPTError

    path = session_path("chatgpt-web", session_id)
    state = load_state(path)
    if not state.get("client_session_id"):
        state["client_session_id"] = str(uuid.uuid4())
        state["conversation_url"] = None

    client = ChatGPTClient(client_session_id=state["client_session_id"])
    reset = reset or state.get("in_flight") or state.get("system_hash") != system_hash
    if reset and state.get("in_flight"):
        stop_chatgpt(session_id)
    if reset:
        client.new_conversation()
        state["conversation_url"] = None
    elif state.get("conversation_url"):
        try:
            client.open_conversation(state["conversation_url"])
        except ChatGPTError as error:
            if error.code != "SESSION_LOST":
                raise
            client.new_conversation()
            state["conversation_url"] = None
            prompt = full_prompt
    else:
        client.new_conversation()
    state["in_flight"] = True
    state["system_hash"] = system_hash
    save_state(path, state)

    def on_event(event: dict) -> None:
        if event.get("type") == "chat.accepted" and isinstance(event.get("request_id"), str):
            state["active_request_id"] = event["request_id"]
            save_state(path, state)
        if event.get("type") == "chat.completed" and isinstance(event.get("url"), str):
            state["conversation_url"] = event["url"]
            state.pop("active_request_id", None)
            save_state(path, state)

    try:
        final_text = client.chat(
            prompt,
            on_text=lambda delta: emit("delta", text=delta),
            on_event=on_event,
        )
    except ChatGPTError as error:
        raise RuntimeError(str(error)) from error
    state["in_flight"] = False
    save_state(path, state)
    emit("result", text=final_text)


def stop_chatgpt(session_id: str) -> None:
    from chatgpt_dom_bridge import BridgeClient, BridgeError

    state = load_state(session_path("chatgpt-web", session_id))
    client_session_id = state.get("client_session_id")
    request_id = state.get("active_request_id")
    if not client_session_id:
        return
    try:
        BridgeClient(timeout=15).call(
            "stop",
            client_session_id=client_session_id,
            **({"target_id": request_id} if request_id else {}),
        )
    except BridgeError as error:
        if error.code not in {"UNKNOWN_REQUEST", "SESSION_LOST"}:
            raise


def main() -> int:
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        provider = request.get("provider")
        session_id = request.get("sessionID")
        prompt = request.get("prompt")
        full_prompt = request.get("fullPrompt")
        system_prompt = request.get("systemPrompt", "")
        if not isinstance(system_prompt, str):
            raise ValueError("系统提示格式无效")
        system_hash = hashlib.sha256(system_prompt.encode("utf-8")).hexdigest()
        reset = request.get("reset") is True
        thinking_enabled = request.get("thinkingEnabled") is True
        search_enabled = request.get("searchEnabled") is True
        operation = request.get("operation", "chat")
        if provider not in {"chatgpt-web", "deepseek-web"}:
            raise ValueError("不支持的网页模型服务")
        if not isinstance(session_id, str) or not session_id:
            raise ValueError("缺少 OpenCode 会话标识")
        if operation == "stop" and provider == "chatgpt-web":
            stop_chatgpt(session_id)
            emit("done")
            return 0
        state = load_state(session_path(provider, session_id))
        has_remote_session = bool(state.get("client_session_id")) if provider == "chatgpt-web" else bool(state.get("session_id"))
        reset = reset or state.get("in_flight") is True or not has_remote_session or state.get("system_hash") != system_hash
        if reset:
            prompt = full_prompt
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("当前网页模型只接收文本消息")
        if provider == "chatgpt-web":
            chatgpt(
                session_id,
                prompt,
                full_prompt=full_prompt,
                reset=reset,
                system_hash=system_hash,
            )
        else:
            deepseek(
                session_id,
                prompt,
                reset=reset,
                system_hash=system_hash,
                thinking_enabled=thinking_enabled,
                search_enabled=search_enabled,
            )
        emit("done")
        return 0
    except Exception as error:
        emit("error", message=str(error) or error.__class__.__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

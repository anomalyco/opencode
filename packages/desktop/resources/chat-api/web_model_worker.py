"""One-shot JSON-line adapter for the desktop web-service model providers."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path


MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
FILE_PARSE_TIMEOUT_SECONDS = 180
CHATGPT_MIN_REQUEST_INTERVAL_SECONDS = 60
CHATGPT_REQUEST_WINDOW_SECONDS = 10 * 60
CHATGPT_MAX_REQUESTS_PER_WINDOW = 4
CHATGPT_RESTRICTION_COOLDOWN_SECONDS = 60 * 60


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


def wait_for_chatgpt_budget(state: dict) -> None:
    now = time.time()
    blocked_until = state.get("blocked_until")
    if isinstance(blocked_until, (int, float)) and blocked_until > now:
        minutes = max(1, int((blocked_until - now + 59) // 60))
        raise RuntimeError(f"WEB_SAFETY_COOLDOWN: ChatGPT 网页已触发异常活动保护，请至少等待 {minutes} 分钟后手动继续")

    request_times = [
        value
        for value in state.get("request_times", [])
        if isinstance(value, (int, float)) and value > now - CHATGPT_REQUEST_WINDOW_SECONDS
    ]
    state["request_times"] = request_times
    if len(request_times) >= CHATGPT_MAX_REQUESTS_PER_WINDOW:
        minutes = max(1, int((request_times[0] + CHATGPT_REQUEST_WINDOW_SECONDS - now + 59) // 60))
        raise RuntimeError(f"WEB_SAFETY_COOLDOWN: 为降低网页账号风控风险，连续请求已暂停，请等待 {minutes} 分钟后手动继续")
    if request_times:
        time.sleep(max(0, CHATGPT_MIN_REQUEST_INTERVAL_SECONDS - (now - request_times[-1])))


def decode_attachments(value) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("附件列表格式无效")
    attachments = []
    total_bytes = 0
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("附件格式无效")
        filename = item.get("filename")
        media_type = item.get("mediaType")
        encoded = item.get("data")
        if not isinstance(filename, str) or not filename or len(filename) > 255:
            raise ValueError("附件名称无效")
        if not isinstance(media_type, str) or not media_type or len(media_type) > 255:
            raise ValueError("附件类型无效")
        if not isinstance(encoded, str):
            raise ValueError("附件数据格式无效")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("附件 Base64 数据无效") from error
        if not content:
            raise ValueError("附件内容不能为空")
        total_bytes += len(content)
        if total_bytes > MAX_ATTACHMENT_BYTES:
            raise ValueError("网页模型附件总大小不能超过 20 MB")
        attachments.append({"filename": filename, "media_type": media_type, "content": content, "data": encoded})
    return attachments


def save_generated_files(session_id: str, project_directory: str | None, output_path: str | None, value) -> list[str]:
    attachments = decode_attachments(value)
    if not attachments:
        return []
    if not project_directory:
        raise ValueError("无法确定当前项目目录，网页生成文件未保存")

    root = Path(project_directory).resolve()
    requested = output_path or f"generated/chatgpt-web/{hashlib.sha256(session_id.encode('utf-8')).hexdigest()[:12]}"
    target = Path(requested)
    target = (target if target.is_absolute() else root / target).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError("生成文件路径必须位于当前项目目录内") from error

    directory = requested.endswith(("/", "\\")) or not target.suffix or target.is_dir()
    if directory:
        target.mkdir(parents=True, exist_ok=True)

    saved = []
    for index, attachment in enumerate(attachments):
        filename = re.sub(r"[/\\<>:\"|?*\x00-\x1f]", "_", Path(attachment["filename"].replace("\\", "/")).name)
        if not filename or filename in {".", ".."}:
            filename = f"generated-file-{index + 1}{media_extension(attachment['media_type'])}"
        destination = target / filename if directory else target
        if not directory and index:
            destination = target.with_name(f"{target.stem}-{index + 1}{target.suffix}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        original = destination
        suffix = 2
        while destination.exists():
            destination = original.with_name(f"{original.stem}-{suffix}{original.suffix}")
            suffix += 1
        with destination.open("xb") as output:
            output.write(attachment["content"])
        saved.append(destination.relative_to(root).as_posix())
    return saved


def media_extension(media_type: str) -> str:
    return {
        "image/avif": ".avif",
        "image/gif": ".gif",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/svg+xml": ".svg",
        "image/webp": ".webp",
        "application/pdf": ".pdf",
    }.get(media_type.lower(), ".bin")


def deepseek(
    session_id: str,
    prompt: str,
    *,
    reset: bool,
    system_hash: str,
    thinking_enabled: bool,
    search_enabled: bool,
    attachments: list[dict] | None = None,
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
    ref_file_ids = []
    for attachment in attachments or []:
        ref_file_ids.append(
            client.upload_file(
                attachment["filename"],
                attachment["media_type"],
                attachment["content"],
            )
        )
    if ref_file_ids:
        wait_for_deepseek_files(client, ref_file_ids)
    state["in_flight"] = True
    state["system_hash"] = system_hash
    save_state(path, state)
    final_text = ""
    try:
        for event in conversation.stream(
            prompt,
            thinking_enabled=thinking_enabled,
            search_enabled=search_enabled,
            ref_file_ids=ref_file_ids,
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


def chatgpt(
    session_id: str,
    prompt: str,
    *,
    full_prompt: str,
    reset: bool,
    system_hash: str,
    attachments: list[dict] | None = None,
    project_directory: str | None = None,
    output_path: str | None = None,
) -> None:
    from chatgpt_web_api import ChatGPTClient, ChatGPTError

    path = session_path("chatgpt-web", session_id)
    state = load_state(path)
    wait_for_chatgpt_budget(state)
    if not state.get("client_session_id"):
        state["client_session_id"] = str(uuid.uuid4())
        state["conversation_url"] = None

    client = ChatGPTClient(client_session_id=state["client_session_id"])
    requested_reset = reset
    reset = (
        reset
        or (not state.get("in_flight") and state.get("system_hash") != system_hash)
        or not state.get("conversation_url")
    )
    if state.get("in_flight") and not state.get("conversation_url") and not requested_reset:
        raise RuntimeError("上一条网页请求状态不确定，尚未取得网页会话 ID；检查专用标签页后显式重置网页会话")
    if reset and state.get("in_flight"):
        stop_chatgpt(session_id)
    if reset:
        client.new_conversation()
        state["conversation_url"] = None
        prompt = full_prompt
    elif state.get("conversation_url"):
        client.open_conversation(state["conversation_url"])
    else:
        client.new_conversation()
    state["in_flight"] = True
    state["request_submitted"] = False
    state["system_hash"] = system_hash
    save_state(path, state)

    generated_paths = []
    artifact_warnings = []

    def on_event(event: dict) -> None:
        if event.get("type") == "chat.accepted" and isinstance(event.get("request_id"), str):
            state["active_request_id"] = event["request_id"]
        if event.get("type") == "chat.submitted":
            state["request_submitted"] = True
            now = time.time()
            state["request_times"] = [
                value
                for value in state.get("request_times", [])
                if isinstance(value, (int, float)) and value > now - CHATGPT_REQUEST_WINDOW_SECONDS
            ] + [now]
            url = event.get("url")
            if isinstance(url, str) and url.startswith("https://chatgpt.com/c/"):
                state["conversation_url"] = url
        if event.get("type") == "chat.error":
            url = event.get("url")
            if isinstance(url, str) and url.startswith("https://chatgpt.com/c/"):
                state["conversation_url"] = url
            if event.get("submitted") is False:
                state["in_flight"] = False
                state.pop("active_request_id", None)
            if event.get("code") == "ACCOUNT_RESTRICTED":
                state["blocked_until"] = time.time() + CHATGPT_RESTRICTION_COOLDOWN_SECONDS
                state["in_flight"] = False
                state["request_submitted"] = False
                state.pop("active_request_id", None)
        if event.get("type") == "chat.cancelled":
            state["in_flight"] = False
            state.pop("active_request_id", None)
        if event.get("type") == "chat.completed" and isinstance(event.get("url"), str):
            state["conversation_url"] = event["url"]
            state["in_flight"] = False
            state["request_submitted"] = False
            state.pop("active_request_id", None)
            save_state(path, state)
            generated_paths.extend(
                save_generated_files(session_id, project_directory, output_path, event.get("files"))
            )
            if event.get("media_capture_failed") is True:
                artifact_warnings.append("网页显示了生成文件，但浏览器无法安全读取其内容；请从专用 ChatGPT 页面手动下载。")
        save_state(path, state)

    try:
        final_text = client.chat(
            prompt,
            on_text=lambda delta: emit("delta", text=delta),
            on_event=on_event,
            attachments=[
                {"filename": item["filename"], "mediaType": item["media_type"], "data": item["data"]}
                for item in attachments or []
            ],
        )
    except ChatGPTError as error:
        raise RuntimeError(str(error)) from error
    state["in_flight"] = False
    state["request_submitted"] = False
    state.pop("active_request_id", None)
    save_state(path, state)
    for generated_path in generated_paths:
        emit("artifact", path=generated_path)
    for warning in artifact_warnings:
        emit("artifact-warning", message=warning)
    emit("result", text=final_text)


def wait_for_deepseek_files(client, file_ids: list[str]) -> None:
    terminal_errors = {
        "FAILED",
        "CONTENT_FILTER",
        "CONTENT_TOO_LONG",
        "CANCELLED",
        "CONTENT_EMPTY",
        "_CUSTOM_SYSTEM_ERROR_FAIL",
    }
    deadline = time.monotonic() + FILE_PARSE_TIMEOUT_SECONDS
    while True:
        files = client.fetch_files(file_ids)
        by_id = {str(item.get("id")): item for item in files if item.get("id") is not None}
        for file_id in file_ids:
            item = by_id.get(file_id)
            if item is None:
                continue
            status = item.get("status")
            if status in terminal_errors:
                detail = item.get("error_message") or item.get("error_code") or status
                raise RuntimeError(f"DeepSeek 附件解析失败：{detail}")
            if status not in {"PENDING", "PARSING", "SUCCESS"}:
                raise RuntimeError(f"DeepSeek 返回未知附件状态：{status}")
        if len(by_id) == len(file_ids) and all(by_id[file_id].get("status") == "SUCCESS" for file_id in file_ids):
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("等待 DeepSeek 附件解析超时")
        time.sleep(3)


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
        attachments = decode_attachments(request.get("attachments"))
        project_directory = request.get("projectDirectory")
        output_path = request.get("outputPath")
        if project_directory is not None and not isinstance(project_directory, str):
            raise ValueError("项目目录格式无效")
        if output_path is not None and not isinstance(output_path, str):
            raise ValueError("生成文件路径格式无效")
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
        has_remote_session = bool(state.get("conversation_url")) if provider == "chatgpt-web" else bool(state.get("session_id"))
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
                attachments=attachments,
                project_directory=project_directory,
                output_path=output_path,
            )
        else:
            deepseek(
                session_id,
                prompt,
                reset=reset,
                system_hash=system_hash,
                thinking_enabled=thinking_enabled,
                search_enabled=search_enabled,
                attachments=attachments,
            )
        emit("done")
        return 0
    except Exception as error:
        emit("error", message=str(error) or error.__class__.__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

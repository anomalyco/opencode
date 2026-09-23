"""Small client for the authenticated DeepSeek web chat API.

This module mirrors the request shape used by the DeepSeek web application. It
is intentionally separate from the official DeepSeek API: the web endpoint is
undocumented and may change without notice.

Authentication is read from the DEEPSEEK_TOKEN environment variable (or the
file named by DEEPSEEK_TOKEN_FILE). Tokens and cookies are never written by
this module.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional, Tuple

import requests
from deepseek_delta import DeltaDecoder


BASE_URL = "https://chat.deepseek.com"
CREATE_SESSION_PATH = "/api/v0/chat_session/create"
COMPLETION_PATH = "/api/v0/chat/completion"
POW_CHALLENGE_PATH = "/api/v0/chat/create_pow_challenge"
CLIENT_VERSION = "2.5.0"
CLIENT_BUNDLE_ID = "com.deepseek.chat"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
)


def _normalize_token(value: str) -> str:
    """Accept both a raw token and the localStorage storage envelope."""

    text = value.strip()
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(parsed, dict) and isinstance(parsed.get("value"), str):
        return parsed["value"].strip()
    if isinstance(parsed, str):
        return parsed.strip()
    return text


class DeepSeekError(RuntimeError):
    """Base error raised by this client."""


class DeepSeekConfigError(DeepSeekError):
    """Raised when credentials or client settings are missing."""


class DeepSeekAPIError(DeepSeekError):
    """Raised when the web API returns an error."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        biz_code: Optional[int] = None,
        response_body: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.biz_code = biz_code
        self.response_body = response_body


@dataclass(frozen=True)
class DeepSeekConfig:
    """Connection settings for the web client.

    ``token`` and ``cookie`` are excluded from repr output so accidental
    logging of the config does not expose credentials.
    """

    token: str = field(repr=False)
    device_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    device_model: str = ""
    cookie: Optional[str] = field(default=None, repr=False)
    base_url: str = BASE_URL
    locale: str = "zh_CN"
    timezone_offset_seconds: int = field(default_factory=lambda: _local_timezone_offset())
    client_version: str = CLIENT_VERSION
    user_agent: str = DEFAULT_USER_AGENT
    timeout_seconds: float = 60.0

    @classmethod
    def from_env(cls) -> "DeepSeekConfig":
        token = _normalize_token(os.environ.get("DEEPSEEK_TOKEN", ""))
        token_file = os.environ.get("DEEPSEEK_TOKEN_FILE", "").strip()
        if not token and token_file:
            try:
                with open(token_file, "r", encoding="utf-8") as handle:
                    token = _normalize_token(handle.read())
            except OSError as exc:
                raise DeepSeekConfigError(
                    f"无法读取 DEEPSEEK_TOKEN_FILE: {token_file}"
                ) from exc
        if not token:
            raise DeepSeekConfigError(
                "未找到 DeepSeek 网页令牌，请设置 DEEPSEEK_TOKEN，"
                "或设置 DEEPSEEK_TOKEN_FILE 指向仅当前用户可读的文件。"
            )

        timeout_text = os.environ.get("DEEPSEEK_TIMEOUT_SECONDS", "60")
        try:
            timeout_seconds = float(timeout_text)
        except ValueError as exc:
            raise DeepSeekConfigError("DEEPSEEK_TIMEOUT_SECONDS 必须是数字") from exc

        return cls(
            token=token,
            device_id=os.environ.get("DEEPSEEK_DEVICE_ID", "").strip()
            or str(uuid.uuid4()),
            device_model=os.environ.get("DEEPSEEK_DEVICE_MODEL", ""),
            cookie=os.environ.get("DEEPSEEK_COOKIE") or None,
            base_url=os.environ.get("DEEPSEEK_BASE_URL", BASE_URL).rstrip("/"),
            locale=os.environ.get("DEEPSEEK_LOCALE", "zh_CN"),
            timezone_offset_seconds=_local_timezone_offset(),
            client_version=os.environ.get("DEEPSEEK_CLIENT_VERSION", CLIENT_VERSION),
            user_agent=os.environ.get("DEEPSEEK_USER_AGENT", DEFAULT_USER_AGENT),
            timeout_seconds=timeout_seconds,
        )


@dataclass(frozen=True)
class ChatSession:
    session_id: str
    model_type: str = "default"
    title: str = ""


@dataclass(frozen=True)
class StreamEvent:
    """One decoded server-sent event.

    ``text`` is populated for response deltas. ``data`` keeps the original
    decoded event payload for callers that need message IDs or metadata.
    """

    event: str
    data: Any
    text: str = ""
    snapshot: Optional[str] = None


def _local_timezone_offset() -> int:
    offset = datetime.now().astimezone().utcoffset()
    return int(offset.total_seconds()) if offset is not None else 0


def solve_pow(challenge: Dict[str, Any]) -> int:
    """Solve the site's nonstandard DeepSeekHashV1 using its pinned WASM."""

    from deepseek_pow import solve
    try:
        return solve(challenge)
    except (ValueError, KeyError, OSError) as exc:
        raise DeepSeekAPIError("工作量证明计算失败，请检查挑战字段和 WASM 文件") from exc

def _extract_biz_code(payload: Any) -> Optional[int]:
    if not isinstance(payload, dict):
        return None
    if isinstance(payload.get("code"), int) and payload["code"] != 0:
        return payload["code"]
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    value = data.get("biz_code")
    return value if isinstance(value, int) else None


def _extract_biz_message(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("biz_msg"), str):
        return data["biz_msg"]
    if isinstance(payload.get("msg"), str):
        return payload["msg"]
    return ""


def _short_body(text: str, limit: int = 1000) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[:limit] + "…"


def _parse_json_bytes(raw: bytes) -> Optional[Any]:
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8", errors="replace"))
    except (TypeError, ValueError):
        return None


def _is_pow_required(status_code: int, headers: Dict[str, str], payload: Any, body: str) -> bool:
    if status_code not in (403, 429):
        return _extract_biz_code(payload) in (40300, 40301)
    lowered = {str(k).lower(): str(v).lower() for k, v in headers.items()}
    if lowered.get("cf-mitigated") == "challenge":
        return True
    if lowered.get("x-amzn-waf-action") == "challenge":
        return True
    if _extract_biz_code(payload) in (40300, 40301):
        return True
    body_lower = body.lower()
    return "pow" in body_lower and "challenge" in body_lower


def iter_sse(response: requests.Response) -> Iterator[Tuple[Optional[str], str]]:
    """Yield ``(event_name, data)`` pairs from an SSE response."""

    event_name: Optional[str] = None
    data_lines: List[str] = []
    for raw_line in response.iter_lines(chunk_size=1, decode_unicode=False):
        if raw_line is None:
            continue
        if isinstance(raw_line, bytes):
            raw_line = raw_line.decode("utf-8", errors="replace")
        line = raw_line.rstrip("\r")
        if line == "":
            if data_lines:
                yield event_name, "\n".join(data_lines)
            event_name = None
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            value = line[5:]
            data_lines.append(value[1:] if value.startswith(" ") else value)
    if data_lines:
        yield event_name, "\n".join(data_lines)


class DeepSeekClient:
    """Authenticated client for the DeepSeek web chat endpoints."""

    def __init__(
        self,
        config: Optional[DeepSeekConfig] = None,
        session: Optional[requests.Session] = None,
        auth_provider: Optional[Callable[[], Tuple[str, str]]] = None,
    ) -> None:
        self.config = config or DeepSeekConfig.from_env()
        self.auth_provider = auth_provider
        if not self.config.token.strip() and self.auth_provider is None:
            raise DeepSeekConfigError("DeepSeek token 不能为空")
        self.http = session or requests.Session()
        self.http.headers.update({"User-Agent": self.config.user_agent})
        if self.config.cookie:
            self.http.headers["Cookie"] = self.config.cookie

    def _url(self, path: str) -> str:
        return f"{self.config.base_url}{path}"

    def _post(self, path: str, **kwargs) -> requests.Response:
        # Retry only handshake EOFs, before an HTTP response is received.
        # Never replay a partially consumed chat stream.
        for attempt in range(3):
            try:
                response = self.http.post(self._url(path), **kwargs)
            except requests.exceptions.SSLError as exc:
                if "UNEXPECTED_EOF_WHILE_READING" not in str(exc):
                    raise
                if attempt == 2:
                    raise DeepSeekAPIError(
                        "HTTPS 握手被中断，重试 3 次仍失败。请检查本机代理连接后再发送消息。"
                    ) from exc
                time.sleep(0.5 * (attempt + 1))
                continue
            if response.status_code == 429:
                response.close()
                raise DeepSeekAPIError(
                    "DeepSeek 当前限流（HTTP 429），请稍后再试。", status_code=429
                )
            return response
        raise AssertionError("unreachable")

    def _headers(self, *, stream: bool) -> Dict[str, str]:
        token = self.config.token.strip()
        device_id = self.config.device_id
        if self.auth_provider is not None:
            try:
                provided_token, provided_device_id = self.auth_provider()
            except Exception as exc:
                raise DeepSeekConfigError(f"读取 Edge DeepSeek 登录状态失败: {exc}") from exc
            token = str(provided_token or "").strip() or token
            device_id = str(provided_device_id or "").strip() or device_id
        if not token:
            raise DeepSeekConfigError("未找到 DeepSeek 网页令牌")
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "text/event-stream" if stream else "application/json",
            "Content-Type": "application/json",
            "Origin": self.config.base_url,
            "Referer": self.config.base_url + "/",
            "x-client-bundle-id": CLIENT_BUNDLE_ID,
            "x-client-platform": "web",
            "x-client-version": self.config.client_version,
            "x-client-locale": self.config.locale,
            "x-client-timezone-offset": str(self.config.timezone_offset_seconds),
            "x-device-id": device_id,
            "x-device-model": self.config.device_model,
        }

    def _post_json(self, path: str, payload: Dict[str, Any]) -> Any:
        try:
            response = self._post(
                path,
                json=payload,
                headers=self._headers(stream=False),
                timeout=self.config.timeout_seconds,
            )
        except requests.RequestException as exc:
            raise DeepSeekAPIError(f"请求 DeepSeek 失败: {exc}") from exc

        raw = response.content
        parsed = _parse_json_bytes(raw)
        if not response.ok:
            message = _extract_biz_message(parsed) or _short_body(raw.decode("utf-8", errors="replace"))
            raise DeepSeekAPIError(
                f"DeepSeek 返回 HTTP {response.status_code}: {message or '无响应正文'}",
                status_code=response.status_code,
                biz_code=_extract_biz_code(parsed),
                response_body=_short_body(raw.decode("utf-8", errors="replace")),
            )
        if parsed is None:
            raise DeepSeekAPIError("DeepSeek 返回的 JSON 无法解析")
        return parsed

    def create_session(self) -> ChatSession:
        payload = self._post_json(CREATE_SESSION_PATH, {})
        biz_code = _extract_biz_code(payload)
        if biz_code not in (None, 0):
            raise DeepSeekAPIError(
                f"创建 DeepSeek 会话失败: {_extract_biz_message(payload) or biz_code}",
                biz_code=biz_code,
            )

        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        biz_data = data.get("biz_data", {}) if isinstance(data, dict) else {}
        raw_session = biz_data.get("chat_session", {}) if isinstance(biz_data, dict) else {}
        if not isinstance(raw_session, dict) or not raw_session.get("id"):
            raise DeepSeekAPIError("创建会话响应中没有 chat_session.id")
        return ChatSession(
            session_id=str(raw_session["id"]),
            model_type=str(raw_session.get("model_type") or "default"),
            title=str(raw_session.get("title") or ""),
        )

    def _solve_pow_for_completion(self) -> str:
        payload = self._post_json(
            POW_CHALLENGE_PATH,
            {"target_path": COMPLETION_PATH},
        )
        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        biz_code = data.get("biz_code") if isinstance(data, dict) else None
        if isinstance(biz_code, int) and biz_code != 0:
            raise DeepSeekAPIError(
                f"获取工作量证明挑战失败: {_extract_biz_message(payload) or biz_code}",
                biz_code=biz_code,
            )
        biz_data = data.get("biz_data", {}) if isinstance(data, dict) else {}
        challenge = biz_data.get("challenge") if isinstance(biz_data, dict) else None
        if not isinstance(challenge, dict):
            raise DeepSeekAPIError("工作量证明响应中没有 challenge")

        answer = solve_pow(challenge)
        response_payload = {
            "algorithm": challenge.get("algorithm"),
            "challenge": challenge.get("challenge"),
            "salt": challenge.get("salt"),
            "answer": answer,
            "signature": challenge.get("signature"),
            "target_path": COMPLETION_PATH,
        }
        encoded = base64.b64encode(
            json.dumps(
                response_payload,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        ).decode("ascii")
        return encoded

    def _completion_payload(
        self,
        *,
        session_id: str,
        prompt: str,
        model_type: str,
        parent_message_id: Optional[str],
        thinking_enabled: bool,
        search_enabled: bool,
        source: Optional[str],
        action: Optional[str],
        preempt: bool,
        ref_file_ids: Iterable[str],
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "chat_session_id": session_id,
            "parent_message_id": parent_message_id,
            "model_type": model_type,
            "prompt": prompt,
            "ref_file_ids": list(ref_file_ids),
            "thinking_enabled": thinking_enabled,
            "search_enabled": search_enabled,
            "action": action,
            "preempt": preempt,
        }
        # The browser omits this property when source is undefined. Do the
        # same instead of sending an artificial null value.
        if source is not None:
            payload["source"] = source
        return payload

    def stream_completion(
        self,
        *,
        session_id: str,
        prompt: str,
        model_type: str = "default",
        parent_message_id: Optional[str] = None,
        thinking_enabled: bool = False,
        search_enabled: bool = False,
        source: Optional[str] = None,
        action: Optional[str] = None,
        preempt: bool = False,
        ref_file_ids: Iterable[str] = (),
    ) -> Iterator[StreamEvent]:
        """Send one prompt and yield decoded SSE events."""

        if not prompt.strip():
            raise DeepSeekConfigError("prompt 不能为空")
        payload = self._completion_payload(
            session_id=session_id,
            prompt=prompt,
            model_type=model_type,
            parent_message_id=parent_message_id,
            thinking_enabled=thinking_enabled,
            search_enabled=search_enabled,
            source=source,
            action=action,
            preempt=preempt,
            ref_file_ids=ref_file_ids,
        )

        pow_header: Optional[str] = self._solve_pow_for_completion()
        for attempt in range(2):
            headers = self._headers(stream=True)
            if pow_header:
                headers["X-DS-PoW-Response"] = pow_header
            try:
                response = self._post(
                    COMPLETION_PATH,
                    json=payload,
                    headers=headers,
                    stream=True,
                    timeout=(10, self.config.timeout_seconds),
                )
            except requests.RequestException as exc:
                raise DeepSeekAPIError(f"请求 DeepSeek 聊天接口失败: {exc}") from exc

            content_type = response.headers.get("content-type", "").lower()
            if response.status_code >= 400 or "text/event-stream" not in content_type:
                raw = response.content
                parsed = _parse_json_bytes(raw)
                body = raw.decode("utf-8", errors="replace")
                if attempt == 0 and _is_pow_required(
                    response.status_code,
                    dict(response.headers),
                    parsed,
                    body,
                ):
                    response.close()
                    pow_header = self._solve_pow_for_completion()
                    continue
                response.close()
                message = _extract_biz_message(parsed) or _short_body(body)
                raise DeepSeekAPIError(
                    f"DeepSeek 聊天接口返回 HTTP {response.status_code}: "
                    f"{message or '响应不是 SSE 流'}",
                    status_code=response.status_code,
                    biz_code=_extract_biz_code(parsed),
                    response_body=_short_body(body),
                )

            decoder = DeltaDecoder()
            try:
                for event_name, raw_data in iter_sse(response):
                    parsed: Any
                    try:
                        parsed = json.loads(raw_data)
                    except (TypeError, ValueError):
                        parsed = raw_data
                    kind = event_name or "delta"
                    if kind == "error":
                        raise DeepSeekAPIError(f"DeepSeek 返回流错误: {parsed}")
                    text = decoder.feed(parsed) if kind == "delta" else ""
                    yield StreamEvent(event=kind, data=parsed, text=text, snapshot=decoder.snapshot())
            except requests.RequestException as exc:
                raise DeepSeekAPIError(
                    "回复传输中断；为避免重复发送，本轮未自动重发。请检查网络后重试。"
                ) from exc
            finally:
                response.close()
            return

    def chat(
        self,
        prompt: str,
        *,
        session_id: Optional[str] = None,
        model_type: Optional[str] = None,
        parent_message_id: Optional[str] = None,
        thinking_enabled: bool = False,
        search_enabled: bool = False,
        source: Optional[str] = None,
        on_text=None,
    ) -> str:
        """Convenience method returning the complete assistant response."""

        session = None
        if not session_id:
            session = self.create_session()
            session_id = session.session_id
        if model_type is None:
            model_type = session.model_type if session else "default"

        parts: List[str] = []
        for event in self.stream_completion(
            session_id=session_id,
            prompt=prompt,
            model_type=model_type,
            parent_message_id=parent_message_id,
            thinking_enabled=thinking_enabled,
            search_enabled=search_enabled,
            source=source,
        ):
            if event.text:
                parts.append(event.text)
                if on_text is not None:
                    on_text(event.text)
        return "".join(parts)


class Conversation:
    """Keep the session and assistant parent ID for multi-turn chats."""

    def __init__(
        self,
        client: DeepSeekClient,
        *,
        session_id: Optional[str] = None,
        model_type: Optional[str] = None,
    ) -> None:
        self.client = client
        self.session: Optional[ChatSession] = None
        self.session_id = session_id
        self.model_type = model_type
        self.parent_message_id: Optional[str] = None

    def _ensure_session(self) -> None:
        if self.session_id:
            if not self.model_type:
                self.model_type = "default"
            return
        self.session = self.client.create_session()
        self.session_id = self.session.session_id
        self.model_type = self.model_type or self.session.model_type

    def stream(
        self,
        prompt: str,
        *,
        thinking_enabled: bool = False,
        search_enabled: bool = False,
        source: Optional[str] = None,
    ) -> Iterator[StreamEvent]:
        self._ensure_session()
        assert self.session_id is not None
        assert self.model_type is not None
        for event in self.client.stream_completion(
            session_id=self.session_id,
            prompt=prompt,
            model_type=self.model_type,
            parent_message_id=self.parent_message_id,
            thinking_enabled=thinking_enabled,
            search_enabled=search_enabled,
            source=source,
        ):
            if event.event == "ready" and isinstance(event.data, dict):
                response_id = event.data.get("response_message_id")
                if response_id:
                    self.parent_message_id = response_id
            yield event


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="直接请求 DeepSeek 网页聊天接口")
    parser.add_argument("prompt", nargs="?", help="要发送的消息；省略时从 stdin 读取")
    parser.add_argument("--session-id", help="复用已有网页会话 ID")
    parser.add_argument("--model-type", help="模型类型，默认使用会话返回值")
    parser.add_argument("--thinking", action="store_true", help="开启深度思考")
    parser.add_argument("--search", action="store_true", help="开启智能搜索")
    parser.add_argument("--source", help="请求 source 字段，例如 landing")
    parser.add_argument(
        "--json-events",
        action="store_true",
        help="逐行输出解码后的 SSE 事件 JSON",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    prompt = args.prompt
    if prompt is None:
        prompt = sys.stdin.read().strip()
    if not prompt:
        print("请提供 prompt，或通过 stdin 输入。", file=sys.stderr)
        return 2

    try:
        client = DeepSeekClient()
        conversation = Conversation(
            client,
            session_id=args.session_id,
            model_type=args.model_type,
        )
        if args.json_events:
            for event in conversation.stream(
                prompt,
                thinking_enabled=args.thinking,
                search_enabled=args.search,
                source=args.source,
            ):
                print(
                    json.dumps(
                        {"event": event.event, "data": event.data, "text": event.text},
                        ensure_ascii=False,
                    )
                )
        else:
            for event in conversation.stream(
                prompt,
                thinking_enabled=args.thinking,
                search_enabled=args.search,
                source=args.source,
            ):
                if event.text:
                    print(event.text, end="", flush=True)
            print()
        return 0
    except DeepSeekError as exc:
        print(f"请求失败: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

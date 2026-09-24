import io
import base64
import hashlib
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import web_model_worker


class ChatGPTRecoveryTest(unittest.TestCase):
    def test_chatgpt_budget_delays_fast_followups_and_stops_bursts(self):
        state = {"request_times": [100.0]}
        with (
            patch.object(web_model_worker.time, "time", return_value=110.0),
            patch.object(web_model_worker.time, "sleep") as sleep,
        ):
            web_model_worker.wait_for_chatgpt_budget(state)
        sleep.assert_called_once_with(50.0)

        state["request_times"] = [100.0, 200.0, 300.0, 400.0]
        with patch.object(web_model_worker.time, "time", return_value=450.0):
            with self.assertRaisesRegex(RuntimeError, "WEB_SAFETY_COOLDOWN"):
                web_model_worker.wait_for_chatgpt_budget(state)

    def test_chatgpt_budget_honors_account_restriction_cooldown(self):
        with patch.object(web_model_worker.time, "time", return_value=100.0):
            with self.assertRaisesRegex(RuntimeError, "异常活动保护"):
                web_model_worker.wait_for_chatgpt_budget({"blocked_until": 3700.0})

    def test_worker_reads_and_writes_utf8_json(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = Path(directory) / "session.json"
            requests = []

            class ChatGPTError(RuntimeError):
                pass

            class ChatGPTClient:
                def __init__(self, **_kwargs):
                    pass

                def new_conversation(self):
                    pass

                def chat(self, prompt, *, on_text, on_event, attachments=None):
                    requests.append(prompt)
                    return "你好 😀"

            class FakeStdin:
                buffer = io.BytesIO(
                    json.dumps(
                        {
                            "provider": "chatgpt-web",
                            "sessionID": "session-1",
                            "prompt": "增量输入",
                            "fullPrompt": "完整上下文：你好 😀",
                            "systemPrompt": "系统提示",
                            "reset": True,
                        },
                        ensure_ascii=False,
                    ).encode("utf-8")
                )

            class FakeStdout:
                def __init__(self):
                    self.buffer = io.BytesIO()

            fake_stdout = FakeStdout()
            fake_api = types.SimpleNamespace(ChatGPTClient=ChatGPTClient, ChatGPTError=ChatGPTError)
            with (
                patch.dict(sys.modules, {"chatgpt_web_api": fake_api}),
                patch.object(web_model_worker, "session_path", return_value=state_file),
                patch.object(web_model_worker.sys, "stdin", FakeStdin()),
                patch.object(web_model_worker.sys, "stdout", fake_stdout),
            ):
                self.assertEqual(web_model_worker.main(), 0)

            events = [json.loads(line) for line in fake_stdout.buffer.getvalue().decode("utf-8").splitlines()]
            self.assertEqual(requests, ["完整上下文：你好 😀"])
            self.assertEqual(events, [{"type": "result", "text": "你好 😀"}, {"type": "done"}])

    def test_lost_conversation_does_not_silently_create_a_new_one(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = Path(directory) / "session.json"
            state_file.write_text(
                '{"client_session_id":"client-1","conversation_url":"https://chatgpt.com/c/old",'
                '"system_hash":"system-hash"}',
                encoding="utf-8",
            )
            calls = []

            class ChatGPTError(RuntimeError):
                def __init__(self, message, *, code="CHAT_ERROR"):
                    super().__init__(message)
                    self.code = code

            class ChatGPTClient:
                def __init__(self, **_kwargs):
                    pass

                def open_conversation(self, _url):
                    raise ChatGPTError("会话不存在", code="SESSION_LOST")

                def new_conversation(self):
                    calls.append("new")

                def chat(self, prompt, *, on_text, on_event, attachments=None):
                    calls.append(prompt)
                    on_event({"type": "chat.completed", "url": "https://chatgpt.com/c/new"})
                    return "最终答复"

            fake_api = types.SimpleNamespace(ChatGPTClient=ChatGPTClient, ChatGPTError=ChatGPTError)
            with (
                patch.dict(sys.modules, {"chatgpt_web_api": fake_api}),
                patch.object(web_model_worker, "session_path", return_value=state_file),
                patch.object(web_model_worker, "emit") as emit,
            ):
                with self.assertRaisesRegex(ChatGPTError, "会话不存在"):
                    web_model_worker.chatgpt(
                        "session-1",
                        "tool result delta",
                        full_prompt="compressed full context",
                        reset=False,
                        system_hash="system-hash",
                    )

            self.assertEqual(calls, [])
            self.assertEqual(web_model_worker.load_state(state_file)["conversation_url"], "https://chatgpt.com/c/old")
            emit.assert_not_called()

    def test_response_error_retry_reuses_the_bound_web_conversation(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = Path(directory) / "session.json"
            state_file.write_text(
                '{"client_session_id":"client-1","conversation_url":"https://chatgpt.com/c/bound",'
                '"system_hash":"system-hash","in_flight":true,"request_submitted":true}',
                encoding="utf-8",
            )
            calls = []
            opened = []

            class ChatGPTError(RuntimeError):
                def __init__(self, message, *, code="CHAT_ERROR"):
                    super().__init__(message)
                    self.code = code

            class ChatGPTClient:
                def __init__(self, **_kwargs):
                    pass

                def open_conversation(self, url):
                    opened.append(url)

                def new_conversation(self):
                    calls.append("new")

                def chat(self, prompt, *, on_text, on_event, attachments=None):
                    calls.append(prompt)
                    on_event({"type": "chat.submitted", "url": "https://chatgpt.com/c/bound"})
                    if len(calls) == 1:
                        on_event({"type": "chat.error", "submitted": True, "url": "https://chatgpt.com/c/bound"})
                        raise ChatGPTError("响应暂时失败")
                    on_event({"type": "chat.completed", "url": "https://chatgpt.com/c/bound"})
                    return "恢复后的答复"

            fake_api = types.SimpleNamespace(ChatGPTClient=ChatGPTClient, ChatGPTError=ChatGPTError)
            with (
                patch.dict(sys.modules, {"chatgpt_web_api": fake_api}),
                patch.object(web_model_worker, "session_path", return_value=state_file),
                patch.object(web_model_worker, "emit"),
                patch.object(web_model_worker.time, "sleep"),
            ):
                with self.assertRaisesRegex(RuntimeError, "响应暂时失败"):
                    web_model_worker.chatgpt(
                        "session-1", "同一轮请求", full_prompt="完整上下文", reset=False, system_hash="system-hash"
                    )
                web_model_worker.chatgpt(
                    "session-1", "同一轮请求", full_prompt="完整上下文", reset=False, system_hash="system-hash"
                )

            self.assertEqual(opened, ["https://chatgpt.com/c/bound", "https://chatgpt.com/c/bound"])
            self.assertEqual(calls, ["同一轮请求", "同一轮请求"])
            self.assertEqual(web_model_worker.load_state(state_file)["conversation_url"], "https://chatgpt.com/c/bound")

    def test_uncertain_first_request_does_not_create_a_replacement_conversation(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = Path(directory) / "session.json"
            state_file.write_text(
                '{"client_session_id":"client-1","system_hash":"system-hash","in_flight":true}',
                encoding="utf-8",
            )
            calls = []

            class ChatGPTClient:
                def __init__(self, **_kwargs):
                    pass

                def new_conversation(self):
                    calls.append("new")

            with (
                patch.dict(
                    sys.modules,
                    {"chatgpt_web_api": types.SimpleNamespace(ChatGPTClient=ChatGPTClient, ChatGPTError=RuntimeError)},
                ),
                patch.object(web_model_worker, "session_path", return_value=state_file),
            ):
                with self.assertRaisesRegex(RuntimeError, "状态不确定"):
                    web_model_worker.chatgpt(
                        "session-1", "新输入", full_prompt="完整上下文", reset=False, system_hash="system-hash"
                    )

            self.assertEqual(calls, [])

    def test_client_id_without_conversation_sends_full_context(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = Path(directory) / "session.json"
            state_file.write_text(
                '{"client_session_id":"client-1","system_hash":"system-hash","in_flight":false}',
                encoding="utf-8",
            )
            calls = []

            class ChatGPTClient:
                def __init__(self, **_kwargs):
                    pass

                def new_conversation(self):
                    calls.append("new")

                def chat(self, prompt, *, on_text, on_event, attachments=None):
                    calls.append(prompt)
                    on_event({"type": "chat.completed", "url": "https://chatgpt.com/c/new"})
                    return "最终答复"

            with (
                patch.dict(
                    sys.modules,
                    {"chatgpt_web_api": types.SimpleNamespace(ChatGPTClient=ChatGPTClient, ChatGPTError=RuntimeError)},
                ),
                patch.object(web_model_worker, "session_path", return_value=state_file),
                patch.object(web_model_worker, "emit"),
            ):
                web_model_worker.chatgpt(
                    "session-1",
                    "增量输入",
                    full_prompt="完整上下文",
                    reset=False,
                    system_hash="system-hash",
                )

            self.assertEqual(calls, ["new", "完整上下文"])
            self.assertEqual(web_model_worker.load_state(state_file)["conversation_url"], "https://chatgpt.com/c/new")

    def test_chatgpt_forwards_file_payloads_to_the_page_bridge(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = Path(directory) / "session.json"
            calls = []
            image = b"\x89PNG\r\n"
            encoded = base64.b64encode(image).decode("ascii")

            class ChatGPTClient:
                def __init__(self, **_kwargs):
                    pass

                def new_conversation(self):
                    pass

                def chat(self, prompt, *, on_text, on_event, attachments=None):
                    calls.append((prompt, attachments))
                    on_event({"type": "chat.completed", "url": "https://chatgpt.com/c/new"})
                    return "已读取图片"

            request = {
                "provider": "chatgpt-web",
                "sessionID": "session-1",
                "prompt": "请查看图片",
                "fullPrompt": "完整上下文",
                "systemPrompt": "系统提示",
                "reset": True,
                "attachments": [{"filename": "screen.png", "mediaType": "image/png", "data": encoded}],
            }

            class FakeStdin:
                buffer = io.BytesIO(json.dumps(request, ensure_ascii=False).encode("utf-8"))

            class FakeStdout:
                def __init__(self):
                    self.buffer = io.BytesIO()

            fake_stdout = FakeStdout()
            with (
                patch.dict(sys.modules, {"chatgpt_web_api": types.SimpleNamespace(ChatGPTClient=ChatGPTClient, ChatGPTError=RuntimeError)}),
                patch.object(web_model_worker, "session_path", return_value=state_file),
                patch.object(web_model_worker.sys, "stdin", FakeStdin()),
                patch.object(web_model_worker.sys, "stdout", fake_stdout),
            ):
                self.assertEqual(web_model_worker.main(), 0)

            self.assertEqual(
                calls,
                [("完整上下文", [{"filename": "screen.png", "mediaType": "image/png", "data": encoded}])],
            )
            events = [json.loads(line) for line in fake_stdout.buffer.getvalue().decode("utf-8").splitlines()]
            self.assertEqual(events, [{"type": "result", "text": "已读取图片"}, {"type": "done"}])

    def test_decode_attachments_checks_base64_and_total_size(self):
        decoded = web_model_worker.decode_attachments(
            [{"filename": "note.md", "mediaType": "text/markdown", "data": base64.b64encode(b"hello").decode("ascii") }]
        )
        self.assertEqual(decoded[0]["content"], b"hello")
        with self.assertRaisesRegex(ValueError, "Base64"):
            web_model_worker.decode_attachments([{"filename": "bad", "mediaType": "text/plain", "data": "%%%"}])

    def test_saves_generated_files_inside_the_project_without_overwriting(self):
        with tempfile.TemporaryDirectory() as directory:
            encoded = base64.b64encode(b"image-bytes").decode("ascii")
            attachment = [{"filename": "generated-image-1.png", "mediaType": "image/png", "data": encoded}]
            first = web_model_worker.save_generated_files("session-1", directory, "assets/cover.png", attachment)
            second = web_model_worker.save_generated_files("session-1", directory, "assets/cover.png", attachment)

            self.assertEqual(first, ["assets/cover.png"])
            self.assertEqual(second, ["assets/cover-2.png"])
            self.assertEqual((Path(directory) / "assets" / "cover.png").read_bytes(), b"image-bytes")
            self.assertEqual((Path(directory) / "assets" / "cover-2.png").read_bytes(), b"image-bytes")
            with self.assertRaisesRegex(ValueError, "当前项目目录"):
                web_model_worker.save_generated_files("session-1", directory, "../outside.png", attachment)

    def test_chatgpt_completion_saves_generated_files_and_reports_project_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_file = root / "session.json"
            encoded = base64.b64encode(b"generated-image").decode("ascii")
            emitted = []

            class ChatGPTClient:
                def __init__(self, **_kwargs):
                    pass

                def new_conversation(self):
                    pass

                def chat(self, prompt, *, on_text, on_event, attachments=None):
                    on_event({
                        "type": "chat.completed",
                        "revision": 0,
                        "bytes": 0,
                        "sha256": hashlib.sha256(b"").hexdigest(),
                        "url": "https://chatgpt.com/c/session-1",
                        "files": [{"filename": "generated-image-1.png", "mediaType": "image/png", "data": encoded}],
                        "media_output": True,
                    })
                    return ""

            with (
                patch.dict(
                    sys.modules,
                    {"chatgpt_web_api": types.SimpleNamespace(ChatGPTClient=ChatGPTClient, ChatGPTError=RuntimeError)},
                ),
                patch.object(web_model_worker, "session_path", return_value=state_file),
                patch.object(web_model_worker, "emit", side_effect=lambda kind, **values: emitted.append((kind, values))),
            ):
                web_model_worker.chatgpt(
                    "session-1",
                    "生成图片",
                    full_prompt="生成图片",
                    reset=True,
                    system_hash="system-hash",
                    project_directory=directory,
                    output_path="assets/cover.png",
                )

            self.assertEqual((root / "assets" / "cover.png").read_bytes(), b"generated-image")
            self.assertIn(("artifact", {"path": "assets/cover.png"}), emitted)
            self.assertIn(("result", {"text": ""}), emitted)

    def test_waits_for_deepseek_file_parse_before_sending(self):
        class Client:
            def __init__(self):
                self.polls = 0

            def fetch_files(self, file_ids):
                self.polls += 1
                status = "PENDING" if self.polls == 1 else "SUCCESS"
                return [{"id": file_ids[0], "status": status}]

        client = Client()
        with patch.object(web_model_worker.time, "sleep"):
            web_model_worker.wait_for_deepseek_files(client, ["file-1"])
        self.assertEqual(client.polls, 2)

    def test_deepseek_upload_ids_are_bound_to_the_current_session(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = Path(directory) / "session.json"
            calls = []

            class EdgeAuthError(RuntimeError):
                pass

            class EdgeBrowserAuth:
                def get_credentials(self):
                    return "token", "device"

            class DeepSeekError(RuntimeError):
                pass

            class DeepSeekClient:
                def __init__(self, **_kwargs):
                    pass

                def create_session(self):
                    return types.SimpleNamespace(session_id="remote-session", model_type="default")

                def upload_file(self, filename, media_type, content):
                    calls.append(("upload", filename, media_type, content))
                    return "file-1"

                def fetch_files(self, file_ids):
                    calls.append(("fetch", file_ids))
                    return [{"id": "file-1", "status": "SUCCESS"}]

            class Conversation:
                def __init__(self, _client, *, session_id, model_type):
                    self.session_id = session_id
                    self.model_type = model_type
                    self.parent_message_id = None

                def stream(self, prompt, *, thinking_enabled, search_enabled, ref_file_ids):
                    calls.append(("completion", self.session_id, prompt, ref_file_ids))
                    yield types.SimpleNamespace(text="回复", snapshot="回复")

            attachment = {"filename": "note.md", "media_type": "text/markdown", "content": b"hello"}
            fake_auth = types.SimpleNamespace(EdgeAuthError=EdgeAuthError, EdgeBrowserAuth=EdgeBrowserAuth)
            fake_api = types.SimpleNamespace(
                Conversation=Conversation,
                DeepSeekClient=DeepSeekClient,
                DeepSeekConfig=lambda **_kwargs: object(),
                DeepSeekError=DeepSeekError,
            )
            with (
                patch.dict(sys.modules, {"deepseek_edge_auth": fake_auth, "deepseek_web_api": fake_api}),
                patch.object(web_model_worker, "session_path", return_value=state_file),
                patch.object(web_model_worker, "emit") as emit,
            ):
                web_model_worker.deepseek(
                    "session-1",
                    "请查看附件",
                    reset=True,
                    system_hash="system-hash",
                    thinking_enabled=False,
                    search_enabled=True,
                    attachments=[attachment],
                )

            self.assertEqual(calls[0], ("upload", "note.md", "text/markdown", b"hello"))
            self.assertEqual(calls[1], ("fetch", ["file-1"]))
            self.assertEqual(calls[2], ("completion", "remote-session", "请查看附件", ["file-1"]))
            emit.assert_any_call("result", text="回复")

    def test_uncertain_request_without_id_still_attempts_page_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = Path(directory) / "session.json"
            state_file.write_text('{"client_session_id":"client-1"}', encoding="utf-8")
            calls = []

            class BridgeClient:
                def __init__(self, **_kwargs):
                    pass

                def call(self, operation, **kwargs):
                    calls.append((operation, kwargs))

            class BridgeError(RuntimeError):
                code = "BRIDGE_ERROR"

            with (
                patch.dict(
                    sys.modules,
                    {"chatgpt_dom_bridge": types.SimpleNamespace(BridgeClient=BridgeClient, BridgeError=BridgeError)},
                ),
                patch.object(web_model_worker, "session_path", return_value=state_file),
            ):
                web_model_worker.stop_chatgpt("session-1")

            self.assertEqual(calls, [("stop", {"client_session_id": "client-1"})])


if __name__ == "__main__":
    unittest.main()

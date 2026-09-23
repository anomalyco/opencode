import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import web_model_worker


class ChatGPTRecoveryTest(unittest.TestCase):
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

                def chat(self, prompt, *, on_event):
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

    def test_lost_conversation_resets_before_sending_full_context(self):
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

                def chat(self, prompt, *, on_event):
                    calls.append(prompt)
                    on_event({"type": "chat.completed", "url": "https://chatgpt.com/c/new"})
                    return "最终答复"

            fake_api = types.SimpleNamespace(ChatGPTClient=ChatGPTClient, ChatGPTError=ChatGPTError)
            with (
                patch.dict(sys.modules, {"chatgpt_web_api": fake_api}),
                patch.object(web_model_worker, "session_path", return_value=state_file),
                patch.object(web_model_worker, "emit") as emit,
            ):
                web_model_worker.chatgpt(
                    "session-1",
                    "tool result delta",
                    full_prompt="compressed full context",
                    reset=False,
                    system_hash="system-hash",
                )

            self.assertEqual(calls, ["new", "compressed full context"])
            self.assertEqual(web_model_worker.load_state(state_file)["conversation_url"], "https://chatgpt.com/c/new")
            emit.assert_called_once_with("result", text="最终答复")

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

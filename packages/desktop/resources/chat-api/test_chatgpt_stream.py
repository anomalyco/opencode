import hashlib
import unittest

from chatgpt_web_api import ChatGPTClient, ChatGPTError


class EventBridge:
    def __init__(self, events, text):
        self.events = events
        self.text = text
        self.completed = False

    def stream(self, operation, **payload):
        yield from self.events
        self.completed = True
        raw = self.text.encode("utf-8")
        yield {"type": "chat.completed", "revision": len(self.events),
               "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


class ChatGPTStreamTest(unittest.TestCase):
    def chat(self, events, final, on_text):
        bridge = EventBridge(events, final)
        client = ChatGPTClient(bridge=bridge)
        client._needs_new = False
        return client.chat("聊聊周末散步", on_text=lambda text: on_text(text, bridge.completed))

    def test_streams_paragraphs_before_completion_and_flushes_tail(self):
        chunks = []
        final = "可以去公园散步。\n\n记得带水 😀"
        result = self.chat([
            {"type": "chat.delta", "revision": 1, "text": "可以去公园散步。\n\n记得"},
            {"type": "chat.delta", "revision": 2, "text": "带水 😀"},
        ], final, lambda text, completed: chunks.append((text, completed)))
        self.assertEqual(result, final)
        self.assertEqual(chunks, [("可以去公园散步。\n\n", False), ("记得带水 😀", True)])

    def test_pending_paragraph_revision_keeps_complete_reply(self):
        chunks = []
        final = "周末愉快。\n\n去公园走走吧。"
        result = self.chat([
            {"type": "chat.delta", "revision": 1, "text": "周末愉快。\n\n去公"},
            {"type": "chat.snapshot", "revision": 2, "text": "周末愉快。\n\n"},
            {"type": "chat.delta", "revision": 3, "text": "去公园走走吧。"},
        ], final, lambda text, _: chunks.append(text))
        self.assertEqual(result, final)
        self.assertEqual("".join(chunks), final)

    def test_never_silently_accepts_rewritten_published_text(self):
        with self.assertRaises(ChatGPTError) as raised:
            self.chat([
                {"type": "chat.delta", "revision": 1, "text": "原文。\n\n尾段"},
                {"type": "chat.snapshot", "revision": 2, "text": "改写全文。"},
            ], "改写全文。", lambda *_: None)
        self.assertEqual(raised.exception.code, "STREAM_REVISED")

    def test_hash_mismatch_does_not_flush_unverified_tail(self):
        chunks = []
        with self.assertRaises(ChatGPTError) as raised:
            self.chat([{"type": "chat.delta", "revision": 1, "text": "不完整"}],
                      "完整回答", lambda text, _: chunks.append(text))
        self.assertEqual(raised.exception.code, "INCOMPLETE_OUTPUT")
        self.assertEqual(chunks, [])


if __name__ == "__main__":
    unittest.main()

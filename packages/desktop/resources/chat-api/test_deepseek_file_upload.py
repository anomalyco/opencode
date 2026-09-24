import json
import unittest

from deepseek_web_api import (
    BASE_URL,
    FETCH_FILES_PATH,
    UPLOAD_FILE_PATH,
    Conversation,
    DeepSeekClient,
    DeepSeekConfig,
    StreamEvent,
)


class Response:
    def __init__(self, value, status_code=200):
        self.content = json.dumps(value).encode("utf-8")
        self.status_code = status_code
        self.headers = {"content-type": "application/json"}
        self.ok = status_code < 400

    def close(self):
        pass


class Http:
    def __init__(self):
        self.headers = {}
        self.posts = []
        self.gets = []

    def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        return Response({"data": {"biz_code": 0, "biz_data": {"id": "file-1"}}})

    def get(self, url, **kwargs):
        self.gets.append((url, kwargs))
        return Response({"data": {"biz_code": 0, "biz_data": {"files": [{"id": "file-1", "status": "SUCCESS"}]}}})


class DeepSeekFileUploadTest(unittest.TestCase):
    def test_upload_uses_multipart_and_returns_server_file_id(self):
        http = Http()
        client = DeepSeekClient(config=DeepSeekConfig(token="token"), session=http)

        def solve(target_path):
            self.assertEqual(target_path, UPLOAD_FILE_PATH)
            return "proof"

        client._solve_pow = solve

        self.assertEqual(client.upload_file("note.md", "text/markdown", b"notes"), "file-1")

        url, request = http.posts[0]
        self.assertEqual(url, BASE_URL + UPLOAD_FILE_PATH)
        self.assertEqual(request["files"]["file"], ("note.md", b"notes", "text/markdown"))
        self.assertNotIn("Content-Type", request["headers"])
        self.assertEqual(request["headers"]["X-DS-PoW-Response"], "proof")

    def test_fetch_files_and_conversation_bind_server_ids(self):
        http = Http()
        client = DeepSeekClient(config=DeepSeekConfig(token="token"), session=http)
        self.assertEqual(client.fetch_files(["file-1"]), [{"id": "file-1", "status": "SUCCESS"}])
        self.assertEqual(http.gets[0][0], BASE_URL + FETCH_FILES_PATH)
        self.assertEqual(http.gets[0][1]["params"], [("file_ids", "file-1")])

        calls = []

        class CompletionClient:
            def stream_completion(self, **kwargs):
                calls.append(kwargs)
                yield StreamEvent(event="done", data={})

        conversation = Conversation(CompletionClient(), session_id="session-1", model_type="default")
        list(conversation.stream("Review the upload", ref_file_ids=["file-1"]))
        self.assertEqual(calls[0]["session_id"], "session-1")
        self.assertEqual(calls[0]["ref_file_ids"], ["file-1"])


if __name__ == "__main__":
    unittest.main()

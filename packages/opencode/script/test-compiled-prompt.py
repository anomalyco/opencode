"""Exercise a supplied native binary using isolated state and a loopback-only provider."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("binary", type=Path)
parser.add_argument(
    "--artifacts-dir",
    type=Path,
    help="Machine-local directory for retained test artefacts",
)
parser.add_argument("--expect-bun", default="1.4.2")
args = parser.parse_args()
if os.name != "posix":
    parser.error("This regression currently requires a POSIX host.")
if sys.flags.optimize:
    parser.error("Run without Python optimisation: this regression uses assertions.")
if not args.binary.is_file():
    parser.error("The compiled binary must exist.")
root = Path(
    tempfile.mkdtemp(prefix="compiled-prompt-", dir=args.artifacts_dir)
).resolve()
# Report the runtime from inside the compiled server, not the build shell.
(root / "runtime.js").write_text(
    "export default async () => { await Bun.write("
    + json.dumps(str(root / "runtime.json"))
    + ", JSON.stringify({version:Bun.version,revision:Bun.revision})); return {}; };\n"
)
(root / "project").mkdir()
(root / "project" / "fixture.txt").write_text("COMPILED_TOOL_OK\n")
requests = []


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        requests.append(body)
        (root / "provider-requests.json").write_text(json.dumps(requests, indent=2))
        assert self.path == "/v1/chat/completions", self.path
        tool_results = [m for m in body["messages"] if m["role"] == "tool"]
        if not tool_results:
            delta = {
                "role": "assistant",
                "tool_calls": [
                    {
                        "index": 0,
                        "id": "call_fixture",
                        "type": "function",
                        "function": {
                            "name": "read",
                            "arguments": json.dumps(
                                {"filePath": str(root / "project" / "fixture.txt")}
                            ),
                        },
                    }
                ],
            }
            reason = "tool_calls"
        else:
            assert "COMPILED_TOOL_OK" in json.dumps(tool_results), tool_results
            delta = {
                "role": "assistant",
                "content": (
                    "COMPILED_PROMPT_OK" if len(requests) == 2 else "SECOND_TURN_OK"
                ),
            }
            reason = "stop"
        chunk = {
            "id": "chatcmpl_mock",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "mock",
            "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
        }
        end = dict(
            chunk,
            choices=[{"index": 0, "delta": {}, "finish_reason": reason}],
            usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        )
        data = (
            "".join("data: " + json.dumps(x) + "\n\n" for x in (chunk, end))
            + "data: [DONE]\n\n"
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(data.encode())))
        self.end_headers()
        self.wfile.write(data.encode())


mock = ThreadingHTTPServer(("127.0.0.1", 0), Mock)
threading.Thread(target=mock.serve_forever, daemon=True).start()
config = {
    "$schema": "https://opencode.ai/config.json",
    "autoupdate": False,
    "plugin": [(root / "runtime.js").as_uri()],
    "mcp": {},
    "lsp": False,
    "model": "mock/mock",
    "small_model": "mock/mock",
    "enabled_providers": ["mock"],
    "permission": {"*": "allow"},
    "agent": {"title": {"disable": True}, "summary": {"disable": True}},
    "provider": {
        "mock": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "Local deterministic mock",
            "options": {
                "baseURL": f"http://127.0.0.1:{mock.server_port}/v1",
                "apiKey": "local-test-not-a-secret",
            },
            "models": {
                "mock": {"name": "mock", "limit": {"context": 32000, "output": 2000}}
            },
        }
    },
}
(root / "config.json").write_text(json.dumps(config))
(root / "models.json").write_text("{}")
env = {
    "PATH": "/usr/bin:/bin",
    "HOME": str(root / "home"),
    "OPENCODE_CONFIG": str(root / "config.json"),
    "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
    "OPENCODE_DISABLE_DEFAULT_PLUGINS": "1",
    "OPENCODE_DISABLE_EXTERNAL_SKILLS": "1",
    "OPENCODE_DISABLE_MODELS_FETCH": "1",
    "OPENCODE_MODELS_PATH": str(root / "models.json"),
    "OPENCODE_DISABLE_AUTOUPDATE": "1",
    "OPENCODE_SERVER_PASSWORD": "local-regression-only",
}
for key in ("DATA", "CONFIG", "CACHE", "STATE"):
    env[f"XDG_{key}_HOME"] = str(root / key.lower())
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
url = f"http://127.0.0.1:{port}"
# Do not send local requests through proxies inherited from the caller.
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api(path, body=None):
    request = urllib.request.Request(
        url + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "x-opencode-directory": str(root / "project"),
            "Authorization": "Basic "
            + base64.b64encode(b"opencode:local-regression-only").decode(),
        },
    )
    try:
        with http.open(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error


print("ARTIFACTS", root, flush=True)
with (root / "server.log").open("wb") as log:
    server = subprocess.Popen(
        [
            str(args.binary.resolve()),
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            str(port),
            "--print-logs",
        ],
        cwd=root / "project",
        env=env,
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
    try:
        for attempt in range(100):
            try:
                health = api("/global/health")
                break
            except OSError:
                assert server.poll() is None, "server exited"
                time.sleep(0.1)
        else:
            raise RuntimeError("health timeout")
        print("HEALTH", health, flush=True)
        assert health["healthy"] is True, health
        # Initialisation runs custom plugins and must use only this isolated config.
        effective = api("/config")
        assert effective["enabled_providers"] == ["mock"], effective
        runtime = json.loads((root / "runtime.json").read_text())
        assert runtime["version"] == args.expect_bun, runtime
        session = api("/session", {})
        result = api(
            "/session/" + session["id"] + "/message",
            {
                "model": {"providerID": "mock", "modelID": "mock"},
                "parts": [
                    {"type": "text", "text": "Read fixture.txt then report the result."}
                ],
            },
        )
        (root / "first.json").write_text(json.dumps(result, indent=2))
        assert result["info"].get("error") is None, result
        assert any(
            p["type"] == "text" and p["text"] == "COMPILED_PROMPT_OK"
            for p in result["parts"]
        ), result
        result2 = api(
            "/session/" + session["id"] + "/message",
            {
                "model": {"providerID": "mock", "modelID": "mock"},
                "parts": [
                    {
                        "type": "text",
                        "text": "Confirm that you retained the previous tool result.",
                    }
                ],
            },
        )
        (root / "second.json").write_text(json.dumps(result2, indent=2))
        assert result2["info"].get("error") is None, result2
        assert any(
            p["type"] == "text" and p["text"] == "SECOND_TURN_OK"
            for p in result2["parts"]
        ), result2
        messages = api("/session/" + session["id"] + "/message")
        (root / "messages.json").write_text(json.dumps(messages, indent=2))
        assert len(requests) == 3, len(requests)
        tools = [p for m in messages for p in m["parts"] if p["type"] == "tool"]
        assert len(tools) == 1 and tools[0]["tool"] == "read", tools
        assert tools[0]["state"]["status"] == "completed", tools
        assert "COMPILED_TOOL_OK" in tools[0]["state"]["output"], tools
        print(
            json.dumps(
                {
                    "passed": True,
                    "health": health,
                    "runtime": runtime,
                    "provider_requests": len(requests),
                    "sha256": hashlib.sha256(args.binary.read_bytes()).hexdigest(),
                    "artifacts": str(root),
                }
            )
        )
    finally:
        print("PROVIDER_REQUESTS", len(requests), flush=True)
        if server.poll() is None:
            os.killpg(server.pid, signal.SIGTERM)
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(server.pid, signal.SIGKILL)
            server.wait()
        mock.shutdown()
        mock.server_close()

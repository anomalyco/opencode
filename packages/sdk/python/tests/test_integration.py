import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

from opencode_ai import OpenCodeClient


@pytest.mark.timeout(30)
def test_integration_live_server_endpoints() -> None:
    # Locate repo root by finding sst.config.ts upwards from this file
    here = Path(__file__).resolve()
    p = here
    repo_root = None
    for _ in range(8):
        if (p / "sst.config.ts").exists():
            repo_root = p
            break
        if p.parent == p:
            break
        p = p.parent
    assert repo_root is not None, "Could not locate repo root (sst.config.ts)"

    # Start opencode headless server on a random port
    pkg_opencode = repo_root / "packages" / "opencode"
    cmd = [
        "bun",
        "run",
        "--conditions=development",
        "./src/index.ts",
        "serve",
        "--port",
        "0",
        "--hostname",
        "127.0.0.1",
    ]

    proc = subprocess.Popen(
        cmd,
        cwd=str(pkg_opencode),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )

    url = None
    start = time.time()
    assert proc.stdout is not None
    while time.time() - start < 15:
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.05)
            if proc.poll() is not None:
                break
            continue
        m = re.search(r"opencode server listening on (http://[^\s]+)", line)
        if m:
            url = m.group(1)
            break
    assert url, "Server did not report listening URL"

    try:
        client = OpenCodeClient(base_url=url)
        # Basic endpoints (avoid complex config model parsing issues)
        pinfo = client.get_path()
        assert pinfo is not None
        projects = client.list_projects()
        assert projects is not None

        # SSE: should get the initial server.connected event
        it = client.subscribe_events()
        evt = next(it)
        assert isinstance(evt, dict)
        assert evt.get("type") == "server.connected"
    finally:
        # Cleanup server process
        try:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
        except Exception:
            pass

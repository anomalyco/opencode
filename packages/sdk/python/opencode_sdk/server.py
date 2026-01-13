"""Server management for OpenCode SDK.

This module provides functionality to spawn and manage OpenCode server processes.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import select
import subprocess
import time
from dataclasses import dataclass
from typing import Any, cast

from .types import Config


@dataclass
class ServerOptions:
    """Options for creating an OpenCode server."""

    hostname: str = "127.0.0.1"
    port: int = 4096
    timeout: float = 5.0
    config: Config | None = None


@dataclass
class TuiOptions:
    """Options for creating an OpenCode TUI."""

    project: str | None = None
    model: str | None = None
    session: str | None = None
    agent: str | None = None
    config: Config | None = None


@dataclass
class Server:
    """Represents a running OpenCode server."""

    url: str
    _process: subprocess.Popen[bytes]

    def close(self) -> None:
        """Stop the server process."""
        self._process.terminate()
        try:
            self._process.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            self._process.kill()


@dataclass
class AsyncServer:
    """Represents a running OpenCode server (async version)."""

    url: str
    _process: asyncio.subprocess.Process

    def close(self) -> None:
        """Stop the server process."""
        self._process.terminate()


@dataclass
class Tui:
    """Represents a running OpenCode TUI."""

    _process: subprocess.Popen[bytes]

    def close(self) -> None:
        """Stop the TUI process."""
        self._process.terminate()
        try:
            self._process.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            self._process.kill()


def create_opencode_server(options: ServerOptions | None = None) -> Server:
    """Create and start an OpenCode server.

    Args:
        options: Server configuration options.

    Returns:
        A Server instance with the URL and close method.

    Raises:
        TimeoutError: If the server doesn't start within the timeout.
        RuntimeError: If the server fails to start.
    """
    opts = options or ServerOptions()

    args = [
        "opencode",
        "serve",
        f"--hostname={opts.hostname}",
        f"--port={opts.port}",
    ]

    if opts.config:
        log_level = opts.config.get("logLevel")
        if log_level:
            args.append(f"--log-level={log_level}")

    env = os.environ.copy()
    env["OPENCODE_CONFIG_CONTENT"] = json.dumps(opts.config or {})

    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )

    output = ""

    start_time = time.time()
    while time.time() - start_time < opts.timeout:
        if proc.poll() is not None:
            stdout, stderr = proc.communicate()
            output = stdout.decode() + stderr.decode()
            raise RuntimeError(
                f"Server exited with code {proc.returncode}\nServer output: {output}"
            )

        if proc.stdout:
            ready, _, _ = select.select([proc.stdout], [], [], 0.1)
            if ready:
                chunk = proc.stdout.read(4096)
                if chunk:
                    output += chunk.decode()
                    for line in output.split("\n"):
                        if line.startswith("opencode server listening"):
                            match = re.search(r"on\s+(https?://[^\s]+)", line)
                            if match:
                                return Server(url=match.group(1), _process=proc)
                            raise RuntimeError(
                                f"Failed to parse server url from output: {line}"
                            )

    proc.terminate()
    raise TimeoutError(f"Timeout waiting for server to start after {opts.timeout}s")


async def create_opencode_server_async(options: ServerOptions | None = None) -> AsyncServer:
    """Create and start an OpenCode server (async version).

    Args:
        options: Server configuration options.

    Returns:
        An AsyncServer instance with the URL and close method.

    Raises:
        TimeoutError: If the server doesn't start within the timeout.
        RuntimeError: If the server fails to start.
    """
    opts = options or ServerOptions()

    args = [
        "opencode",
        "serve",
        f"--hostname={opts.hostname}",
        f"--port={opts.port}",
    ]

    if opts.config:
        log_level = opts.config.get("logLevel")
        if log_level:
            args.append(f"--log-level={log_level}")

    env = os.environ.copy()
    env["OPENCODE_CONFIG_CONTENT"] = json.dumps(opts.config or {})

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )

    output = ""

    async def read_output() -> str:
        nonlocal output
        while True:
            if proc.stdout is None:
                break
            chunk = await proc.stdout.read(4096)
            if not chunk:
                break
            output += chunk.decode()
            for line in output.split("\n"):
                if line.startswith("opencode server listening"):
                    match = re.search(r"on\s+(https?://[^\s]+)", line)
                    if match:
                        return match.group(1)
                    raise RuntimeError(f"Failed to parse server url from output: {line}")
        return ""

    try:
        url = await asyncio.wait_for(read_output(), timeout=opts.timeout)
        if url:
            return AsyncServer(url=url, _process=proc)
        raise RuntimeError("Server failed to start")
    except asyncio.TimeoutError:
        proc.terminate()
        raise TimeoutError(f"Timeout waiting for server to start after {opts.timeout}s")


def create_opencode_tui(options: TuiOptions | None = None) -> Tui:
    """Create and start an OpenCode TUI.

    Args:
        options: TUI configuration options.

    Returns:
        A Tui instance with the close method.
    """
    opts = options or TuiOptions()

    args = ["opencode"]

    if opts.project:
        args.append(f"--project={opts.project}")
    if opts.model:
        args.append(f"--model={opts.model}")
    if opts.session:
        args.append(f"--session={opts.session}")
    if opts.agent:
        args.append(f"--agent={opts.agent}")

    env = os.environ.copy()
    env["OPENCODE_CONFIG_CONTENT"] = json.dumps(opts.config or {})

    proc = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )

    return Tui(_process=proc)

"""Helpers for launching a local opencode server in tests and scripts.

Mirrors `createOpencodeServer` in the JS SDK: spawns the `opencode` binary in
`serve` mode, waits for the "listening on" line, and returns a handle whose
`close()` shuts the process down cleanly.

For async callers, wrap the sync helper with `asyncio.to_thread` or use
`AsyncServerHandle.create()` which spawns and waits for readiness on the
event loop.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Any

_LISTENING_RE = re.compile(r"opencode server listening on\s+(https?://[^\s]+)")


@dataclass
class ServerOptions:
    hostname: str = "127.0.0.1"
    port: int = 4096
    timeout: float = 5.0
    binary: str = "opencode"
    config: dict[str, Any] | None = None
    env: dict[str, str] | None = None
    extra_args: list[str] = field(default_factory=list)


def _build_command(options: ServerOptions) -> list[str]:
    return [
        options.binary,
        "serve",
        f"--hostname={options.hostname}",
        f"--port={options.port}",
        *options.extra_args,
    ]


def _build_env(options: ServerOptions) -> dict[str, str]:
    env = dict(os.environ)
    if options.env:
        env.update(options.env)
    if options.config is not None:
        env["OPENCODE_CONFIG_CONTENT"] = json.dumps(options.config)
    return env


@dataclass
class ServerHandle:
    url: str
    process: subprocess.Popen[bytes]

    def close(self, timeout: float = 5.0) -> None:
        if self.process.poll() is not None:
            return
        try:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=timeout)
                return
            except subprocess.TimeoutExpired:
                pass
            self.process.kill()
            self.process.wait(timeout=timeout)
        except ProcessLookupError:
            pass

    def __enter__(self) -> ServerHandle:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


def create_opencode_server(options: ServerOptions | None = None) -> ServerHandle:
    """Spawn an opencode server and block until it prints its listen URL."""
    options = options or ServerOptions()
    proc = subprocess.Popen(
        _build_command(options),
        env=_build_env(options),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + options.timeout
    output = bytearray()
    url: str | None = None
    try:
        while time.monotonic() < deadline:
            assert proc.stdout is not None
            chunk = proc.stdout.read1(4096)
            if not chunk:
                if proc.poll() is not None:
                    raise RuntimeError(
                        f"opencode server exited (code={proc.returncode}) before listening. "
                        f"Output:\n{output.decode(errors='replace')}"
                    )
                time.sleep(0.05)
                continue
            output.extend(chunk)
            match = _LISTENING_RE.search(output.decode(errors="replace"))
            if match:
                url = match.group(1)
                break
        if url is None:
            raise TimeoutError(
                f"opencode server did not start within {options.timeout}s. Output:\n{output.decode(errors='replace')}"
            )
    except BaseException:
        try:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=2.0)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        raise

    def _drain() -> None:
        try:
            assert proc.stdout is not None
            for _ in iter(lambda: proc.stdout.read1(4096), b""):
                pass
        except Exception:
            pass

    threading.Thread(target=_drain, daemon=True).start()
    return ServerHandle(url=url, process=proc)


@dataclass
class AsyncServerHandle:
    url: str
    process: asyncio.subprocess.Process

    @classmethod
    async def create(cls, options: ServerOptions | None = None) -> AsyncServerHandle:
        options = options or ServerOptions()
        proc = await asyncio.create_subprocess_exec(
            *_build_command(options),
            env=_build_env(options),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        loop = asyncio.get_event_loop()
        deadline = loop.time() + options.timeout
        output = bytearray()
        url: str | None = None
        try:
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    raise TimeoutError(
                        f"opencode server did not start within {options.timeout}s. "
                        f"Output:\n{output.decode(errors='replace')}"
                    )
                assert proc.stdout is not None
                try:
                    chunk = await asyncio.wait_for(proc.stdout.read(4096), timeout=remaining)
                except asyncio.TimeoutError:
                    continue
                if not chunk:
                    if proc.returncode is not None:
                        raise RuntimeError(
                            f"opencode server exited (code={proc.returncode}) before listening. "
                            f"Output:\n{output.decode(errors='replace')}"
                        )
                    await asyncio.sleep(0.05)
                    continue
                output.extend(chunk)
                match = _LISTENING_RE.search(output.decode(errors="replace"))
                if match:
                    url = match.group(1)
                    break
        except BaseException:
            try:
                proc.send_signal(signal.SIGTERM)
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
            raise

        async def _drain() -> None:
            try:
                assert proc.stdout is not None
                while True:
                    chunk = await proc.stdout.read(4096)
                    if not chunk:
                        return
            except Exception:
                pass

        asyncio.ensure_future(_drain())
        return cls(url=url, process=proc)

    async def aclose(self, timeout: float = 5.0) -> None:
        if self.process.returncode is not None:
            return
        try:
            self.process.send_signal(signal.SIGTERM)
            try:
                await asyncio.wait_for(self.process.wait(), timeout=timeout)
                return
            except asyncio.TimeoutError:
                pass
            self.process.kill()
            await asyncio.wait_for(self.process.wait(), timeout=timeout)
        except ProcessLookupError:
            pass

    async def __aenter__(self) -> AsyncServerHandle:
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()

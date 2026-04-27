#!/usr/bin/env python3
"""Hermes API-server bridge shim.

Starts only Hermes Agent's APIServerAdapter so the TypeScript bridge can talk
to Hermes over a local OpenAI-compatible HTTP surface without booting the full
messaging gateway stack.

Boot protocol:
    First stdout line after successful boot is "LISTEN_PORT:<port>\n".
    On fatal boot error, prints "BOOT_ERROR:<message>\n" and exits 1.
"""

import argparse
import asyncio
import os
import signal
import socket
import sys
import traceback


def _eprint(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _announce(msg: str) -> None:
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Hermes API bridge shim")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=0, help="0 = auto-pick")
    p.add_argument("--hermes-dir", required=True, help="Path to Hermes Agent project root")
    p.add_argument("--hermes-home", help="Optional HERMES_HOME override")
    p.add_argument("--key", required=True, help="Bearer key used for the local API server")
    p.add_argument("--model-name", default="hermes-agent")
    return p.parse_args()


def _find_port(host: str, preferred: int) -> int:
    if preferred != 0:
        return preferred
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def _validate_dir(root: str) -> None:
    if not os.path.isdir(root):
        raise RuntimeError(f"--hermes-dir does not exist or is not a directory: {root}")
    marker = os.path.join(root, "gateway", "platforms", "api_server.py")
    if os.path.isfile(marker):
        return
    raise RuntimeError(f"Hermes checkout missing gateway/platforms/api_server.py in {root}")


async def _boot(args: argparse.Namespace, port: int):
    root = os.path.abspath(args.hermes_dir)
    _validate_dir(root)
    if args.hermes_home:
        os.environ["HERMES_HOME"] = args.hermes_home
    os.environ["API_SERVER_ENABLED"] = "true"
    os.environ["API_SERVER_HOST"] = args.host
    os.environ["API_SERVER_PORT"] = str(port)
    os.environ["API_SERVER_KEY"] = args.key
    os.environ["API_SERVER_MODEL_NAME"] = args.model_name

    sys.path.insert(0, root)
    os.chdir(root)

    from gateway.config import PlatformConfig
    from gateway.platforms.api_server import APIServerAdapter

    cfg = PlatformConfig(
        enabled=True,
        extra={
            "host": args.host,
            "port": port,
            "key": args.key,
            "model_name": args.model_name,
        },
    )
    app = APIServerAdapter(cfg)
    ok = await app.connect()
    if ok:
        _eprint(
            "[INFO hermes_shim] api_server ready "
            f"host={args.host} port={port} home={os.environ.get('HERMES_HOME', '~/.hermes')}"
        )
        return app
    raise RuntimeError("APIServerAdapter.connect() returned false")


async def _main() -> int:
    args = _parse_args()
    port = _find_port(args.host, args.port)
    try:
        app = await _boot(args, port)
    except Exception as err:  # noqa: BLE001
        _announce(f"BOOT_ERROR:{err}")
        _eprint(traceback.format_exc())
        return 1

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()

    def _shutdown() -> None:
        _eprint("[INFO hermes_shim] shutdown requested")
        stop.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _shutdown)
        except (NotImplementedError, RuntimeError):
            signal.signal(sig, lambda *_args: _shutdown())

    _announce(f"LISTEN_PORT:{port}")

    try:
        await stop.wait()
    finally:
        try:
            await app.disconnect()
        except Exception as err:  # noqa: BLE001
            _eprint(f"[WARN hermes_shim] disconnect failed: {err}")
    return 0


def main() -> int:
    return asyncio.run(_main())


if __name__ == "__main__":
    sys.exit(main())

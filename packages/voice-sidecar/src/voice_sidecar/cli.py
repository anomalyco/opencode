"""Voice sidecar CLI — Phase 0 STT and Phase 1 opencode control plane.

Transcript/reply text goes to stdout; status and errors go to stderr.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .opencode import OpencodeError
from .stt import STTError, default_stt


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _make_live_printer(stop: "object", once: bool):
    """Print interim/chunk results live on stderr; commit final utterances to stdout.

    `stop` is an asyncio.Event; in `--once` mode it's set after the first
    `speech_final` so the stream tears down after one utterance.
    """

    def on_event(event: dict) -> None:
        kind = event.get("type")
        if kind == "transcript.partial":
            text = event.get("text", "")
            if event.get("speech_final"):
                _log("\r\033[K")  # clear the live line
                print(text, flush=True)  # final utterance → stdout (decider unit)
                if once:
                    stop.set()  # type: ignore[attr-defined]
            else:
                tag = "▸" if event.get("is_final") else "·"  # chunk-final vs interim
                print(f"\r\033[K{tag} {text}", end="", file=sys.stderr, flush=True)
        elif kind == "transcript.done":
            print("\r\033[K", end="", file=sys.stderr, flush=True)

    return on_event


def cmd_listen(args: argparse.Namespace) -> int:
    import asyncio
    import signal

    from .stream import XaiStreamingSTT, mic_frames

    try:
        stt = XaiStreamingSTT(language=args.language, sample_rate=args.sample_rate)
    except STTError as exc:
        _log(f"error: {exc}")
        return 1

    async def go() -> None:
        try:
            await stt.check_auth()
        except STTError as exc:
            _log(f"error: {exc}")
            return
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        try:
            loop.add_signal_handler(signal.SIGINT, stop.set)
        except (NotImplementedError, RuntimeError):
            pass  # e.g. Windows; falls back to KeyboardInterrupt
        hint = "one utterance" if args.once else "Ctrl-C to stop"
        _log(f"Listening (live)… speak now ({hint})")
        printer = _make_live_printer(stop, args.once)
        await stt.stream(mic_frames(args.sample_rate, args.device, stop), printer)

    try:
        asyncio.run(go())
    except KeyboardInterrupt:
        _log("\ncancelled")
        return 130
    return 0


def cmd_ask(args: argparse.Namespace) -> int:
    """Text → opencode → reply. Exercises the control plane without a mic."""
    from .opencode import OpencodeClient

    text = " ".join(args.text).strip()
    if not text:
        _log("nothing to ask")
        return 1
    client = OpencodeClient(url=args.server)
    session_id = args.session or client.create_session(args.agent)
    _log(f"session {session_id} — submitting to opencode…")
    reply = client.run_turn(session_id, text, args.agent)
    print(reply or "(no reply)")
    return 0


def cmd_converse(args: argparse.Namespace) -> int:
    """Voice loop: speak a command → opencode runs it → print the reply. Repeat."""
    import asyncio

    from .opencode import OpencodeClient
    from .listen import listen_once_terminal
    from .stream import XaiStreamingSTT

    try:
        stt = XaiStreamingSTT(language=args.language, sample_rate=args.sample_rate)
    except STTError as exc:
        _log(f"error: {exc}")
        return 1
    client = OpencodeClient(url=args.server)
    if client.directory.endswith("voice-sidecar"):
        _log(f"warning: workspace is {client.directory} — set OPENCODE_DIRECTORY to your repo")

    async def go() -> None:
        try:
            await asyncio.to_thread(client._request, "GET", "/global/health")
        except OpencodeError as exc:
            _log(f"error: {exc}")
            return

        session_id = args.session or await asyncio.to_thread(client.create_session, args.agent)
        model = await asyncio.to_thread(client._resolve_model)
        _log(f"converse · session {session_id}")
        _log(f"  model {model['providerID']}/{model['modelID']} · workspace {client.directory}")
        _log(f"  server {client.url}")
        hint = "one utterance" if args.once else "Ctrl-C to quit"
        _log(f"ready — speak a command ({hint})")

        while True:
            _log("listening…")
            try:
                text = await listen_once_terminal(stt, sample_rate=args.sample_rate, device=args.device)
            except STTError as exc:
                _log(f"stt error: {exc}")
                continue
            if not text:
                _log("didn't catch that — try again")
                continue
            print(f"🗣  {text}")
            _log("working…")
            try:
                reply = await asyncio.to_thread(
                    lambda: client.run_turn(session_id, text, args.agent, log_model=False)
                )
            except OpencodeError as exc:
                _log(f"opencode error: {exc}")
                continue
            print(f"🤖 {reply or '(no reply)'}\n")
            if args.once:
                break

    try:
        asyncio.run(go())
    except KeyboardInterrupt:
        _log("\nbye")
    return 0


def cmd_transcribe(args: argparse.Namespace) -> int:
    stt = default_stt()
    path = Path(args.file)
    if not path.exists():
        _log(f"error: file not found: {path}")
        return 2
    text = stt.transcribe(path.read_bytes())
    print(text)
    return 0


def cmd_devices(_args: argparse.Namespace) -> int:
    from .audio import list_devices

    print(list_devices())
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    """Run the Phase 2 voice HTTP service."""
    import os

    import uvicorn

    log_level = os.environ.get("VOICE_SIDECAR_LOG_LEVEL") or "warning"
    uvicorn.run(
        "voice_sidecar.server:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        log_level=log_level,
    )
    return 0


def _add_mic_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--language", default=None, help="language code, e.g. en (default en)")
    parser.add_argument("--sample-rate", dest="sample_rate", type=int, default=16000, help="capture sample rate (default 16000)")
    parser.add_argument("--device", default=None, help="input device id or name")


def _add_opencode_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--server",
        default=None,
        help="opencode server URL (default: auto-discover from ~/.local/state/opencode or http://127.0.0.1:4096)",
    )
    parser.add_argument("--session", default=None, help="existing session id (default: create one)")
    parser.add_argument("--agent", default=None, help="agent name when creating a session")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="voice-stt",
        description="opencode voice sidecar — local STT and opencode session control",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    # Default (no subcommand) → live listen with sensible defaults.
    parser.set_defaults(
        func=cmd_listen,
        once=False,
        language=None,
        sample_rate=16000,
        device=None,
    )

    sub = parser.add_subparsers(dest="command")

    listen = sub.add_parser("listen", help="live-transcribe from the mic (streaming)")
    listen.add_argument("--once", action="store_true", help="stop after the first complete utterance")
    _add_mic_args(listen)
    listen.set_defaults(func=cmd_listen)

    ask = sub.add_parser("ask", help="send text to opencode and print the reply (control-plane smoke test)")
    ask.add_argument("text", nargs="+", help="command to submit")
    _add_opencode_args(ask)
    ask.set_defaults(func=cmd_ask)

    converse = sub.add_parser("converse", help="voice loop: speak → opencode → print reply, repeat")
    converse.add_argument("--once", action="store_true", help="stop after one complete utterance")
    _add_mic_args(converse)
    _add_opencode_args(converse)
    converse.set_defaults(func=cmd_converse)

    transcribe = sub.add_parser("transcribe", help="transcribe an existing wav file")
    transcribe.add_argument("file", help="path to a 16-bit PCM wav file")
    transcribe.set_defaults(func=cmd_transcribe)

    devices = sub.add_parser("devices", help="list audio input devices")
    devices.set_defaults(func=cmd_devices)

    serve = sub.add_parser("serve", help="run the voice HTTP service (Phase 2)")
    serve.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1)")
    serve.add_argument("--port", type=int, default=8765, help="bind port (default 8765)")
    serve.set_defaults(func=cmd_serve)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except STTError as exc:
        _log(f"error: {exc}")
        return 2
    except OpencodeError as exc:
        _log(f"error: {exc}")
        return 2
    except KeyboardInterrupt:
        _log("\ncancelled")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

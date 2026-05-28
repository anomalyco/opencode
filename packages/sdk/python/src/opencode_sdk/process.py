from __future__ import annotations

import signal
import subprocess
import sys
import threading
from typing import Callable, Optional


def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if sys.platform == "win32" and proc.pid:
        try:
            subprocess.run(
                ["taskkill", "/pid", str(proc.pid), "/T", "/F"],
                capture_output=True,
                timeout=5,
            )
            return
        except Exception:
            pass
    try:
        proc.send_signal(signal.SIGTERM)
    except Exception:
        pass


def bind_abort(
    proc: subprocess.Popen,
    event: Optional[threading.Event] = None,
    on_abort: Optional[Callable[[], None]] = None,
) -> Callable[[], None]:
    cleared = threading.Event()
    _lock = threading.Lock()

    def abort() -> None:
        with _lock:
            if cleared.is_set():
                return
            cleared.set()
        stop(proc)
        if on_abort:
            on_abort()

    def clear() -> None:
        cleared.set()

    if event is not None:
        original_wait = event.wait

        def wait_with_abort(timeout: Optional[float] = None) -> bool:
            result = original_wait(timeout)
            if event.is_set():
                abort()
            return result

        event.wait = wait_with_abort

    return clear

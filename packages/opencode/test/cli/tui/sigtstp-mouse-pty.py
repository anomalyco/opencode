#!/usr/bin/env python3
"""
sigtstp-mouse-pty.py — SIGTSTP mouse garbling reproducer (PR #20507 / issue #20506)

Runs a command inside a PTY, waits for TUI startup, then auto-sends SIGTSTP.
Monitors whether the child sends the mouse-disable sequence (\x1b[?1003l) before
suspending — if it does, the SIGTSTP handler is working; if not, the bug is present.

Without the fix: opencode has no SIGTSTP handler, so mouse tracking stays active
(\x1b[?1003l is never sent). Moving the mouse after suspension garbles the shell.

With the fix (PR #20507): the SIGTSTP handler calls renderer.suspend() which sends
\x1b[?1003l before the process suspends.

Usage:
    python3 sigtstp-mouse-pty.py opencode [args...]

Smoke-test (no opencode needed — should FAIL since no cleanup handler):
    python3 sigtstp-mouse-pty.py python3 -c \
        "import sys; sys.stdout.write('\\x1b[?1003h\\x1b[?1006h'); input()"
"""

import os
import pty
import select
import signal
import sys
import termios
import time
import tty

# Mouse enable/disable sequences (SGR extended mouse + any-event tracking)
MOUSE_ENABLE  = b"\x1b[?1003h"
MOUSE_DISABLE = b"\x1b[?1003l"

# After sending SIGTSTP, wait this long for cleanup sequences to arrive (seconds)
CLEANUP_WAIT = 0.3

# Max time to wait for TUI to enable mouse tracking before giving up (seconds)
STARTUP_TIMEOUT = 30.0

# After mouse tracking is detected, wait this long before sending SIGTSTP (seconds)
SETTLE_WAIT = 1.5


def main():
    if len(sys.argv) < 2:
        print(f"Usage: python3 {sys.argv[0]} <command> [args...]", file=sys.stderr)
        sys.exit(1)

    child_pid, master_fd = pty.fork()

    if child_pid == 0:
        os.execvp(sys.argv[1], sys.argv[1:])
        os._exit(1)

    stdin_fd = sys.stdin.fileno()
    old_attrs = termios.tcgetattr(stdin_fd)
    tty.setraw(stdin_fd)

    def handle_sigwinch(signum, frame):
        import fcntl
        buf = fcntl.ioctl(stdin_fd, termios.TIOCGWINSZ, b"\x00" * 8)
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, buf)

    signal.signal(signal.SIGWINCH, handle_sigwinch)
    handle_sigwinch(None, None)

    all_output = b""          # everything the child has written
    post_signal_output = b""  # output after we sent SIGTSTP
    phase = "startup"         # startup → settle → signaled → done
    startup_timeout = time.monotonic() + STARTUP_TIMEOUT
    settle_deadline = 0.0
    cleanup_deadline = 0.0

    try:
        while True:
            timeout = 0.05
            if phase == "settle":
                timeout = max(0.01, settle_deadline - time.monotonic())
            elif phase == "signaled":
                timeout = max(0.01, cleanup_deadline - time.monotonic())

            try:
                rlist, _, _ = select.select([stdin_fd, master_fd], [], [], timeout)
            except (ValueError, OSError):
                break

            for fd in rlist:
                if fd == stdin_fd:
                    try:
                        data = os.read(stdin_fd, 1024)
                    except OSError:
                        data = b""
                    if data:
                        try:
                            os.write(master_fd, data)
                        except OSError:
                            pass

                elif fd == master_fd:
                    try:
                        data = os.read(master_fd, 4096)
                    except OSError:
                        data = b""
                    if data:
                        os.write(sys.stdout.fileno(), data)
                        all_output += data
                        if phase == "signaled":
                            post_signal_output += data

            # Phase: wait until mouse tracking is enabled (TUI fully up)
            if phase == "startup":
                if MOUSE_ENABLE in all_output:
                    phase = "settle"
                    settle_deadline = time.monotonic() + SETTLE_WAIT
                elif time.monotonic() >= startup_timeout:
                    break  # timed out — TUI never started

            # Phase: settle briefly, then send SIGTSTP to the whole process group
            # (child_pid is the Node.js launcher; the real opencode binary is a
            # grandchild in the same process group — killpg reaches all of them)
            elif phase == "settle" and time.monotonic() >= settle_deadline:
                phase = "signaled"
                cleanup_deadline = time.monotonic() + CLEANUP_WAIT
                os.killpg(os.getpgid(child_pid), signal.SIGTSTP)

            # Phase: after cleanup window, resume and finish
            elif phase == "signaled" and time.monotonic() >= cleanup_deadline:
                os.killpg(os.getpgid(child_pid), signal.SIGCONT)
                phase = "done"
                break

            # Check if child exited early
            try:
                wpid, _ = os.waitpid(child_pid, os.WNOHANG)
                if wpid == child_pid:
                    phase = "done"
                    break
            except ChildProcessError:
                phase = "done"
                break

    finally:
        termios.tcsetattr(stdin_fd, termios.TCSADRAIN, old_attrs)
        try:
            os.close(master_fd)
        except OSError:
            pass

    print()

    if phase == "startup":
        print("\033[33mSKIP: TUI never enabled mouse tracking within 30s — nothing to test.\033[0m")
        sys.exit(0)

    mouse_disabled = MOUSE_DISABLE in post_signal_output

    if phase != "done" and phase != "signaled":
        print("\033[33mSKIP: test did not reach the SIGTSTP phase.\033[0m")
        sys.exit(0)

    # Diagnostic: show captured bytes as hex for debugging
    captured_repr = post_signal_output[:200].replace(b'\x1b', b'<ESC>').replace(b'\r', b'').replace(b'\n', b'|')
    print(f"      Captured {len(post_signal_output)} bytes after SIGTSTP: {captured_repr[:120]}")

    # Also check for other common mouse-disable sequences
    mouse_disabled_any = any(seq in post_signal_output for seq in [
        b"\x1b[?1003l", b"\x1b[?1002l", b"\x1b[?1000l", b"\x1b[?1006l"
    ])

    if mouse_disabled or mouse_disabled_any:
        which = "\\x1b[?1003l" if mouse_disabled else "other mouse-disable sequence"
        print(f"\033[32mPASS: mouse tracking was disabled before/during SIGTSTP suspension ({which}).\033[0m")
        sys.exit(0)
    else:
        print("\033[31mFAIL: mouse tracking was NOT disabled before SIGTSTP suspension!\033[0m")
        print( "      No mouse-disable sequence found in post-signal output.")
        print( "      Fix: PR #20507 — add SIGTSTP/SIGCONT signal handlers in app.tsx")
        sys.exit(1)


if __name__ == "__main__":
    main()

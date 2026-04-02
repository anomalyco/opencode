#!/usr/bin/env python3
"""
post-exit-mouse-pty.py — Post-exit mouse cleanup reproducer (PR #20462 / issue #20458)

Detects the destroy-path bug by checking the slave PTY's terminal state at the
exact moment ?1003l (mouse disable) arrives at the master.

With the fix (PR #20462): disableMouse() runs while the slave is still in RAW
mode (ECHO off), because setRawMode(false) uses TCSADRAIN and can't complete
until ?1003l has already drained to master. So when Python reads ?1003l, ECHO
is OFF → PASS.

Without the fix: setRawMode(false) runs first (invisible), switching slave to
cooked mode (ECHO on). Then disableMouse() writes ?1003l. So when Python reads
?1003l, ECHO is already ON → FAIL.

Usage:
    python3 post-exit-mouse-pty.py opencode [args...]
    Quit opencode normally (Ctrl+Q / Esc), then watch for PASS/FAIL.
"""

import os
import pty
import select
import signal
import sys
import termios
import tty

MOUSE_ENABLE  = b"\x1b[?1003h"
MOUSE_DISABLE = b"\x1b[?1003l"


def echo_is_on(fd):
    """Returns True if the slave PTY has ECHO enabled (cooked mode)."""
    try:
        attrs = termios.tcgetattr(fd)
        return bool(attrs[3] & termios.ECHO)
    except Exception:
        return None


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

    buf = b""
    mouse_enabled = False
    echo_at_disable = None  # terminal state snapshot when ?1003l first arrived

    try:
        while True:
            try:
                rlist, _, _ = select.select([stdin_fd, master_fd], [], [], 0.05)
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
                        buf += data

                        if not mouse_enabled and MOUSE_ENABLE in buf:
                            mouse_enabled = True

                        # Snapshot terminal state the moment ?1003l arrives
                        if mouse_enabled and echo_at_disable is None and MOUSE_DISABLE in buf:
                            echo_at_disable = echo_is_on(master_fd)

            try:
                wpid, _ = os.waitpid(child_pid, os.WNOHANG)
                if wpid == child_pid:
                    break
            except ChildProcessError:
                break

    finally:
        termios.tcsetattr(stdin_fd, termios.TCSADRAIN, old_attrs)
        try:
            os.close(master_fd)
        except OSError:
            pass

    print()

    if not mouse_enabled:
        print("\033[33mSKIP: mouse tracking was never enabled.\033[0m")
        sys.exit(0)

    if echo_at_disable is None:
        print("\033[33mSKIP: ?1003l was never observed.\033[0m")
        sys.exit(0)

    if echo_at_disable:
        print("\033[31mFAIL: ECHO was ON when ?1003l arrived — setRawMode(false) ran before disableMouse().\033[0m")
        print( "      Bug: mouse events can garble the shell between setRawMode and disableMouse.")
        print( "      Fix: PR #20462 — reorder cleanupBeforeDestroy() in @opentui/core")
        sys.exit(1)
    else:
        print("\033[32mPASS: ECHO was OFF when ?1003l arrived — disableMouse() ran before setRawMode(false).\033[0m")
        sys.exit(0)


if __name__ == "__main__":
    main()

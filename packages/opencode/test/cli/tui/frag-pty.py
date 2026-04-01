#!/usr/bin/env python3
"""
PTY wrapper that fragments mouse escape sequences before they reach opencode.
Every mouse event is split byte-by-byte with 12ms delays between bytes.
Keyboard input passes through instantly.

Usage: python3 frag-pty.py opencode [args...]
"""

import os
import pty
import sys
import select
import time
import struct
import fcntl
import termios
import signal

FRAGMENT_DELAY = 0.012  # 12ms — exceeds opentui's 10ms StdinParser timeout
ESC = 0x1b

def set_winsize(fd):
    """Copy terminal size to PTY."""
    try:
        size = fcntl.ioctl(sys.stdout.fileno(), termios.TIOCGWINSZ, b'\x00' * 8)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, size)
    except:
        pass

def contains_mouse_seq(data):
    """Check if data contains SGR mouse sequence start: ESC [ <"""
    for i in range(len(data) - 2):
        if data[i] == ESC and data[i+1] == ord('[') and data[i+2] == ord('<'):
            return True
    return False

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 frag-pty.py opencode [args...]")
        sys.exit(1)

    # Create PTY
    master_fd, slave_fd = pty.openpty()
    set_winsize(master_fd)

    pid = os.fork()
    if pid == 0:
        # Child: run opencode on the slave PTY
        os.close(master_fd)
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.execvp(sys.argv[1], sys.argv[1:])

    # Parent: proxy between terminal and master PTY
    os.close(slave_fd)

    # Save and set raw mode
    old_attrs = termios.tcgetattr(sys.stdin.fileno())
    try:
        raw = termios.tcgetattr(sys.stdin.fileno())
        raw[0] = 0  # iflag
        raw[1] = 0  # oflag
        raw[2] = raw[2] & ~(termios.CSIZE | termios.PARENB) | termios.CS8  # cflag
        raw[3] = 0  # lflag
        raw[6][termios.VMIN] = 1
        raw[6][termios.VTIME] = 0
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, raw)
    except:
        pass

    # Handle SIGWINCH — resize PTY when terminal resizes
    def on_resize(signum, frame):
        set_winsize(master_fd)
        os.kill(pid, signal.SIGWINCH)
    signal.signal(signal.SIGWINCH, on_resize)

    # Handle child exit
    done = False
    def on_child(signum, frame):
        nonlocal done
        done = True
    signal.signal(signal.SIGCHLD, on_child)

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    try:
        while not done:
            try:
                rlist, _, _ = select.select([stdin_fd, master_fd], [], [], 0.1)
            except (select.error, InterruptedError):
                continue

            if master_fd in rlist:
                # PTY output → terminal (pass through immediately)
                try:
                    data = os.read(master_fd, 65536)
                    if not data:
                        break
                    os.write(stdout_fd, data)
                except OSError:
                    break

            if stdin_fd in rlist:
                # Terminal input → check for mouse, fragment if needed
                try:
                    data = os.read(stdin_fd, 65536)
                    if not data:
                        break

                    if contains_mouse_seq(data):
                        # Fragment byte-by-byte with delay
                        for byte in data:
                            os.write(master_fd, bytes([byte]))
                            time.sleep(FRAGMENT_DELAY)
                    else:
                        # Pass through immediately
                        os.write(master_fd, data)
                except OSError:
                    break
    finally:
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, old_attrs)
        try:
            os.kill(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
        except:
            pass

if __name__ == "__main__":
    main()

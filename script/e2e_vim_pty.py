#!/usr/bin/env python3
import json
import os
import pty
import select
import signal
import tempfile
import time

OPENCODE = "/Users/mohamed/.opencode/bin/opencode"

def send(fd, value):
    os.write(fd, value.encode())
    time.sleep(0.18)

def send_key(fd, key):
    mapping = {
        "esc": "\x1b[27;1u",
        "ctrl-d": "\x1b[100;5u",
        "ctrl-u": "\x1b[117;5u",
    }
    send(fd, mapping.get(key, key))
    if key == "esc":
        time.sleep(0.9)

def drain(fd, seconds=0.2):
    end = time.time() + seconds
    chunks = []
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.03)
        if not ready:
            continue
        try:
            chunks.append(os.read(fd, 65536))
        except OSError:
            break
    return b"".join(chunks)

def wait_marker(marker, timeout=8):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        if os.path.exists(marker):
            try:
                with open(marker) as handle:
                    last = json.load(handle)
                return last
            except (json.JSONDecodeError, OSError):
                pass
        time.sleep(0.05)
    raise AssertionError(f"marker not written: {marker}; last={last}")

def read_marker(marker):
    with open(marker) as handle:
        return json.load(handle)

def launch(marker, workdir):
    if not os.path.exists(OPENCODE):
        raise AssertionError(f"expected local opencode executable missing: {OPENCODE}")
    pid, fd = pty.fork()
    if pid == 0:
        env = os.environ.copy()
        env["OPENCODE_VIM_PROMPT_MARKER"] = marker
        env["OPENCODE_DISABLE_AUTOUPDATE"] = "1"
        env["TERM"] = "xterm-256color"
        os.chdir(workdir)
        os.execvpe(OPENCODE, [OPENCODE], env)
    return pid, fd

def stop(pid, fd):
    end = time.time() + 2
    while time.time() < end:
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
            if done:
                return
        except ChildProcessError:
            return
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass

def assert_state(case, actual, expected):
    for key, value in expected.items():
        if actual.get(key) != value:
            raise AssertionError(f"{case}: expected {key}={value!r}, got {actual.get(key)!r}; state={actual}")

def seed_text(fd, text):
    if "\n" in text:
        send(fd, f"\x1b[200~{text}\x1b[201~")
        time.sleep(0.5)
        return
    send(fd, text)

def run_steps(fd, steps):
    for step in steps:
        if isinstance(step, dict):
            seed_text(fd, step["text"])
        else:
            send_key(fd, step)

def run_case(case):
    temp = tempfile.mkdtemp(prefix="opencode-vim-e2e-")
    marker = os.path.join(temp, "marker.json")
    pid, fd = launch(marker, temp)
    try:
        output = ""
        end = time.time() + 25
        while time.time() < end:
            output += drain(fd, 0.25).decode(errors="replace")
            if "Ask anything" in output or "Run a command" in output or "INSERT" in output or "]12;" in output:
                break
            time.sleep(0.1)

        seed_text(fd, case["text"])
        send_key(fd, "esc")
        try:
            wait_marker(marker)
        except AssertionError as error:
            output = drain(fd, 2.0).decode(errors="replace")
            raise AssertionError(f"{error}\nPTY output tail:\n{output[-4000:]}") from error

        run_steps(fd, case.get("setup", []))
        if case.get("setup"):
            time.sleep(0.5)
            wait_marker(marker)
        run_steps(fd, case["keys"])
        time.sleep(0.35)
        drain(fd, 0.5)
        actual = read_marker(marker)
        assert_state(case["name"], actual, case["expect"])
        print(f"PASS {case['name']}: cursor={actual.get('cursor')} mode={actual.get('mode')} input={actual.get('input')!r}", flush=True)
    finally:
        stop(pid, fd)
        for filename in os.listdir(temp):
            try:
                os.remove(os.path.join(temp, filename))
            except IsADirectoryError:
                pass
        os.rmdir(temp)

CASES = [
    {"name": "0 start", "text": "  alpha beta", "keys": ["0"], "expect": {"enabled": True, "mode": "normal", "cursor": 0, "input": "  alpha beta"}},
    {"name": "caret first nonblank", "text": "  alpha beta", "keys": ["^"], "expect": {"enabled": True, "mode": "normal", "cursor": 2, "input": "  alpha beta"}},
    {"name": "dollar line end", "text": "  alpha beta", "keys": ["0", "$"], "expect": {"enabled": True, "mode": "normal", "cursor": 12, "input": "  alpha beta"}},
    {"name": "h l", "text": "hello", "keys": ["h", "l"], "expect": {"enabled": True, "mode": "normal", "cursor": 4, "input": "hello"}},
    {"name": "w", "text": "alpha beta", "keys": ["0", "w"], "expect": {"enabled": True, "mode": "normal", "cursor": 6, "input": "alpha beta"}},
    {"name": "b", "text": "alpha beta", "keys": ["b"], "expect": {"enabled": True, "mode": "normal", "cursor": 6, "input": "alpha beta"}},
    {"name": "e", "text": "alpha beta", "keys": ["0", "w", "e"], "expect": {"enabled": True, "mode": "normal", "cursor": 9, "input": "alpha beta"}},
    {"name": "x", "text": "hello", "keys": ["0", "x"], "expect": {"enabled": True, "mode": "normal", "cursor": 0, "input": "ello"}},
    {"name": "G end", "text": "a", "setup": ["o", {"text": "b"}, "esc", "o", {"text": "c"}, "esc"], "keys": ["0", "G"], "expect": {"enabled": True, "mode": "normal", "cursor": 5, "input": "a\nb\nc"}},
    {"name": "gg start", "text": "a", "setup": ["o", {"text": "b"}, "esc", "o", {"text": "c"}, "esc"], "keys": ["G", "g", "g"], "expect": {"enabled": True, "mode": "normal", "cursor": 0, "input": "a\nb\nc"}},
    {"name": "j k", "text": "aa", "setup": ["o", {"text": "bb"}, "esc", "o", {"text": "cc"}, "esc"], "keys": ["0", "j", "j", "k"], "expect": {"enabled": True, "mode": "normal", "cursor": 3, "input": "aa\nbb\ncc"}},
    {"name": "o below", "text": "alpha", "keys": ["o"], "expect": {"enabled": True, "mode": "insert", "cursor": 6, "input": "alpha\n"}},
    {"name": "O above", "text": "alpha", "keys": ["O"], "expect": {"enabled": True, "mode": "insert", "cursor": 0, "input": "\nalpha"}},
    {"name": "f repeat reverse", "text": "alpha; beta; gamma", "keys": ["0", "f", ";", ";", ","], "expect": {"enabled": True, "mode": "normal", "cursor": 5, "input": "alpha; beta; gamma"}},
    {"name": "t repeat", "text": "alpha; beta; gamma", "keys": ["0", "t", ";", ";"], "expect": {"enabled": True, "mode": "normal", "cursor": 10, "input": "alpha; beta; gamma"}},
    {"name": "F backward", "text": "alpha; beta", "keys": ["F", ";"], "expect": {"enabled": True, "mode": "normal", "cursor": 5, "input": "alpha; beta"}},
    {"name": "T backward", "text": "alpha; beta", "keys": ["T", ";"], "expect": {"enabled": True, "mode": "normal", "cursor": 6, "input": "alpha; beta"}},
    {"name": "diw", "text": "alpha beta gamma", "keys": ["0", "w", "d", "i", "w"], "expect": {"enabled": True, "mode": "normal", "cursor": 6, "input": "alpha  gamma"}},
    {"name": "ciw", "text": "alpha beta gamma", "keys": ["0", "w", "c", "i", "w"], "expect": {"enabled": True, "mode": "insert", "cursor": 6, "input": "alpha  gamma"}},
    {"name": "daw", "text": "alpha beta gamma", "keys": ["0", "w", "d", "a", "w"], "expect": {"enabled": True, "mode": "normal", "cursor": 6, "input": "alpha gamma"}},
    {"name": "caw", "text": "alpha beta gamma", "keys": ["0", "w", "c", "a", "w"], "expect": {"enabled": True, "mode": "insert", "cursor": 6, "input": "alpha gamma"}},
    {"name": "de", "text": "alpha beta gamma", "keys": ["0", "w", "d", "e"], "expect": {"enabled": True, "mode": "normal", "cursor": 6, "input": "alpha  gamma"}},
    {"name": "db", "text": "alpha beta gamma", "keys": ["0", "w", "e", "d", "b"], "expect": {"enabled": True, "mode": "normal", "cursor": 6, "input": "alpha a gamma"}},
    {"name": "df char", "text": "alpha; beta", "keys": ["0", "d", "f", ";"], "expect": {"enabled": True, "mode": "normal", "cursor": 0, "input": " beta"}},
    {"name": "dt char", "text": "alpha; beta", "keys": ["0", "d", "t", ";"], "expect": {"enabled": True, "mode": "normal", "cursor": 0, "input": "; beta"}},
    {"name": "dF char", "text": "alpha; beta", "keys": ["d", "F", ";"], "expect": {"enabled": True, "mode": "normal", "cursor": 5, "input": "alpha"}},
    {"name": "dT char", "text": "alpha; beta", "keys": ["d", "T", ";"], "expect": {"enabled": True, "mode": "normal", "cursor": 6, "input": "alpha;"}},
    {"name": "i insert", "text": "abc", "keys": ["0", "i"], "expect": {"enabled": True, "mode": "insert", "cursor": 0, "input": "abc"}},
    {"name": "I insert first nonblank", "text": "  abc", "keys": ["I"], "expect": {"enabled": True, "mode": "insert", "cursor": 2, "input": "  abc"}},
    {"name": "a append", "text": "abc", "keys": ["0", "a"], "expect": {"enabled": True, "mode": "insert", "cursor": 1, "input": "abc"}},
    {"name": "A append line", "text": "abc", "keys": ["0", "A"], "expect": {"enabled": True, "mode": "insert", "cursor": 3, "input": "abc"}},
]

for item in CASES:
    run_case(item)

print(f"E2E complete: {len(CASES)} cases", flush=True)

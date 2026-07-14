#!/usr/bin/env python3
"""PreToolUse guard: credentials / secrets are off-limits.

Terraform SOURCE (*.tf) is readable — agents legitimately need infra config. What is
blocked is variable/secret material: *.tfvars (variable values, may hold secrets),
terraform STATE (*.tfstate, resolved secrets), .env files, secrets/ dirs, and private
keys. Reading those risks leaking credentials; secrets live in SSM, not the repo. If a
secret value is genuinely required, the agent must stop and ask.

Blocks the tool call by exiting 2 with an explanation on stderr (fed back to Claude).
Allows everything else by exiting 0. Fails open on malformed input.
"""

import json
import re
import sys

BLOCKED = [
    r"(^|/)\.env($|\.|/)",      # .env / .env.* — local secrets
    r"(^|/)secrets?/",          # secrets/ directories
    r"\.tfvars$",               # terraform variable values (may contain secrets)
    r"\.tfstate(\.|$)",         # terraform state — holds resolved secret values
    r"\.pem$",
    r"(^|/)id_(rsa|ed25519)",   # private SSH keys
    r"(^|/)credentials($|/)",   # aws/gcp credential files
]
BLOCKED_RE = re.compile("|".join(BLOCKED))
READ_CMD_RE = re.compile(r"\b(cat|less|more|head|tail|bat|strings|xxd|od|nl)\b")


def is_blocked(path: object) -> bool:
    return isinstance(path, str) and bool(BLOCKED_RE.search(path))


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    tool = data.get("tool_name", "")
    ti = data.get("tool_input", {}) or {}
    hit = None

    if tool in ("Read", "Glob"):
        for key in ("file_path", "path", "glob", "pattern"):
            if is_blocked(ti.get(key)):
                hit = ti.get(key)
                break
    elif tool == "Grep":
        for key in ("path", "glob"):
            if is_blocked(ti.get(key)):
                hit = ti.get(key)
                break
    elif tool == "Bash":
        cmd = ti.get("command", "")
        if isinstance(cmd, str) and READ_CMD_RE.search(cmd) and BLOCKED_RE.search(cmd):
            hit = cmd

    if hit is not None:
        sys.stderr.write(
            "Blocked by guardrail: credentials/variables are off-limits "
            "(*.tfvars, *.tfstate, .env*, secrets/, keys). Terraform source (*.tf) is "
            "fine to read. If a secret value is genuinely required, stop and ask the "
            "user.\n"
            f"Matched: {hit}\n"
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

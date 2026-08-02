#!/usr/bin/env python3
"""PreToolUse guard: every subagent names its model.

CLAUDE.md ("Subagent model") assigns a tier by what the subagent does — Opus for
judging and writing (review skeptics, the blind exit gate, the implementation
subagent), Sonnet for gathering (the Explore agents in /plan and /write-ticket).
The rule is only real if it is passed explicitly: an omitted `model` silently
inherits the session's model, which is exactly the failure the rule exists to
prevent (a Fable-tier reviewer returns a pass nobody should trust).

So: block any subagent spawn that omits `model`, or that names a tier below the
two allowed families. Deliberately does NOT enforce a type->tier mapping — a
review skeptic legitimately runs as an `Explore`-type agent on Opus. Which tier
is a judgment call; that it was made at all is not.

Fails open on bad input.
"""

import json
import sys

SUBAGENT_TOOLS = {"Agent", "Task"}  # "Agent" here; "Task" on older CLI versions.
ALLOWED_FAMILIES = ("opus", "sonnet")
BLOCKED_FAMILIES = ("fable", "haiku")

RULE = (
    "Pass `model` explicitly on the Agent call (see 'Subagent model' in CLAUDE.md):\n"
    '  model: "opus"   — judging or writing: review skeptics, the blind exit gate,\n'
    "                    the /auto-implement implementation subagent.\n"
    '  model: "sonnet" — gathering: the Explore agents in /plan and /write-ticket.\n'
    "The tier follows the work, not the agent type: a skeptic takes Opus even when "
    "it runs as an `Explore`-type agent."
)


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    if data.get("tool_name") not in SUBAGENT_TOOLS:
        return 0

    tool_input = data.get("tool_input", {}) or {}
    model = tool_input.get("model")
    subagent = tool_input.get("subagent_type", "?")

    if not isinstance(model, str) or not model.strip():
        sys.stderr.write(
            "Blocked by guardrail: subagent spawned with no model.\n"
            f"Refused: subagent_type={subagent} (model omitted — would inherit the "
            "session's model).\n" + RULE + "\n"
        )
        return 2

    norm = model.strip().lower()
    if any(f in norm for f in BLOCKED_FAMILIES) or not any(
        f in norm for f in ALLOWED_FAMILIES
    ):
        sys.stderr.write(
            "Blocked by guardrail: subagent model is not an allowed tier.\n"
            f"Refused: subagent_type={subagent} model={model!r}.\n" + RULE + "\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())

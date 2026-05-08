#!/usr/bin/env python3
"""Extract the conversation skeleton from a Claude Code, Codex, or Cursor JSONL session file.

Usage: cat <session.jsonl> | python3 extract-skeleton.py

Auto-detects platform (Claude Code, Codex, or Cursor) from the JSONL structure.
Extracts:
  - User messages (text only, no tool results)
  - Assistant text (no thinking/reasoning blocks)
  - Collapsed tool call summaries (consecutive same-tool calls grouped)

Consecutive tool calls of the same type are collapsed:
  3+ Read calls -> "[tools] 3x Read (file1, file2, +1 more) -> all ok"
Codex call/result pairs are deduplicated (only the result with status is kept).
Outputs a _meta line at the end with processing stats.
"""
import sys
import json
import re

stats = {"lines": 0, "parse_errors": 0, "user": 0, "assistant": 0, "tool": 0}

# Claude Code wrapper tags to strip from user message content.
# Strip entirely (tag + content): framework noise and raw command output.
# Strip tags only (keep content): command-message, command-name, command-args, user_query.
_STRIP_BLOCK = re.compile(
    r"<(?:task-notification|local-command-caveat|local-command-stdout|local-command-stderr|system-reminder)[^>]*>.*?</(?:task-notification|local-command-caveat|local-command-stdout|local-command-stderr|system-reminder)>",
    re.DOTALL,
)
_STRIP_TAG = re.compile(
    r"</?(?:command-message|command-name|command-args|user_query)[^>]*>"
)


def clean_text(text):
    """Strip framework wrapper tags from message text (Claude and Cursor)."""
    text = _STRIP_BLOCK.sub("", text)
    text = _STRIP_TAG.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text

# Buffer for pending tool entries: [{"ts", "name", "target", "status"}]
pending_tools = []


def flush_tools():
    """Print buffered tool entries, collapsing consecutive same-name groups."""
    if not pending_tools:
        return

    # Group consecutive entries by tool name
    groups = []
    for entry in pending_tools:
        if groups and groups[-1][0]["name"] == entry["name"]:
            groups[-1].append(entry)
        else:
            groups.append([entry])

    for group in groups:
        name = group[0]["name"]
        if len(group) <= 2:
            # Print individually
            for e in group:
                status = f" -> {e['status']}" if e.get("status") else ""
                ts_prefix = f"[{e['ts']}] " if e.get("ts") else ""
                print(f"{ts_prefix}[tool] {name} {e['target']}{status}")
                stats["tool"] += 1
        else:
            # Collapse
            ts = group[0].get("ts", "")
            targets = [e["target"] for e in group if e.get("target")]
            ok = sum(1 for e in group if e.get("status") == "ok")
            err = sum(1 for e in group if e.get("status") and e["status"] != "ok")
            no_status = len(group) - ok - err

            # Show first 2 targets, then "+N more"
            if len(targets) > 2:
                target_str = ", ".join(targets[:2]) + f", +{len(targets) - 2} more"
            elif targets:
                target_str = ", ".join(targets)
            else:
                target_str = ""

            if no_status == len(group):
                status_str = ""
            elif err == 0:
                status_str = " -> all ok"
            else:
                status_str = f" -> {ok} ok, {err} error"

            ts_prefix = f"[{ts}] " if ts else ""
            print(f"{ts_prefix}[tools] {len(group)}x {name} ({target_str}){status_str}")
            stats["tool"] += len(group)

    pending_tools.clear()


def summarize_claude_tool(block):
    """Extract name and target from a Claude Code tool_use block."""
    name = block.get("name", "unknown")
    inp = block.get("input", {})
    target = (
        inp.get("file_path")
        or inp.get("path")
        or inp.get("command", "")[:120]
        or inp.get("pattern", "")
        or inp.get("query", "")[:80]
        or inp.get("prompt", "")[:80]
        or ""
    )
    if isinstance(target, str) and len(target) > 120:
        target = target[:120]
    return name, target


def handle_claude(obj):
    msg_type = obj.get("type")
    ts = obj.get("timestamp", "")[:19]

    if msg_type == "user":
        msg = obj.get("message", {})
        content = msg.get("content", "")

        if isinstance(content, list):
            for block in content:
                if block.get("type") == "tool_result":
                    is_error = block.get("is_error", False)
                    status = "error" if is_error else "ok"
                    tool_use_id = block.get("tool_use_id")
                    matched = False
                    if tool_use_id:
                        for entry in pending_tools:
                            if entry.get("id") == tool_use_id:
                                entry["status"] = status
                                matched = True
                                break
                    if not matched:
                        # Fallback: assign to earliest pending entry without a status
                        for entry in pending_tools:
                            if not entry.get("status"):
                                entry["status"] = status
                                break

            texts = [
                c.get("text", "")
                for c in content
                if c.get("type") == "text" and len(c.get("text", "")) > 10
            ]
            content = " ".join(texts)

        if isinstance(content, str):
            content = clean_text(content)
            if len(content) > 15:
                flush_tools()
                print(f"[{ts}] [user] {content[:800]}")
                print("---")
                stats["user"] += 1

    elif msg_type == "assistant":
        msg = obj.get("message", {})
        content = msg.get("content", [])
        if isinstance(content, list):
            has_text = False
            for block in content:
                if block.get("type") == "text":
                    text = clean_text(block.get("text", ""))
                    if len(text) > 20:
                        if not has_text:
                            flush_tools()
                            has_text = True
                        print(f"[{ts}] [assistant] {text[:800]}")
                        print("---")
                        stats["assistant"] += 1
                elif block.get("type") == "tool_use":
                    name, target = summarize_claude_tool(block)
                    entry = {"ts": ts, "name": name, "target": target}
                    tool_id = block.get("id")
                    if tool_id:
                        entry["id"] = tool_id
                    pending_tools.append(entry)


def handle_codex(obj):
    msg_type = obj.get("type")
    ts = obj.get("timestamp", "")[:19]

    if msg_type == "event_msg":
        p = obj.get("payload", {})
        if p.get("type") == "user_message":
            text = p.get("message", "")
            if isinstance(text, str) and len(text) > 15:
                parts = text.split("</system_instruction>")
                user_text = parts[-1].strip() if parts else text
                if len(user_text) > 15:
                    flush_tools()
                    print(f"[{ts}] [user] {user_text[:800]}")
                    print("---")
                    stats["user"] += 1

        elif p.get("type") == "exec_command_end":
            # This is the deduplicated result — has status info
            command = p.get("command", [])
            cmd_str = command[-1] if command else ""
            output = p.get("aggregated_output", "")

            status = "ok"
            if "Process exited with code " in output:
                try:
                    code = int(output.split("Process exited with code ")[1].split("\n")[0])
                    if code != 0:
                        status = f"error(exit {code})"
                except (IndexError, ValueError):
                    pass

            if cmd_str:
                # Shorten common patterns for readability
                short_cmd = cmd_str[:120]
                pending_tools.append({"ts": ts, "name": "exec", "target": short_cmd, "status": status})

    elif msg_type == "response_item":
        p = obj.get("payload", {})
        if p.get("type") == "message" and p.get("role") == "assistant":
            for block in p.get("content", []):
                if block.get("type") == "output_text" and len(block.get("text", "")) > 20:
                    flush_tools()
                    print(f"[{ts}] [assistant] {block['text'][:800]}")
                    print("---")
                    stats["assistant"] += 1

        # Skip function_call — exec_command_end is the deduplicated version with status


def handle_cursor(obj):
    """Cursor agent transcripts: role-based, no timestamps, same content structure as Claude."""
    role = obj.get("role")
    content = obj.get("message", {}).get("content", [])

    if role == "user":
        texts = []
        for block in (content if isinstance(content, list) else []):
            if block.get("type") == "text":
                texts.append(block.get("text", ""))
        text = clean_text(" ".join(texts))
        if len(text) > 15:
            flush_tools()
            # No timestamps available in Cursor transcripts
            print(f"[user] {text[:800]}")
            print("---")
            stats["user"] += 1

    elif role == "assistant":
        has_text = False
        for block in (content if isinstance(content, list) else []):
            if block.get("type") == "text":
                text = block.get("text", "")
                # Skip [REDACTED] placeholder blocks
                if len(text) > 20 and text.strip() != "[REDACTED]":
                    if not has_text:
                        flush_tools()
                        has_text = True
                    print(f"[assistant] {text[:800]}")
                    print("---")
                    stats["assistant"] += 1
            elif block.get("type") == "tool_use":
                name = block.get("name", "unknown")
                inp = block.get("input", {})
                target = (
                    inp.get("path")
                    or inp.get("file_path")
                    or inp.get("command", "")[:120]
                    or inp.get("pattern", "")
                    or inp.get("glob_pattern", "")
                    or inp.get("target_directory", "")
                    or ""
                )
                if isinstance(target, str) and len(target) > 120:
                    target = target[:120]
                # No status info available — Cursor doesn't log tool results
                pending_tools.append({"ts": "", "name": name, "target": target})


# Auto-detect platform from first few lines, then process all
detected = None
buffer = []

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    buffer.append(line)
    stats["lines"] += 1

    if not detected and len(buffer) <= 10:
        try:
            obj = json.loads(line)
            if obj.get("type") in ("user", "assistant"):
                detected = "claude"
            elif obj.get("type") in ("session_meta", "turn_context", "response_item", "event_msg"):
                detected = "codex"
            elif obj.get("role") in ("user", "assistant") and "type" not in obj:
                detected = "cursor"
        except (json.JSONDecodeError, KeyError):
            pass

handlers = {"claude": handle_claude, "codex": handle_codex, "cursor": handle_cursor}
handler = handlers.get(detected, handle_codex)

for line in buffer:
    try:
        handler(json.loads(line))
    except (json.JSONDecodeError, KeyError):
        stats["parse_errors"] += 1

# Flush any remaining buffered tools
flush_tools()

print(json.dumps({"_meta": True, **stats}))

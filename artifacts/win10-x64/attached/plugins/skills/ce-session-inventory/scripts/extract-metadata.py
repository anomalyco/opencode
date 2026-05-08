#!/usr/bin/env python3
"""Extract session metadata from Claude Code, Codex, and Cursor JSONL files.

Batch mode (preferred — one invocation for all files):
  python3 extract-metadata.py /path/to/dir/*.jsonl
  python3 extract-metadata.py file1.jsonl file2.jsonl file3.jsonl

Single-file mode (stdin):
  head -20 <session.jsonl> | python3 extract-metadata.py

Auto-detects platform from the JSONL structure.
Outputs one JSON object per file, one per line.
Includes a final _meta line with processing stats.
"""
import sys
import json
import os

MAX_LINES = 25  # Only need first ~25 lines for metadata


def try_claude(lines):
    for line in lines:
        try:
            obj = json.loads(line.strip())
            if obj.get("type") == "user" and "gitBranch" in obj:
                return {
                    "platform": "claude",
                    "branch": obj["gitBranch"],
                    "ts": obj.get("timestamp", ""),
                    "session": obj.get("sessionId", ""),
                }
        except (json.JSONDecodeError, KeyError):
            pass
    return None


def try_codex(lines):
    meta = {}
    for line in lines:
        try:
            obj = json.loads(line.strip())
            if obj.get("type") == "session_meta":
                p = obj.get("payload", {})
                meta["platform"] = "codex"
                meta["cwd"] = p.get("cwd", "")
                meta["session"] = p.get("id", "")
                meta["ts"] = p.get("timestamp", obj.get("timestamp", ""))
                meta["source"] = p.get("source", "")
                meta["cli_version"] = p.get("cli_version", "")
            elif obj.get("type") == "turn_context":
                p = obj.get("payload", {})
                meta["model"] = p.get("model", "")
                meta["cwd"] = meta.get("cwd") or p.get("cwd", "")
        except (json.JSONDecodeError, KeyError):
            pass
    return meta if meta else None


def try_cursor(lines):
    """Cursor agent transcripts: role-based entries, no timestamps or metadata fields."""
    for line in lines:
        try:
            obj = json.loads(line.strip())
            # Cursor entries have 'role' at top level but no 'type'
            if obj.get("role") in ("user", "assistant") and "type" not in obj:
                return {"platform": "cursor"}
        except (json.JSONDecodeError, KeyError):
            pass
    return None


def extract_from_lines(lines):
    return try_claude(lines) or try_codex(lines) or try_cursor(lines)


TAIL_BYTES = 16384  # Read last 16KB to find final timestamp past trailing metadata


def get_last_timestamp(filepath, size):
    """Read the tail of a file to find the last message with a timestamp."""
    try:
        with open(filepath, "rb") as f:
            f.seek(max(0, size - TAIL_BYTES))
            tail = f.read().decode("utf-8", errors="ignore")
            lines = tail.strip().split("\n")
        for line in reversed(lines):
            try:
                obj = json.loads(line.strip())
                if "timestamp" in obj:
                    return obj["timestamp"]
            except (json.JSONDecodeError, KeyError):
                pass
    except (OSError, IOError):
        pass
    return None


def _extract_user_assistant_text(filepath):
    """Return concatenated user + assistant text content from a session JSONL.

    Skips JSONL metadata field names and values (sessionId, gitBranch, uuid,
    timestamps, type tags), tool_use blocks (tool names + tool inputs),
    tool_result blocks (tool outputs), and thinking/reasoning blocks. Only
    content the user or assistant actually said is included.

    Without this filtering, common topic words like "session" would match every
    JSONL file via the sessionId field, drowning out real content matches.
    """
    chunks = []
    try:
        with open(filepath, "r", errors="replace") as f:
            for line in f:
                try:
                    obj = json.loads(line.strip())
                except (json.JSONDecodeError, ValueError):
                    continue

                # Claude Code: type-tagged top-level
                t = obj.get("type")
                if t == "user":
                    msg = obj.get("message", {})
                    content = msg.get("content")
                    if isinstance(content, str):
                        chunks.append(content)
                    elif isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                chunks.append(block.get("text", ""))
                            # Skip tool_result blocks — tool outputs are not user content.
                    continue
                if t == "assistant":
                    msg = obj.get("message", {})
                    content = msg.get("content", [])
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                chunks.append(block.get("text", ""))
                            # Skip tool_use and thinking blocks.
                    continue

                # Codex: payload-typed events
                if t == "event_msg":
                    p = obj.get("payload", {})
                    if p.get("type") == "user_message":
                        # Strip Codex/Conductor `<system_instruction>...</system_instruction>`
                        # wrapper before counting. Without this, generic wrapper terms
                        # (e.g., "Conductor", environment labels) false-match against
                        # boilerplate the user did not author. Mirrors the same split
                        # used in ce-session-extract/scripts/extract-skeleton.py.
                        msg = p.get("message", "")
                        if isinstance(msg, str):
                            parts = msg.split("</system_instruction>")
                            chunks.append(parts[-1] if parts else msg)
                    continue
                if t == "response_item":
                    p = obj.get("payload", {})
                    if p.get("type") == "message" and p.get("role") == "assistant":
                        for block in p.get("content", []):
                            if isinstance(block, dict) and block.get("type") == "output_text":
                                chunks.append(block.get("text", ""))
                    continue

                # Cursor: role-tagged with no top-level type
                if obj.get("role") in ("user", "assistant") and "type" not in obj:
                    msg = obj.get("message", {})
                    for block in msg.get("content", []) if isinstance(msg.get("content"), list) else []:
                        if isinstance(block, dict) and block.get("type") == "text":
                            chunks.append(block.get("text", ""))
                    continue
    except (OSError, IOError):
        pass
    return "\n".join(chunks)


def count_keyword_matches(filepath, keywords):
    """Case-insensitive substring count for each keyword in user/assistant text.

    Returns a dict {original_keyword: count}. Scans only content the user or
    assistant said — not JSONL metadata, tool calls, tool outputs, or thinking
    blocks — so common topic words like "session" do not false-match against
    the sessionId field.
    """
    text_lower = _extract_user_assistant_text(filepath).lower()
    return {kw: text_lower.count(kw.lower()) for kw in keywords}


def process_file(filepath):
    """Extract metadata only. Keyword scanning is done separately so callers
    can apply cheap filters (e.g. --cwd-filter) before paying the full-file
    content scan cost."""
    try:
        size = os.path.getsize(filepath)
        with open(filepath, "r") as f:
            lines = []
            for i, line in enumerate(f):
                if i >= MAX_LINES:
                    break
                lines.append(line)
        result = extract_from_lines(lines)
        if result:
            result["file"] = filepath
            result["size"] = size
            if result["platform"] == "cursor":
                # Cursor transcripts have no timestamps in JSONL.
                # Use file modification time as the best available signal.
                # Derive session ID from the parent directory name (UUID).
                mtime = os.path.getmtime(filepath)
                from datetime import datetime, timezone

                result["ts"] = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
                result["session"] = os.path.basename(os.path.dirname(filepath))
            else:
                last_ts = get_last_timestamp(filepath, size)
                if last_ts:
                    result["last_ts"] = last_ts
            return result, None
        else:
            return None, filepath
    except (OSError, IOError) as e:
        return None, filepath


# Parse arguments: files and optional --cwd-filter / --keyword
files = []
cwd_filter = None
keywords = None
args = sys.argv[1:]
i = 0
while i < len(args):
    if args[i] == "--cwd-filter" and i + 1 < len(args):
        cwd_filter = args[i + 1]
        i += 2
    elif args[i] == "--keyword" and i + 1 < len(args):
        keywords = [k for k in args[i + 1].split(",") if k]
        i += 2
    elif not args[i].startswith("-"):
        files.append(args[i])
        i += 1
    else:
        i += 1

if files:
    # Batch mode: process all files
    processed = 0
    parse_errors = 0
    filtered = 0
    matched = 0
    for filepath in files:
        if not filepath.endswith(".jsonl"):
            continue
        result, error = process_file(filepath)
        processed += 1
        if result:
            # Apply CWD filter first: cheap metadata-only check. Skip Codex
            # sessions from other repos before paying the full-file keyword
            # scan cost — Codex discovery returns sessions across all repos,
            # so without this ordering --keyword would scan files that are
            # immediately discarded.
            if cwd_filter and result.get("cwd") and cwd_filter not in result["cwd"]:
                filtered += 1
                continue
            # Apply keyword scan only after cheap filters pass.
            if keywords:
                matches = count_keyword_matches(filepath, keywords)
                result["keyword_matches"] = matches
                result["match_count"] = sum(matches.values())
                if result["match_count"] == 0:
                    continue
                matched += 1
            print(json.dumps(result))
        elif error:
            parse_errors += 1

    meta = {"_meta": True, "files_processed": processed, "parse_errors": parse_errors}
    if filtered:
        meta["filtered_by_cwd"] = filtered
    if keywords:
        meta["files_matched"] = matched
    print(json.dumps(meta))
else:
    # No file arguments: either single-file stdin mode or empty xargs invocation.
    # When xargs runs us with no input (e.g., discover found no files), stdin is
    # empty or a TTY — emit a clean zero-file result instead of a false parse error.
    if sys.stdin.isatty():
        lines = []
    else:
        lines = list(sys.stdin)

    if not lines:
        # No input at all — zero-file result (clean exit for empty pipelines).
        # When --keyword was supplied, emit files_matched: 0 so callers relying
        # on its presence to terminate quickly in zero-match scans see a
        # consistent shape with the batch-mode no-match case.
        meta = {"_meta": True, "files_processed": 0, "parse_errors": 0}
        if keywords:
            meta["files_matched"] = 0
        print(json.dumps(meta))
    else:
        # Genuine single-file stdin mode (backward compatible)
        result = extract_from_lines(lines)
        if result:
            print(json.dumps(result))
        print(json.dumps({"_meta": True, "files_processed": 1, "parse_errors": 0 if result else 1}))

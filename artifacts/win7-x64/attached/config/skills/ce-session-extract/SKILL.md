---
name: ce-session-extract
description: "Extract conversation skeleton or error signals from a single session file at a given path. Invoked by session-research agents after they have selected which sessions to deep-dive — not intended for direct user queries."
user-invocable: false
context: fork
---

# Session extract

Agent-facing primitive. Extract filtered content from a single Claude Code, Codex, or Cursor session file — either a conversation skeleton or error signals.

This skill exists so that agents do not read multi-megabyte session files into context. The scripts under `scripts/` own the JSONL shape knowledge and emit a narrative-readable digest.

## Arguments

Space-separated positional args:

1. `<file>` — absolute path to a session JSONL file (typically a `file` value returned by `ce-session-inventory`).
2. `<mode>` — `skeleton` or `errors`.
3. `<limit>` *(optional)* — `head:N` or `tail:N` to cap output at N lines (e.g., `head:200`). Omit to return full extraction.

## Execution

**Skeleton mode** — narrative of user messages, assistant text, and collapsed tool-call summaries:

```bash
cat <file> | python3 scripts/extract-skeleton.py
```

**Errors mode** — just error signals:

```bash
cat <file> | python3 scripts/extract-errors.py
```

If `<limit>` is `head:N`, pipe through `head -n N`. If `tail:N`, pipe through `tail -n N`. Apply the limit after the Python script, never before — the `_meta` line is emitted last and a head cap may drop it; that is acceptable when the caller asks for a head cap.

Return the raw stdout verbatim. Do not paraphrase, annotate, or synthesize — the caller does synthesis across multiple sessions.

## What each mode returns

### Skeleton

Narrative output with one logical event per block, separated by `---`:

- User messages (text only, no tool results, framework wrapper tags stripped)
- Assistant text (no thinking/reasoning blocks — those are internal or encrypted)
- Tool call summaries; 3+ consecutive same-name calls are collapsed (e.g., `[tools] 5x Read (file1, file2, +3 more) -> all ok`)

Ends with a `_meta` line: `{"_meta": true, "lines": N, "parse_errors": N, "user": N, "assistant": N, "tool": N}`.

### Errors

One line per error, separated by `---`:

- Claude Code: tool results with `is_error: true`
- Codex: `exec_command_end` events with non-zero exit or non-empty stderr
- Cursor: always empty — Cursor agent transcripts do not log tool results

Ends with a `_meta` line: `{"_meta": true, "lines": N, "parse_errors": N, "errors_found": N}`.

## Error handling

If the file cannot be read, let the error surface to the caller. If `_meta` reports `parse_errors > 0`, return the output as-is — partial extraction is still useful and the caller decides whether to widen the search or deep-dive further.

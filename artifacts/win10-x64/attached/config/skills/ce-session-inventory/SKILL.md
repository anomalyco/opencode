---
name: ce-session-inventory
description: "Discover session files for a repo across Claude Code, Codex, and Cursor, and extract session metadata (timestamps, branch, cwd, size, platform). Invoked by session-research agents — not intended for direct user queries."
user-invocable: false
context: fork
---

# Session inventory

Agent-facing primitive. Discover session files and emit session metadata as JSONL across Claude Code, Codex, and Cursor.

This skill exists so that agents researching session history do not need to know the layout of session stores on disk or the JSONL shapes of each platform. The scripts under `scripts/` own that knowledge.

## Arguments

Space-separated positional args:

1. `<repo>` — repo folder name (e.g., `my-project`). Used for directory matching in Claude Code and Cursor, and as the CWD filter for Codex sessions.
2. `<days>` — scan window in days (e.g., `7`). Session files older than this are skipped.
3. `<platform>` *(optional)* — one of `claude`, `codex`, `cursor`. Omit to search all three.
4. `--keyword K1[,K2,...]` *(optional)* — filter to sessions whose full file content matches at least one of the comma-separated keywords (case-insensitive substring). Each emitted session line gains `match_count` and `keyword_matches` ({K: N, ...}) fields, and the `_meta` line gains `files_matched`. Use this instead of rolling per-file `grep -l` calls when ranking many sessions by topical relevance.

## Execution

Run the discovery-plus-metadata pipeline from the skill's own `scripts/` directory:

```bash
bash scripts/discover-sessions.sh <repo> <days> [--platform <platform>] \
  | tr '\n' '\0' \
  | xargs -0 python3 scripts/extract-metadata.py --cwd-filter <repo>
```

To filter by keyword, append `--keyword K1[,K2,...]` to the `extract-metadata.py` invocation. Keyword scanning reads the full file (not just the head metadata window), so it costs more than a metadata-only run — use it when you need to rank candidates by topic across many sessions, not as a default.

Return the raw stdout verbatim — one JSON object per session, then a final `_meta` line. Callers parse the JSONL directly, so do not paraphrase, reformat, or summarize.

If discovery finds no files, the pipeline still emits a clean `_meta` line (`files_processed: 0`). Return that as-is.

## Output format

Each session line is a JSON object. Common fields across platforms:

- `platform` — `claude`, `codex`, or `cursor`
- `file` — absolute path to the session JSONL
- `size` — file size in bytes
- `ts` — session start timestamp (ISO 8601)
- `session` — session identifier

Platform-specific fields:

- Claude Code adds `branch` (git branch) and `last_ts` (last message timestamp).
- Codex adds `cwd` (working directory), `source`, `cli_version`, `model`, `last_ts`.
- Cursor has no in-file timestamps or metadata — `ts` is derived from file mtime and `session` from the containing directory name.

The final `_meta` line has `files_processed`, `parse_errors`, and optionally `filtered_by_cwd` (count of Codex sessions dropped by the CWD filter) and `files_matched` (count of sessions retained by the keyword filter, present only when `--keyword` was set).

When `--keyword` is set, each session line additionally carries:

- `match_count` — total occurrences across all keywords
- `keyword_matches` — per-keyword counts, e.g., `{"middleware": 4, "auth": 12}`

Sessions with `match_count: 0` are excluded from output.

## Error handling

If the discovery script errors (e.g., unreadable home directory, permission failure), let the error surface to the caller. Do not substitute git log, file listings, or other sources — this skill's contract is session metadata, nothing else.

If `_meta` reports `parse_errors > 0`, return the JSONL as-is. The caller decides how to handle partial data.

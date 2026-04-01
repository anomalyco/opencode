---
name: opencode-memory
description: Use when the user asks to recall prior OpenCode work, previous sessions, plans, prompt history, memory, or earlier project context stored on the local machine.
compatibility: opencode
---

# OpenCode Memory Browser

Lightweight, read-only access to your local OpenCode history. No injection, no bloat — just the ability to look things up when it would help.

This skill is specifically about OpenCode data stored on the local machine. It is not for ChatGPT history, Claude cloud history, generic browser history, or external memory products.

All data lives in local SQLite databases and plain files. You query them directly using `sqlite3` via bash. No bundled scripts or external dependencies needed.

## When to Use

### Auto-trigger (agent decides)

- You are resuming work on a project and suspect prior sessions exist.
- The user references something done previously ("we did this before", "last time", "that plan we made").
- A recurring issue suggests checking if it was encountered before.
- The user asks about the state of plans, past decisions, or previous approaches.
- You need context that might exist in history but is not in the current session.

### User-triggered (explicit request)

- "Check my history"
- "What did we do in the last session?"
- "Show me my plans"
- "Search for when we discussed X"
- "What projects have I worked on?"
- "Look at previous conversations about Y"

### Do NOT use when

- The task is clearly brand new with no relevant history.
- Fresh repo context (files, git log) is sufficient.
- The user explicitly says they don't care about prior work.

## Storage Locations

```
Databases:      ${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode*.db
Plans:          ${XDG_DATA_HOME:-$HOME/.local/share}/opencode/plans/*.md
Session diffs:  ${XDG_DATA_HOME:-$HOME/.local/share}/opencode/storage/session_diff/<session-id>.json
Prompt history: ${XDG_STATE_HOME:-$HOME/.local/state}/opencode/prompt-history.jsonl
```

The database path respects `$XDG_DATA_HOME` if set (default: `~/.local/share`).

Important: OpenCode may store session history in multiple channel-specific databases such as:

- `opencode.db`
- `opencode-dev.db`
- `opencode-local.db`
- other `opencode-<channel>.db` files

When recalling prior work, search **all local `opencode*.db` files**, not just `opencode.db`.

## Database Schema (what matters)

- **project** — `id` (text PK), `worktree` (path), `name` (often NULL, derive from worktree basename)
- **session** — `id` (text, e.g. `ses_xxx`), `project_id` (FK), `parent_id` (NULL = main session, set = subagent), `title`, `summary`, `time_created`, `time_updated`
- **message** — `id`, `session_id` (FK), `data` (JSON with `$.role` = `"user"` or `"assistant"`), `time_created`
- **part** — `id`, `message_id` (FK), `session_id` (FK), `data` (JSON with `$.type` = `"text"` and `$.text` = content)

Timestamps are Unix milliseconds. Use `datetime(col/1000, 'unixepoch', 'localtime')` to display them.

## Ready-to-Use Queries

All queries use `sqlite3` in read-only mode. Always run via bash.

**Shorthand used below:**

```
DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/opencode"
DBS=("$DATA_ROOT"/opencode*.db)
```

If the glob does not match anything, verify the storage root first with `ls "$DATA_ROOT"`.

### Quick summary

```bash
for DB in "${DBS[@]}"; do
  [ -f "$DB" ] || continue
  DB_URI="file:${DB}?mode=ro"
  printf '\n== %s ==\n' "$DB"
  sqlite3 "$DB_URI" "
    SELECT 'projects', COUNT(*) FROM project
    UNION ALL SELECT 'sessions (main)', COUNT(*) FROM session WHERE parent_id IS NULL
    UNION ALL SELECT 'sessions (total)', COUNT(*) FROM session
    UNION ALL SELECT 'messages', COUNT(*) FROM message
    UNION ALL SELECT 'todos', COUNT(*) FROM todo;
  "
done
```

### List projects

Set `DB_URI` to the database you want to inspect first, for example:

```bash
DB="$DATA_ROOT/opencode-dev.db"
DB_URI="file:${DB}?mode=ro"
```

```bash
sqlite3 "$DB_URI" "
  SELECT
    COALESCE(p.name, CASE WHEN p.worktree = '/' THEN '(global)' ELSE REPLACE(p.worktree, RTRIM(p.worktree, REPLACE(p.worktree, '/', '')), '') END) AS name,
    p.worktree,
    (SELECT COUNT(*) FROM session s WHERE s.project_id = p.id AND s.parent_id IS NULL) AS sessions
  FROM project p
  ORDER BY p.time_updated DESC
  LIMIT 10;
"
```

### List recent sessions

```bash
for DB in "${DBS[@]}"; do
  [ -f "$DB" ] || continue
  DB_URI="file:${DB}?mode=ro"
  sqlite3 "$DB_URI" "
    SELECT
      '${DB}' AS db,
      s.id,
      COALESCE(s.title, 'untitled') AS title,
      COALESCE(p.name, CASE WHEN p.worktree = '/' THEN '(global)' ELSE REPLACE(p.worktree, RTRIM(p.worktree, REPLACE(p.worktree, '/', '')), '') END) AS project,
      datetime(s.time_updated/1000, 'unixepoch', 'localtime') AS updated,
      (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS msgs
    FROM session s
    LEFT JOIN project p ON p.id = s.project_id
    WHERE s.parent_id IS NULL
    ORDER BY s.time_updated DESC
    LIMIT 10;
  "
done
```

### Sessions for a specific project

Set `DB_URI` to the likely matching database, then replace the worktree path with the actual project path:

```bash
sqlite3 "$DB_URI" "
  SELECT s.id, COALESCE(s.title, 'untitled'),
    datetime(s.time_updated/1000, 'unixepoch', 'localtime')
  FROM session s
  JOIN project p ON p.id = s.project_id
  WHERE p.worktree = '/path/to/project'
    AND s.parent_id IS NULL
  ORDER BY s.time_updated DESC
  LIMIT 10;
"
```

To find the worktree for the current directory: `git rev-parse --show-toplevel`

### Read messages from a session

Replace the session ID:

```bash
sqlite3 "$DB_URI" "
  SELECT
    json_extract(m.data, '$.role') AS role,
    datetime(m.time_created/1000, 'unixepoch', 'localtime') AS time,
    GROUP_CONCAT(json_extract(p.data, '$.text'), char(10)) AS text
  FROM message m
  LEFT JOIN part p ON p.message_id = m.id
    AND json_extract(p.data, '$.type') = 'text'
  WHERE m.session_id = 'SESSION_ID_HERE'
  GROUP BY m.id
  ORDER BY m.time_created ASC
  LIMIT 50;
"
```

### Search across all conversations

Replace the search term:

```bash
for DB in "${DBS[@]}"; do
  [ -f "$DB" ] || continue
  DB_URI="file:${DB}?mode=ro"
  sqlite3 "$DB_URI" "
    SELECT
      '${DB}' AS db,
      s.id AS session_id,
      COALESCE(s.title, 'untitled') AS title,
      json_extract(m.data, '$.role') AS role,
      datetime(m.time_created/1000, 'unixepoch', 'localtime') AS time,
      substr(json_extract(p.data, '$.text'), 1, 200) AS snippet
    FROM part p
    JOIN message m ON m.id = p.message_id
    JOIN session s ON s.id = m.session_id
    WHERE s.parent_id IS NULL
      AND json_extract(p.data, '$.type') = 'text'
      AND json_extract(p.data, '$.text') LIKE '%SEARCH_TERM%'
    ORDER BY m.time_created DESC
    LIMIT 10;
  "
done
```

### List saved plans

```bash
ls -lt "$DATA_ROOT"/plans/*.md 2>/dev/null | head -20
```

To read a specific plan:

```bash
cat "$DATA_ROOT"/plans/FILENAME.md
```

### Show recent prompt history

```bash
tail -20 "$STATE_ROOT"/prompt-history.jsonl
```

Each line is a JSON object. The user's input is typically in the `input` or `text` field.

## Workflow

### Quick recall (most common)

1. Check **prompt history first** with `rg -n -i "term1|term2" "$STATE_ROOT/prompt-history.jsonl"` to recover the user's original wording and likely time window.
2. Run the **summary** query across all local databases to see which DB/channel has the relevant history.
3. If you need sessions for the current project, get the worktree with `git rev-parse --show-toplevel`, then run the **project sessions** query against the likely matching DB(s).
4. If you need a specific topic, run the **search** query across all DBs using both the exact phrase and adjacent terms.
5. If you need full conversation detail, run the **messages** query with the session ID from the matching DB.

### Plan review

1. List plans with `ls -lt "$DATA_ROOT"/plans/*.md`.
2. Read a plan with `cat "$DATA_ROOT"/plans/<filename>.md`.

### Deep investigation

1. Search prompt history first to anchor wording/date.
2. Run **projects/sessions** across all local DBs.
3. Search with neighboring terms, not just the user’s remembered phrasing.
4. Read only the best candidate session tails before expanding further.
5. Cross-reference with session diffs or plans if needed.

## Critical Rules

1. **Read-only.** Never write to or modify the database or any OpenCode files.
2. **Use bash + sqlite3.** Do not try to read `opencode*.db` with the Read tool — they are binary files. Always query via `sqlite3` in bash.
3. **Don't dump everything.** Use `LIMIT` and `LIKE` to keep output focused. The database can contain tens of thousands of messages.
4. **Summarize for the user.** After retrieving data, distill the relevant parts. Don't paste raw query output.
5. **Respect privacy.** Session history may contain sensitive data. Only surface what is relevant to the current task.
6. **Set path variables first.** At the start of any memory lookup, set `DATA_ROOT`, `STATE_ROOT`, and `DBS` exactly as shown above so the commands work on XDG and non-XDG setups and cover every local channel database.

## Fallback: Web UI

If the user needs visual dashboards or a browsable interface:

1. Check if OpenCode web is running: `curl -s http://127.0.0.1:4096/api/health 2>/dev/null || echo "not running"`
2. If running, direct the user to `http://127.0.0.1:4096`.
3. If not running, suggest `opencode web`.
4. Note: `opencode.local` only works with mDNS enabled (`opencode web --mdns`). Don't assume it exists.

## Deep Reference

See `references/storage-format.md` for the full storage layout, all table schemas, and additional query examples.

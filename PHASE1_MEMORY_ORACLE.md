# Phase 1 Conversation Memory

## Scope
- Keep `opencode` core untouched.
- Index only `session_message` rows with `type = user` and `type = assistant`.
- For assistant rows, index only public `text` content. Skip reasoning, tool output, shell output, and system context.
- Make full-text conversation history the primary memory layer.
- Treat manual memory notes as optional, not required for normal operation.

## Primary Goal
- Automatically project conversation history into a searchable external index.
- Make restart-safe recall depend on full-text retrieval, not manual note discipline.
- Keep the main chat workflow non-blocking even when sync fails.

## Core Features
- `sync_trade_memory`: project conversation text from `opencode.db` into the external index.
- `search_trade_conversations`: query prior user and assistant text.
- `open_trade_conversation_source`: inspect one indexed source message with redaction.
- startup auto-sync plus debounced follow-up sync after activity.
- compatibility with both modern `session_message` storage and legacy `message` / `part` storage.

## Optional Features
- `store_trade_memory_note`
- `update_trade_memory_note_status`
- `search_trade_memory_notes`
- `render_trade_oracle_note` as a lightweight Decision Note template

These optional features may remain available in code, but they are not the primary operating path.

## Plugin Tools
- `sync_trade_memory`: copy searchable conversation text from `opencode.db` into the external SQLite index.
- `search_trade_conversations`: full-text search against the external conversation index.
- `open_trade_conversation_source`: inspect one indexed source message from `opencode.db`.
- `store_trade_memory_note`: store a manual memory note with source references.
- `update_trade_memory_note_status`: mark a note as `active`, `tentative`, or `deprecated`.
- `search_trade_memory_notes`: search or list stored memory notes.
- `render_trade_oracle_note`: emit the lightweight Decision Note template.

## Phase 1.2 Auto-Sync Plan
1. Run one automatic sync at plugin startup.
2. Schedule incremental sync after chat/tool activity with debounce.
3. Keep sync failures non-blocking and retry on later activity.
4. Use full-text history as the default retrieval surface.
5. Keep manual notes available only for explicit curation.

### Trigger Design
1. `config` hook schedules startup sync with zero delay.
2. generic `event` hook schedules a normal incremental sync.
3. `chat.message` and `tool.execute.after` remain lightweight fallback triggers.
4. Multiple triggers coalesce into one pending sync job.
5. A minimum interval prevents repeated sync churn during active sessions.

## Phase 1.1 Remediation Plan
1. Close secret exposure gaps.
2. Add note lifecycle management.
3. Add stale reconciliation for full resyncs.
4. Add incremental sync cursor for normal runs.
5. Detect source-path drift and stored schema-signature mismatch early.
6. Surface a warning when FTS falls back to `LIKE`.

### Implementation Order
1. Redact source-open output and note storage.
2. Recompute checksum from redacted text only.
3. Add `update_trade_memory_note_status`.
4. Add `stale` tracking plus full-resync cleanup.
5. Add incremental cursor metadata.
6. Improve default source DB detection.
7. Preserve search usability with explicit fallback warnings.

## External Storage
- Source DB default: `~/.local/share/opencode/opencode.db`
- Phase 1 memory DB default: `~/.local/share/opencode-trade/memory.sqlite3`
- The external DB is a projection, not the source of truth.
- `schema_meta.source_signature` is recorded so schema drift can be detected during manual review.
- Automatic sync uses incremental cursors for normal operation and full resync only when needed.
- Source extraction supports both modern `session_message` content and legacy `message` / `part` content.

## Optional Decision Note Template
```md
# Decision Note

## Issue
What decision must be made.

## Context
- Background:
- Constraints:

## Options
1.
2.

## Recommendation
- Proposed option:
- Why now:

## Risks
-

## Unknowns
-

## Rejected Options
-

## Human Approval
- Required: yes/no

## Next Action
-
```

## Guard Checklist
Run this checklist before destructive or production-adjacent work.

1. Does this command delete, rewrite history, or overwrite external files?
2. Does this change touch live trading, capital allocation, broker credentials, or production schedules?
3. Does this step execute remote code or fetched scripts without inspection?
4. Does this step rely on a Decision Note that still has unresolved unknowns?
5. Does this action need an explicit human GO/NO-GO decision?

If any answer is `yes`, stop and require human confirmation before proceeding.

## Known Limits
- Phase 1 sync is intentionally minimal. It indexes searchable text, not every event type.
- Reasoning content is excluded on purpose.
- Secrets are redacted in the external index, note storage, and source-open output with simple pattern rules. The source DB still remains authoritative.
- Incremental sync does not detect source-side deletions immediately. A full resync reconciles stale rows.
- If FTS parsing fails, search falls back to `LIKE` and emits a warning.
- Automatic sync is best-effort. It must never block the main chat workflow.
- Manual note curation is available but not required.
- The plugin does not enforce command blocking. The checklist is operational, not a hard gate.

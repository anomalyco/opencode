# Transcript Recall — Storage Schema

## Table: `recall_chunk`

| Column        | Type         | Constraint          | Description |
|---------------|--------------|---------------------|-------------|
| `id`          | TEXT         | PRIMARY KEY         | Deterministic chunk id. Format: `${part_id}:${chunk_index}` for per-part chunks, or `meta:${session_id}` for session anchors. |
| `session_id`  | TEXT         | NOT NULL            | Session that owns this chunk. |
| `message_id`  | TEXT         | NOT NULL            | Message within the session. For session anchors: literal `"meta"`. |
| `part_id`     | TEXT         | NOT NULL            | Part row that generated this chunk. For session anchors: same as `session_id`. |
| `chunk_index` | INTEGER      | NOT NULL            | 0-based index within the part. 0 for anchors. |
| `provider`    | TEXT         | NOT NULL            | Provider id (`"hashing"`, `"openai-embedding-3-small"`, etc.). |
| `dim`         | INTEGER      | NOT NULL            | Vector dimension. 256 for hashing, 1536 for openai-3-small, etc. |
| `model_id`    | TEXT         | NULL                | Human-readable model name. NULL allowed. |
| `text_hash`   | TEXT         | NOT NULL            | FNV-1a hash of `text` for change detection (8 hex chars). |
| `text`        | TEXT         | NOT NULL            | The actual chunk text, up to ~1200 chars. |
| `vec`         | BLOB         | NOT NULL            | Float32 vector bytes. `dim * 4` bytes. |

## Indexes

- `PRIMARY KEY (id)` — deterministic key, upsert-safe
- `INDEX (session_id)` — fast anchor chunk lookup
- `INDEX (part_id)` — fast deletion on part remove

## Size Estimates

Per chunk:
- Text: ~600 bytes average (1200 chars max in UTF-8)
- Vec: 256 * 4 = 1024 bytes (hashing) or 1536 * 4 = 6144 bytes (OpenAI 3-small)
- Overhead: ~150 bytes (indexes, sqlite row overhead)
- **Total**: ~1.8 KB per chunk (hashing), ~7 KB per chunk (OpenAI)

For 1000 sessions of 100 messages of 2 parts = 200,000 chunks:
- Hashing: ~360 MB
- OpenAI 3-small: ~1.4 GB

## Idempotency

- `id = ${part_id}:${chunk_index}` — same part re-indexed → same id → upsert (no duplicate)
- `id = meta:${session_id}` — session meta re-indexed → same id → upsert
- `text_hash` enables skip-if-unchanged: if `existing.text_hash === new_text_hash`, no re-embed

## Indexing Flow

1. EventV2 dispatches `PartUpdated` / `Updated` / `Removed` etc.
2. Indexer accumulates dirty `partIDs` and `sessionIDs` in memory
3. Debounced timer (2s) flushes accumulated sets:
   - Per-part chunks: read part rows, chunk text, embed, upsert
   - Anchor chunks: read session title + summaries, embed, upsert
4. Remove events: `deletePart`, `deleteMessage`, `deleteSession` cascade immediately

## Backfill

On startup, if the flag is enabled:
1. Read all part rows from `PartTable`
2. Read all distinct `part_id` values from `RecallChunkTable`
3. For each part without a chunk: queue for indexing (batches of 50)
4. For each session without an anchor: index the anchor

Backfill is idempotent (chunk id = deterministic) and runs in a forked scope so it doesn't block the main app.

## Provider Migration

When the provider changes (e.g., user sets `OPENCODE_RECALL_PROVIDER=openai`):

1. **Detect**: search filters rows where `provider != current.id` (line 227 of `indexer.ts`)
2. **Excluded from results**: cosine against wrong-dim vectors is meaningless
3. **Kept on disk**: rows are not deleted; they remain until:
   - The underlying part changes (event-driven re-embed)
   - Explicit rebuild command (Phase 3)
4. **No automatic re-embed** in Phase 1

## Delete Parity

- `PartRemoved` → `deletePart(partID)` removes all chunks for that part
- `MessageRemoved` → `deleteMessage({sessionID, messageID})` removes all chunks for that message
- `SessionDeleted` → `deleteSession(sessionID)` removes all chunks (and the anchor)

## Schema Diagram

```
┌──────────────────────┐       ┌──────────────────────┐
│ session              │       │ message              │
├──────────────────────┤       ├──────────────────────┤
│ id (PK)              │←──────│ session_id (FK)      │
│ title                │  1:N  │ id (PK)              │
│ ...                  │       │ data (json: summary) │
└──────────────────────┘       └──────────────────────┘
                                      │ 1:N
                                      ↓
                               ┌──────────────────────┐
                               │ part                 │
                               ├──────────────────────┤
                               │ id (PK)              │
                               │ message_id (FK)      │
                               │ session_id (FK)      │
                               │ data (json)          │
                               └──────────────────────┘
                                      │ 1:N
                                      ↓ (text parts only)
┌──────────────────────┐
│ recall_chunk         │
├──────────────────────┤
│ id (PK)              │ ← format: part_id:chunk_index OR meta:session_id
│ session_id (FK)      │
│ message_id           │
│ part_id (FK)         │
│ chunk_index          │
│ provider             │
│ dim                  │
│ model_id             │
│ text_hash            │
│ text                 │
│ vec (BLOB)           │
└──────────────────────┘
```

## Migration Definition

```typescript
// packages/core/src/database/migration/20260823000000_add_recall_chunk.ts
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260823000000_add_recall_chunk",
  sql: [
    `CREATE TABLE IF NOT EXISTS recall_chunk (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      part_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      provider TEXT NOT NULL,
      dim INTEGER NOT NULL,
      model_id TEXT,
      text_hash TEXT NOT NULL,
      text TEXT NOT NULL,
      vec BLOB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS recall_chunk_session_idx ON recall_chunk (session_id)`,
    `CREATE INDEX IF NOT EXISTS recall_chunk_part_idx ON recall_chunk (part_id)`,
  ],
} satisfies DatabaseMigration.Migration
```

## Drizzle Definition

```typescript
// packages/core/src/recall/sql.ts
import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const RecallChunkTable = sqliteTable(
  "recall_chunk",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id").notNull(),
    message_id: text("message_id").notNull(),
    part_id: text("part_id").notNull(),
    chunk_index: integer("chunk_index").notNull(),
    provider: text("provider").notNull(),
    dim: integer("dim").notNull(),
    model_id: text("model_id"),
    text_hash: text("text_hash").notNull(),
    text: text("text").notNull(),
    vec: blob("vec", { mode: "buffer" }).notNull(),
    ...Timestamps,
  },
  (t) => [
    index("recall_chunk_session_idx").on(t.session_id),
    index("recall_chunk_part_idx").on(t.part_id),
  ],
)
```

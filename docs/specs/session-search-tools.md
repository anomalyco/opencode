# Session Search & Read Tools

## Purpose

Add builtin tools for searching and reading OpenCode session transcripts, with optional Jina-backed semantic search, enabling agents to inspect past conversation history across sessions.

## Goals

- Provide 7 builtin tools: `session_search`, `session_search_global`, `session_read`, `session_tail`, `session_find`, `session_get`, `session_list`
- Lexical search always works (SQL queries against message content in the live DB)
- Semantic search via Jina embeddings when a Jina API key is configured in `opencode.json`
- Embedding results are cached by content fingerprint to avoid redundant API calls
- All tools follow the existing `Tool.define()` + Effect Schema pattern
- Graceful fallback: tools work without Jina (lexical-only), and fail informatively when sessions are missing

## Non-goals

- No separate search index database (MC plugin uses one because it can't access the DB directly; builtin tools can)
- No FTS5 virtual tables in phase 1 (add later if lexical `LIKE` queries prove too slow at scale)
- No incremental dirty-session tracking (query the live DB; the `time_updated` column already tracks freshness)
- No persistent vector storage (cache embeddings by fingerprint in a simple table with LRU eviction)
- No inter-agent messaging tools (`mc_session_send_async`, `mc_session_send_interrupt`) — those are MC-specific orchestration features
- No `mc_session_abort` — abort is an orchestration concern, not a search/read concern

## Current state

No session search or read tools exist in the opencode codebase. Session data is accessible through:

- `Session.Service` (Effect service) — `list()`, `listGlobal()`, `get()`, `messages()`, `children()`, `findMessage()`
- HTTP API endpoints (`GET /session`, `GET /session/:id/message`, etc.)
- `message` and `part` tables (Drizzle SQLite) with JSON `data` columns containing full message/part content

The `message.data` column holds `SessionV1.User | SessionV1.Assistant` JSON. The `part.data` column holds a discriminated union of 12 part types including `TextPart` (`{ text: string }`).

## Target architecture

### Tool inventory

| Tool | Parameters | Description |
|---|---|---|
| `session_search` | `query` (required), `exact` (optional: bool), `semantic` (optional: bool), `limit` (optional: number, default 10, max 50) | Search session transcripts in the current project/directory. Lexical search always runs; semantic search activates when `semantic: true` AND Jina API key is configured. |
| `session_search_global` | `query` (required), `exact` (optional: bool), `semantic` (optional: bool), `limit` (optional: number, default 10, max 50) | Same as `session_search` but searches across all projects globally. |
| `session_read` | `sessionId` (required), `beforeMessageId` (optional), `offset` (optional), `limit` (optional), `withToolOutputs` (optional: bool, default: false) | Read a session transcript with pagination. Returns messages with parts (text, file metadata, tool calls, reasoning). File metadata included by default. |
| `session_tail` | `sessionId` (required), `limit` (optional, default 20) | Return the most recent messages from a session. Lightweight — text-only, no tool output detail. |
| `session_find` | `title` (required), `scope` (optional: `"local"` / `"global"`), `limit` (optional, default 10) | Find sessions by title substring match. Returns session metadata candidates. |
| `session_get` | `sessionId` (required) | Return normalized session metadata (title, directory, workspace, timestamps, parent, model, cost, tokens, status). |
| `session_list` | `scope` (optional: `"local"` / `"global"`), `start` (optional: timestamp), `search` (optional: title search), `limit` (optional, default 20, max 100) | List sessions with filters. Delegates to `Session.Service.list()` / `listGlobal()`. Returns all sessions (parents and children). |

### Component layout

```
packages/opencode/src/tool/
├── session-search.ts          # session_search tool (local scope)
├── session-search-global.ts   # session_search_global tool (global scope)
├── session-read.ts            # session_read tool definition
├── session-tail.ts            # session_tail tool definition
├── session-find.ts            # session_find tool definition
├── session-get.ts             # session_get tool definition
├── session-list.ts            # session_list tool definition
├── session-search/
│   ├── index.ts               # SessionSearch service (orchestrates lexical + semantic)
│   ├── lexical.ts             # Lexical search: SQL queries against message/part tables
│   ├── semantic.ts            # Semantic search: Jina embeddings + cosine similarity
│   └── embedding-cache.ts     # Fingerprint-based embedding cache with LRU eviction
├── session-search.txt         # session_search description
├── session-search-global.txt  # session_search_global description
├── session-read.txt           # session_read description
├── session-tail.txt           # session_tail description
├── session-find.txt           # session_find description
├── session-get.txt            # session_get description
├── session-list.txt           # session_list description
```

Also modified:
```
packages/opencode/src/tool/registry.ts        # Register 6 new tools + add EmbeddingCache.Service dependency
packages/core/src/v1/config/config.ts          # Add session_search config schema to ConfigV1.Info
```

### Dependency graph

```
session-search / session-search-global tool
  └─ SessionSearchService.search(scope)
       ├─ LexicalSearch.search()
       │    └─ Database.Service (raw Drizzle queries on message + part tables)
       ├─ SemanticSearch.search()  [only when API key present + semantic: true]
       │    ├─ EmbeddingCache.Service (fingerprint cache with LRU eviction)
       │    └─ HttpClient (Jina embeddings API: POST https://api.jina.ai/v1/embeddings)
       └─ Session.Service (scope resolution: list() for local, listGlobal() for global)

session-read / session-tail / session-get
  └─ Session.Service (get, messages, children)

session-find / session-list
  └─ Session.Service (list, listGlobal)
```

## Data model / state ownership

### Embedding cache table (new, in main opencode DB)

```sql
CREATE TABLE IF NOT EXISTS session_search_embedding (
  fingerprint TEXT PRIMARY KEY,    -- sha256(content)
  vector BLOB NOT NULL,            -- Float32Array binary (4 bytes per dimension)
  dimensions INTEGER NOT NULL,     -- embedding dimension (e.g., 1024)
  model TEXT NOT NULL,             -- model identifier (e.g., "jina-embeddings-v5-text-small")
  created_at INTEGER NOT NULL,     -- unix millis, when first cached
  last_accessed_at INTEGER NOT NULL -- unix millis, bumped on every cache hit
);

-- LRU eviction index: fast lookup of oldest-accessed entries by model
CREATE INDEX IF NOT EXISTS idx_embedding_lru
  ON session_search_embedding(model, last_accessed_at);
```

**Storage format**: `Float32Array` binary, not JSON. Each dimension is 4 bytes (IEEE 754 single-precision float). A 1024-dim vector is exactly 4096 bytes in the BLOB.

```typescript
// Write (Binary Float32Array → BLOB)
function serializeEmbedding(vec: number[]): ArrayBuffer {
  return new Float32Array(vec).buffer
}

// Read (BLOB → Float32Array → number[])
function deserializeEmbedding(blob: ArrayBuffer): number[] {
  return Array.from(new Float32Array(blob))
}
```

This is ~2x more compact than JSON text (~4KB vs ~8KB for 1024-dim), zero-copy deserialization (no JSON.parse), and standard across vector database implementations.

**Why not JSON text?** JSON text stores each float as a variable-length decimal string (e.g., `0.123456789` = 12 bytes), while Float32 is always exactly 4 bytes. At 10,000 cached embeddings, that's 40MB binary vs ~80MB+ JSON. More importantly, `new Float32Array(buffer)` is O(1) — no parsing, no garbage from intermediate strings.

**Why not sqlite-vec or vec1 extension?** Those require loading native SQLite extensions, which adds deployment complexity for a cache table. We do cosine similarity in application code (dot product of two ~1024-element arrays); SQL-level KNN queries aren't needed when the candidate set is already pre-filtered by lexical search to <100 chunks.

**LRU eviction**: The `last_accessed_at` column is bumped on every cache hit (`get()`). On cache miss when inserting a new entry, if the total row count exceeds `max_entries` (default 10,000, configurable via `session_search.embedding_cache_max_entries`), the oldest `last_accessed_at` entries are deleted:

```sql
-- Evict oldest entries when over capacity
DELETE FROM session_search_embedding
WHERE fingerprint IN (
  SELECT fingerprint FROM session_search_embedding
  ORDER BY last_accessed_at ASC
  LIMIT MAX(0, (SELECT COUNT(*) FROM session_search_embedding) - ?)
)
```

| Config key | Default | Description |
|---|---|---|
| `session_search.embedding_cache_max_entries` | 10000 | Max cached embedding entries before LRU eviction |

**Config-driven model invalidation**: When `semantic_model` changes, all cached entries for the old model are stale. The cache layer compares `semantic_model` config against `model` column on read — mismatches are treated as cache misses. A separate `invalidateByModel()` can bulk-delete old model entries.

**No separate chunk table**: Chunks are ephemeral — extracted from `message`/`part` tables on each search. Only embeddings are persisted. This avoids the complexity of tracking dirty sessions and index freshness.

### Config schema addition

```typescript
// packages/core/src/v1/config/config.ts — add to ConfigV1.Info:
session_search: Schema.optional(
  Schema.Struct({
    jina_api_key: Schema.optional(Schema.String).annotate({
      description: "Jina AI API key for semantic session search (https://jina.ai)"
    }),
    semantic_enabled: Schema.optional(Schema.Boolean).annotate({
      description: "Enable semantic search (requires jina_api_key). Defaults to true when key is present."
    }),
    semantic_model: Schema.optional(Schema.String).annotate({
      description: "Jina embeddings model. Default: jina-embeddings-v5-text-small"
    }),
    semantic_endpoint: Schema.optional(Schema.String).annotate({
      description: "Jina embeddings API endpoint. Default: https://api.jina.ai/v1/embeddings"
    }),
    semantic_request_timeout_ms: Schema.optional(Schema.Number).annotate({
      description: "Timeout for Jina API requests in ms. Default: 30000"
    }),
    embedding_cache_max_entries: Schema.optional(Schema.Number).annotate({
      description: "Max cached embedding entries before LRU eviction. Default: 10000"
    }),
  })
).annotate({ description: "Session search configuration" })
```

## Data flow / lifecycle

### session_search / session_search_global

```
1. Agent calls session_search({ query: "retry logic", semantic: true, limit: 10 })
   (or session_search_global for cross-project scope)
2. Title pre-filter:
   a. Resolve scope:
      - session_search → Session.Service.list({ search: query, directory, ... })
      - session_search_global → Session.Service.listGlobal({ search: query, ... })
   b. Collect candidate session IDs (title LIKE %query% match)
3. LexicalSearch.search(candidateSessionIds):
   a. For each candidate session, query message + part tables
   b. Extract text from TextPart entries in part.data JSON
   c. Score by: exact phrase match (100pts), term overlap (3pts/term), recency bonus
   d. Return ranked list of { sessionId, messageId, score, snippet }
4. If semantic: true AND config has jina_api_key AND provider available:
   a. SemanticSearch.search(query, lexicalCandidates):
      i.   Embed query via Jina API (POST /v1/embeddings, task: "retrieval.query")
      ii.  For each candidate chunk (extracted text from lexical results):
           - Compute fingerprint = sha256(chunkText)
           - Check EmbeddingCache for fingerprint (bump last_accessed_at on hit)
           - If miss: embed via Jina API (task: "retrieval.passage"), cache as Float32Array BLOB
           - On insert, run LRU eviction if over max_entries
      iii. Compute cosine similarity (query vec · chunk vec) via dot product on Float32Array
      iv.  Re-rank by similarity score
   b. If semantic unavailable (no key, API error, timeout): return lexical results
5. Return top `limit` results with snippets, scores, session metadata
```

### session_read

```
1. Agent calls session_read({ sessionId: "ses_abc", limit: 50 })
2. Session.Service.get(id) → resolve session metadata
3. Session.Service.messages({ sessionID: id, limit }) → paginated WithParts[]
4. Normalize each message:
   - role: "user" | "assistant"
   - content: concatenated TextPart texts
   - files: FilePart metadata (mime, url, filename) — included by default
   - tool calls: ToolPart summary (tool name, status) — when withToolOutputs: true, also include input/output
   - reasoning: ReasoningPart text when present
   - timestamps, model info, token counts
5. Return transcript entries with pagination metadata
```

### session_tail

```
1. Agent calls session_tail({ sessionId: "ses_abc", limit: 10 })
2. MessageV2.page({ sessionID, limit, before: undefined }) → most recent messages
3. Extract text-only content (no tool outputs), role, agent, timestamps
4. Return lightweight entries
```

### session_find

```
1. Agent calls session_find({ title: "retry", scope: "local" })
2. Session.Service.list({ search: "retry", roots: true, ...scope }) → Info[]
3. Return metadata candidates with ambiguous flag
```

### session_get

```
1. Agent calls session_get({ sessionId: "ses_abc" })
2. Session.Service.get(id) → Info
3. Return normalized metadata
```

### session_list

```
1. Agent calls session_list({ scope: "local", roots: true, limit: 20 })
2. Session.Service.list({ ...params }) → Info[]
3. Return session list with metadata
```

## Interfaces and contracts

### LexicalSearch interface

```typescript
interface LexicalSearch {
  search(input: {
    query: string
    sessionIds?: SessionID[]     // pre-filtered candidates from scope resolution
    exact?: boolean              // exact phrase match only
    limit: number
  }): Effect.Effect<LexicalMatch[]>
}

interface LexicalMatch {
  sessionId: SessionID
  messageId: MessageID
  partId?: PartID
  content: string                // matched text snippet
  score: number                  // 0–100+ range
  role: "user" | "assistant"
  createdAt: number              // message timestamp
}
```

### SemanticSearch interface

```typescript
interface SemanticSearch {
  search(input: {
    query: string
    candidates: LexicalMatch[]   // pre-filtered lexical results to re-rank
    limit: number
  }): Effect.Effect<SemanticMatch[], SemanticSearchError>

  isAvailable(): Effect.Effect<boolean>
}

interface SemanticMatch {
  sessionId: SessionID
  messageId: MessageID
  content: string
  score: number                  // cosine similarity [0, 1]
}

type SemanticSearchError = 
  | { _tag: "JinaApiError", status: number, message: string }
  | { _tag: "JinaTimeout", timeoutMs: number }
  | { _tag: "EmbeddingCacheError", cause: unknown }
```

### EmbeddingCache interface

```typescript
interface EmbeddingCache {
  /** Retrieve a cached embedding vector. Bumps last_accessed_at on hit. */
  get(fingerprint: string): Effect.Effect<Option<Float32Array>>

  /** Store an embedding as Float32Array binary. Evicts LRU entries if over max_entries. */
  set(fingerprint: string, vector: number[], dimensions: number, model: string): Effect.Effect<void>

  /** Bulk-delete all cached entries for a given model (e.g., after model change). */
  invalidateByModel(model: string): Effect.Effect<void>

  /** Return total cached entries (for diagnostics). */
  count(): Effect.Effect<number>
}
```

### Jina embeddings client

```
POST https://api.jina.ai/v1/embeddings
Authorization: Bearer {jina_api_key}
Content-Type: application/json

{
  "model": "jina-embeddings-v5-text-small",
  "task": "retrieval.query",      // or "retrieval.passage"
  "input": ["search query text"]  // or array of chunk texts
}

Response:
{
  "data": [{ "index": 0, "embedding": [0.123, -0.456, ...] }],
  "model": "jina-embeddings-v5-text-small",
  "usage": { "total_tokens": 5 }
}
```

Batch size: 64 chunks per request (same as MC plugin). Embeddings are L2-normalized by Jina, so cosine similarity = dot product.

## Implementation notes

### Lexical search implementation

Message text extraction from the `message` and `part` tables:

```typescript
// SessionV1.User data shape (message.data when role === "user"):
//   { role: "user", id: "msg_...", content: "..." }
//
// SessionV1.Assistant data shape (message.data when role === "assistant"):
//   { role: "assistant", id: "msg_...", ... }
//   Text content comes from associated Part rows where data.role === "text"

// Extraction approach:
// 1. Query message table for candidate session IDs
// 2. For each: query part table, filter TextParts, extract data.text
// 3. Concatenate text for each message
// 4. Score against query
```

Use `json_extract` in SQL where possible for filtering, but extract and score in application code for flexibility.

### Semantic search cache behavior

- **Cache key**: `sha256(chunkText)` — raw content fingerprint. Same content always maps to same embedding regardless of session, message, or part ID.
- **Storage**: `Float32Array` binary in BLOB column. 4 bytes per dimension (4096 bytes for 1024-dim).
- **Cache miss**: Call Jina API, serialize embedding as `Float32Array`, store BLOB. Before insert, check `COUNT(*)` — if over `max_entries` (default 10000), evict oldest `last_accessed_at` rows.
- **Cache hit**: Deserialize BLOB → `Float32Array`, bump `last_accessed_at`. Compute dot product with query vector.
- **Cache invalidation**: Only when `semantic_model` config changes. `invalidateByModel()` bulk-deletes. Content changes produce different fingerprints, so old entries simply become unreachable.
- **Last-accessed tracking**: `last_accessed_at` is set to `created_at` on insert, and updated to `Date.now()` on every cache hit. Used for LRU eviction ordering.

### Error handling

| Scenario | Behavior |
|---|---|
| Jina API key not configured | semantic search unavailable; `semantic: true` is a no-op. Return lexical results. |
| Jina API returns error (4xx/5xx) | Log warning, fall back to lexical results. Do not fail the tool. |
| Jina API timeout (30s) | Fall back to lexical results. Warn that semantic search timed out. |
| Session not found | Return structured error with suggestion to use session_find or session_list |
| Empty search results | Return empty list with metadata (no matches found) |
| Message content extraction fails | Skip that message, continue with others |

### Tool description text files

Each tool gets a `.txt` file following the existing convention (e.g., `grep.txt`). These are imported as `DESCRIPTION` strings. The description must guide the LLM on when and how to use the tool.

### Registration in ToolRegistry

Add to `packages/opencode/src/tool/registry.ts`:

```typescript
// In the Effect.all({...}) block:
session_search: Tool.init(sessionSearch),
session_search_global: Tool.init(sessionSearchGlobal),
session_read: Tool.init(sessionRead),
session_tail: Tool.init(sessionTail),
session_find: Tool.init(sessionFind),
session_get: Tool.init(sessionGet),
session_list: Tool.init(sessionList),

// In the builtin array:
tool.session_search,
tool.session_search_global,
tool.session_read,
tool.session_tail,
tool.session_find,
tool.session_get,
tool.session_list,
```

### Config access pattern

Tools read config via `Config.Service`:

```typescript
const config = yield* Config.Service
const searchConfig = config.get().pipe(Effect.map(c => c.session_search))
const jinaKey = searchConfig?.jina_api_key
```

### Semantic search enablement

Semantic search is enabled when ALL of:
1. `session_search.semantic_enabled` is `true` (or absent/true with a key present)
2. `session_search.jina_api_key` is set (non-empty string)
3. The tool call includes `semantic: true`

When semantic is unavailable, the tool returns lexical results without error — it silently degrades, noting the mode in the result metadata.

## Validation strategy

### Unit tests (`packages/opencode/test/tool/`)

| Test file | What it validates |
|---|---|
| `session-search.test.ts` | Lexical search: query matching, scoring, result ordering, empty results. Semantic search: mock Jina API, cache hits/misses, cosine similarity, fallback behavior. |
| `session-read.test.ts` | Message pagination, with/without tool outputs, beforeMessageId cursor, limit clamping. |
| `session-tail.test.ts` | Latest N messages, text-only extraction, empty session. |
| `session-find.test.ts` | Title matching, scope filtering, ambiguous results. |
| `session-get.test.ts` | Metadata normalization, missing session error. |
| `session-list.test.ts` | Filter combinations, pagination, scope resolution. |

### Integration tests

- End-to-end with a real SQLite DB containing session data
- Mock Jina API with `nock` or similar for semantic search tests
- Verify tool output format matches `ExecuteResult` contract

### Manual smoke tests

```bash
# Typecheck
bun --cwd packages/opencode typecheck

# Run session tool tests
bun --cwd packages/opencode test test/tool/session-search.test.ts
bun --cwd packages/opencode test test/tool/session-read.test.ts
# ... etc
```

### Config validation

- `session_search.jina_api_key` must be a non-empty string to enable semantic search
- `session_search.semantic_model` must be a valid Jina model identifier
- Invalid config logs a warning, semantic search is disabled

## Risks and tradeoffs

| Risk | Mitigation |
|---|---|
| Lexical `LIKE` queries on large `message` tables are slow | Use `time_updated` index for recency pre-filtering. Add FTS5 in phase 2 if profiling shows >500ms. |
| Jina API costs for embedding every new chunk | Fingerprint cache prevents re-embedding. Lexical pre-filtering limits chunks sent to Jina (only top N lexical results). |
| Embedding cache table grows unboundedly (e.g., from many unique chunk variations) | LRU eviction on `last_accessed_at` keeps table bounded at `max_entries` (default 10,000). Eviction runs on insert when over capacity. |
| Jina API key exposure in tool results/errors | Never include the API key in tool output, error messages, or metadata. Redact from logs. |
| Low-quality semantic results on technical content | Jina embeddings v5 is trained on code and technical text. Lexical results always available as fallback. |
| Cosine similarity computation overhead for large result sets | Candidate set is limited by lexical pre-filtering (typically <100 chunks). Dot product on 1024-dim vectors is fast. |
| Session data access during active prompts | `Session.Service` reads are transactional (WAL mode). No risk of inconsistent reads. |

**Tradeoff**: Lexical SQL queries are simpler than building FTS5 + incremental indexing, but O(n) per search. For interactive LLM use (infrequent searches across hundreds of messages), this is acceptable. The MC plugin's elaborate search index was necessary because it couldn't query the DB directly. As builtin tools, we pay linear scan cost instead of index maintenance cost.

**Tradeoff**: Binary Float32Array storage is ~2x more compact than JSON text (4KB vs ~8KB per 1024-dim vector) and zero-copy deserializable, but not human-readable in `SELECT *` queries. For debugging, provide a diagnostic view that converts BLOBs to arrays on read. At 10,000 entries with LRU eviction, worst-case storage is ~40MB — acceptable for a local dev tool.

**Tradeoff**: The `last_accessed_at` column adds a write on every cache hit, but B-tree index updates are cheap and this keeps eviction O(log n). An alternative (sampling-based eviction like Redis) would avoid the write but add complexity for marginal gain at this scale.

## Open questions

*All resolved. No blocking questions remain.*

1. **Resolved: scope split** — `session_search` for local (current project), `session_search_global` for cross-project. No `scope` parameter.
2. **Resolved: file metadata** — `session_read` includes file metadata by default.
3. **Resolved: LRU eviction** — Implemented. Embeddings stored as binary `Float32Array` in BLOB column. Eviction on insert when `COUNT(*)` exceeds `embedding_cache_max_entries`.
4. **Resolved: late_chunking** — Skipped.
5. **Resolved: title pre-filter** — Before scanning message content, match sessions by `title LIKE %query%`. Reduces candidate set before expensive message text extraction.
6. **Resolved: `session_list` simplicity** — No `roots` parameter. Always returns all sessions (parents and children). Keep tool surface small for LLM usability.

---

*Inspired by the mission control plugin's session search architecture (`opencode-mission-control/src/search/`), adapted for direct database access as builtin tools.*

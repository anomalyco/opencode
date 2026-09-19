# ADR: Transcript Recall — Local Semantic Index for Session History

**Status**: Implemented (draft PR)  
**Date**: 2026-08-31  
**Author**: Allan Santos  
**PR**: [#46397](https://github.com/anomalyco/opencode/pull/46397)  
**Closes**: [#41354](https://github.com/anomalyco/opencode/issues/41354)

---

## 1. Context & Problem Statement

Users and subagents need to recall facts from past sessions ("what did we decide about X?", "how did we configure the git hooks?"). Currently:

- Session history is keyed by id with no content index
- No way to search across sessions
- Subagents start each session with zero context about prior decisions

**User pain**: "I asked the same thing 3 days ago and have to re-explain the whole context."

---

## 2. Proposed Solution

An opt-in background indexer that embeds transcript chunks into SQLite and exposes a `recall` tool the LLM can call at any time.

### Core Design

```
EventV2 (durable) → RecallIndexer (background) → SQLite (recall_chunk)
                                                          ↓
User/Agent query → recall tool → cosine search → Hit[]
```

**Two indexing layers:**

1. **Per-part chunks**: each text part (after compaction/terminal state) is chunked (~1200 chars) and embedded. Indexed incrementally via durable event subscription — zero impact on LLM hot path.

2. **Per-session anchors**: session title + compaction summaries are indexed as a single anchor chunk, giving aggregate queries a high-precision entry point.

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Opt-in via `OPENCODE_EXPERIMENTAL_TRANSCRIPT_RECALL` | Gate behind umbrella flag; users must explicitly enable |
| Event subscription via EventV2 (durable) | Sessions survive restarts; no race conditions |
| Deterministic hashing provider (Phase 1) | Zero deps, zero API cost, proves the pipeline |
| Chunk id = `${part_id}:${chunk_index}` | Deterministic — re-index = upsert, not duplicate |
| SQLite vec as BLOB | Aligns with existing DB infrastructure |
| `cosine(a, b)` open-coded | No ML library dependency |
| Debounced flush every 2s | Batch writes, avoid churn from streaming |

### What is NOT in scope (Phase 1)

- Real embedding model (Phase 2 — pluggable `EmbeddingProvider` interface)
- Vector index (HNSW/IVF) — search is O(n) over all chunks
- Cloud sync of index
- Session deletion propagation to external storage

---

## 3. Technical Design

### Storage

See `specs/storage/transcript-recall-schema.md`

### Embedding Provider Interface

See `specs/transcript-recall/provider-interface.md`

### Flag Wiring

- `packages/core/src/flag/flag.ts`: `OPENCODE_EXPERIMENTAL_TRANSCRIPT_RECALL`
- `packages/opencode/src/effect/runtime-flags.ts`: `experimentalTranscriptRecall`
- `packages/opencode/src/tool/registry.ts`: `recalltool` registered conditionally

### Event Subscriptions

| Event | Handler | Action |
|---|---|---|
| `SessionV1.Event.PartUpdated` | `touched.add(partId)` | Flag for indexing |
| `SessionV1.Event.Updated` | `touchedSessions.add(id)` | Flag anchor re-index |
| `SessionV1.Event.PartRemoved` | `deletePart(partId)` | Remove chunks |
| `SessionV1.Event.MessageRemoved` | `deleteMessage({sessionID, messageID})` | Remove chunks |
| `SessionV1.Event.Deleted` | `deleteSession(sessionID)` | Remove all session chunks |

Flush timer (2s): drains `touched` + `touchedSessions` sets, indexes, clears.

---

## 4. Migration Path

- New migration `20260823000000_add_recall_chunk` adds table + 3 indexes
- Backfill on startup: scan part table for parts without chunks, index in batches of 50
- Backfill is idempotent (chunk id = deterministic key → upsert)

---

## 5. Security & Privacy

- All data is local (SQLite on disk)
- No network calls in Phase 1 (hashing provider)
- No PII externalization
- Flag defaults to `false` — users opt-in explicitly

---

## 6. Performance Characteristics

| Metric | Value |
|---|---|
| Indexing throughput | >50 parts/sec |
| Flush latency P95 | <2.2s (debounce 2s + index time) |
| Search latency | O(n) over all chunks — no index |
| Storage per chunk | ~1.1 KB (256*4 vec + text + overhead) |
| Memory per search | ~n * 1.1 KB (buffers all chunks) |

---

## 7. Open Questions (Phase 2)

1. Real embedding model selection (OpenAI, Vertex, local)
2. Vector index (HNSW/IVF) for search at 10k+ sessions
3. Weighted search (anchor chunks rank higher for aggregate queries)
4. Permission model (can user X search user Y's sessions?)
5. Retention policy (TTL on recall_chunk rows)

---

## 8. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-23 | Deterministic hash for Phase 1 POC | Zero deps, proves pipeline |
| 2026-08-23 | 2s debounced flush | Batch writes, avoid streaming churn |
| 2026-08-31 | Deterministic chunk id for upsert | Re-index idempotent |

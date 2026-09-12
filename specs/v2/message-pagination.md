# Session Message List: Total And Seek

Status: design  
Tracking: [#44660](https://github.com/anomalyco/opencode/issues/44660)  
Related: [#6548](https://github.com/anomalyco/opencode/issues/6548), [#35895](https://github.com/anomalyco/opencode/issues/35895), [#43766](https://github.com/anomalyco/opencode/issues/43766)  
Chinese: [`message-pagination.zh.md`](./message-pagination.zh.md)

## Problem

`GET /api/session/:sessionID/message` supports bounded sequential pagination through `limit`, `order`, and opaque `cursor`. Clients can open at the newest or oldest edge and walk forward or backward.

That contract does **not** expose:

1. The session's projected message **total**
2. A way to open a page at an **unvisited intermediate position** without walking every cursor

External clients that render a bounded transcript with a scrollbar or jump-to-position control (for example CodeNomad) currently must either load the full timeline or issue O(n / limit) round trips. First-party TUI and App do not need this yet, but the storage model already supports cheap seek.

## Current Behavior

Public query (`packages/protocol/src/groups/message.ts`):

```text
limit?: 1..200
order?: asc | desc          # first page only; cannot combine with cursor
cursor?: opaque             # encodes { id, order, direction }
```

Public response:

```text
{ data: Message[], cursor: { previous?, next? } }
```

Core read path (`SessionV2.messages` in `packages/core/src/session.ts`):

- Resolves an opaque cursor's projected message `id` to `session_message.seq`
- Pages with `ORDER BY seq` and exclusive `seq` boundaries
- Does not return total, dense rank, or a seek mode

Storage already provides:

- `session_message.seq` — durable projection order, unique per `(session_id, seq)`
- Index `session_message_session_seq_idx`

Schema changelog already records that message pagination must follow durable `seq`, not wall-clock time. This design keeps that rule and only extends the public read contract.

## Goals

- Return a stable **total** for the projected message list of one session
- Allow one-shot **seek** to a dense timeline index or a known message ID
- Preserve existing cursor pagination as the primary sequential navigation mode
- Avoid exposing durable event `seq` on the public wire
- Require no database migration

## Non-Goals

- Classical multi-page `offset` pagination as the main navigation model
- Public durable `seq` / aggregate-event cursors on the message list (use `session.history` / `session.events` for event replay)
- Transcript revision tokens ([#43766](https://github.com/anomalyco/opencode/issues/43766)) — complementary, not required for v1 of this slice
- Filtering totals by message type, compaction-active context only, or model-visible history
- Changing V1 `MessageV2.page` / legacy `/session/:id/message` behavior
- Guaranteeing exact scrollbar stability under concurrent append/revert between requests

## Design Decisions

### 1. Keep opaque cursors for sequential walks

After any seek, clients continue with `cursor.previous` / `cursor.next`. Seek is only a first-page positioning primitive.

### 2. Do not publish `seq`

`session_message.seq` is a durable aggregate sequence with intentional gaps (non-message events, deletions after revert). Publishing it would couple clients to event plumbing and invite incorrect "page number" math.

Public position is a **dense rank**: zero-based index in the requested `order` over currently projected `session_message` rows.

### 3. Prefer dense `index` over lasting `offset` pages

`index` is accepted only for the initial seek window. It is implemented with `ORDER BY seq … LIMIT limit OFFSET index` (direction depends on `order`), then the handler returns ordinary opaque cursors for the resulting page.

Document concurrent mutation as approximate: if messages are appended or removed between scrub gestures, the opened window may shift by a few items. Clients that need exact identity should prefer `around=<messageID>`.

### 4. Always return `total` and `startIndex`

Every successful list response includes:

- `total` — `COUNT(*)` of projected messages for the session
- `startIndex` — dense rank of `data[0]` in the requested order when `data` is non-empty; omitted when empty

This lets scrollbar UIs size the track from `total` and place the loaded window from `startIndex` without a second request.

`COUNT(*)` over the session-scoped unique index is cheap relative to hydrating message payloads.

### 5. Mutually exclusive positioning modes

A request may use **exactly one** of:

| Mode | Query | Meaning |
|------|-------|---------|
| Edge / default | `order` only | Existing first-page behavior (`desc` default) |
| Cursor walk | `cursor` | Existing sequential page |
| Index seek | `index` (+ optional `order`) | Open a window at dense rank |
| Message seek | `around` (+ optional `order`) | Open a window containing that message |

Illegal combinations return `InvalidCursorError` or `InvalidRequestError` with an explicit message:

- `cursor` with `order`
- `cursor` with `index` or `around`
- `index` with `around`
- `index` / `around` with `cursor`

### 6. `around` window policy

Given `around=msg_*`, `limit=L`, and `order`:

1. Resolve the message; missing message → empty `data`, still return `total`
2. Compute its dense rank `r` in the requested order
3. Choose `start = max(0, r - floor((L - 1) / 2))`
4. Load `LIMIT L OFFSET start` in that order
5. Return that page plus cursors, `total`, and `startIndex`

The target message is included whenever it still exists and `L >= 1`. Near the edges the window clamps instead of undershooting.

## Public Contract

### Query

```ts
SessionMessagesQuery = {
  limit?: 1..200                 // default 50 (unchanged)
  order?: "asc" | "desc"         // default "desc"; first-page / seek only
  cursor?: string                // opaque; exclusive with order/index/around
  index?: NonNegativeInt         // dense rank seek; exclusive with cursor/around
  around?: SessionMessage.ID     // message-centered seek; exclusive with cursor/index
}
```

### Response

```ts
SessionMessagesResponse = {
  data: SessionMessage.Message[]
  cursor: {
    previous?: string
    next?: string
  }
  total: NonNegativeInt
  startIndex?: NonNegativeInt    // present iff data.length > 0
}
```

### Client recipes

Newest window (unchanged):

```http
GET /api/session/{id}/message?limit=50
```

Oldest window (unchanged):

```http
GET /api/session/{id}/message?limit=50&order=asc
```

Scrollbar jump to ~40% of a 2000-message transcript in ascending order:

```http
GET /api/session/{id}/message?limit=50&order=asc&index=800
```

Deep link / restore around a known message:

```http
GET /api/session/{id}/message?limit=50&order=asc&around=msg_...
```

Continue walking after any of the above:

```http
GET /api/session/{id}/message?limit=50&cursor={cursor.next}
```

## Core API Shape

Extend `SessionV2.Interface.messages` so HTTP stays a thin adapter:

```ts
messages(input: {
  sessionID: SessionSchema.ID
  limit?: number
  order?: "asc" | "desc"
  cursor?: { id: SessionMessage.ID; direction: "previous" | "next" }
  index?: number
  around?: SessionMessage.ID
}): Effect.Effect<
  {
    messages: SessionMessage.Message[]
    total: number
    startIndex?: number
  },
  NotFoundError | MessageDecodeError | InvalidMessagesQueryError
>
```

Suggested internal helpers (same module or adjacent, not exported unless reused):

- `countMessages(db, sessionID)`
- `denseRank(db, sessionID, messageID, order)` — `COUNT` of rows strictly before the target in the requested order
- Existing seq-boundary page query, plus an `OFFSET` variant for seek

Keep `sessions.context(...)` unchanged. Context remains "active model history after compaction," not the full projected list total.

## HTTP Handler Changes

`packages/server/src/handlers/message.ts`:

1. Validate exclusive positioning modes before decoding the cursor
2. Call the expanded `session.messages(...)`
3. Map returned messages to opaque cursors exactly as today
4. Forward `total` and `startIndex`

No change to Location middleware or route path.

## SDK And OpenAPI

1. Update `packages/protocol/src/groups/message.ts`
2. Run `bun run generate` from `packages/client` (do not hand-edit `src/generated`)
3. Record the contract change in `specs/v2/schema-changelog.md`

## Correctness Notes

### What `total` counts

All projected rows in `session_message` for that session, including system, compaction, agent/model switch, shell, user, and assistant messages. This matches today's list endpoint, which does not filter by type.

It is **not**:

- Active post-compaction context size (`session.context`)
- Durable event log length (`session.history`)
- Pending unpromoted inbox inputs (`session_input`)

### Dense rank vs durable `seq`

```text
projected rows ordered by seq asc:  [msg_a seq=10, msg_b seq=40, msg_c seq=41]
dense ranks asc:                    [0, 1, 2]
```

Revert/delete that removes later rows shrinks `total` and renumbers dense ranks after the deletion point. Clients must refresh `total` / `startIndex` after observing transcript mutations (events or a later list call). A future revision token ([#43766](https://github.com/anomalyco/opencode/issues/43766)) can make staleness explicit; this slice does not block on it.

### Cursor exhaustion

Today the handler emits `previous`/`next` whenever the page is non-empty, even at an edge. This design does not require fixing that, but implementations may tighten cursors to omit a direction when no further row exists. If tightened, document it in the schema changelog as intentional behavior.

## Implementation Plan

1. **Core** — expand `SessionV2.messages` return type; add count + seek paths; keep cursor path byte-compatible for callers that ignore new fields during the PR if needed by updating all in-repo call sites in the same change
2. **Protocol** — extend query/response schemas and OpenAPI text
3. **Server** — validate combinations; adapt handler
4. **Generate** — `bun run generate` in `packages/client`
5. **Changelog** — add a dated entry under `specs/v2/schema-changelog.md`
6. **Tests** — see below
7. **Docs** — short note in V2 client docs / issue reply linking this spec

Suggested PR title: `feat(protocol): session message total and seek`

## Tests

### Core (`packages/core/test`)

- `total` equals inserted projected row count
- `order=asc&index=0` returns the oldest page; `startIndex === 0`
- `order=desc&index=0` returns the newest page; `startIndex === 0`
- `index` near `total - 1` clamps without error
- `index >= total` returns empty `data`, still returns `total`, omits `startIndex`
- `around` includes the target and clamps at both edges
- `around` missing ID returns empty page + `total`
- After seek, `cursor` next/previous continues contiguous dense order
- Reject illegal combinations

### Server / HttpApi (`packages/opencode/test/server` or core server tests)

- Query schema accepts `index` / `around`
- Illegal combinations map to the declared 4xx error
- Response JSON includes `total` and `startIndex`
- Generated SDK types compile against the new shape

Avoid wall-clock sleeps; seed deterministic projected rows (existing projector / publish helpers).

## Worked Example

Session has 7 projected messages in ascending dense order `m0…m6`.

```http
GET /api/session/ses_x/message?limit=3&order=asc&index=3
```

```json
{
  "data": ["m3", "m4", "m5"],
  "cursor": { "previous": "…", "next": "…" },
  "total": 7,
  "startIndex": 3
}
```

```http
GET /api/session/ses_x/message?limit=3&order=asc&around=m1
```

```json
{
  "data": ["m0", "m1", "m2"],
  "cursor": { "previous": "…", "next": "…" },
  "total": 7,
  "startIndex": 0
}
```

## Rollout

- Experimental V2 route; additive response fields are backward compatible for clients that ignore unknown JSON keys only if they already tolerate extras — generated SDK consumers must regenerate
- No migration; no change to projection writers
- Answer [#44660](https://github.com/anomalyco/opencode/issues/44660) with: no seek exists today; this spec is the supported shape if maintainers accept the PR

## Open Questions For Maintainers

1. Should `total` / `startIndex` always be present, or gated behind `meta=1` to shave a `COUNT` on hot first-paint paths? Recommendation: always present; count cost is dominated by payload hydration.
2. Should illegal combinations reuse `InvalidCursorError` or a dedicated `InvalidRequestError`? Recommendation: `InvalidRequestError` for `index`/`around` conflicts; keep `InvalidCursorError` for malformed/combined `cursor`.
3. Is tightening edge cursors in-scope for the same PR? Recommendation: yes if tests stay small; otherwise follow-up.

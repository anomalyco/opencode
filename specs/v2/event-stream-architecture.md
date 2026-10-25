# V2 Event Stream Architecture

## Decision

The public HTTP event stream uses one Server-scoped encoded feed with one independently bounded queue per connection.

```text
Core EventV2.listen()
          |
          | one global subscription
          v
Server EventFeed
  public filter
  schema encode
  JSON encode
  SSE frame once
          |
          | nonblocking offer of one shared immutable string
          v
 Queue A   Queue B   Queue C
    |         |         |
 HTTP A    HTTP B    HTTP C
```

Core owns event meaning, publication, persistence, typed observation, durable logs, replay, and transactional projection.

Server owns public event selection, wire encoding, bounded connection delivery, and subscriber lifecycle.

Protocol continues to own the `OpenCodeEvent` SSE contract. Generated Promise and Effect clients remain unchanged.

## Context

Before this change, every `/api/event` connection called `EventV2.liveBounded`. Each call registered a Core callback listener and allocated a dropping queue of raw event payloads. Every HTTP connection then independently performed:

1. Public-event filtering.
2. `OpenCodeEvent` schema encoding.
3. `JSON.stringify`.
4. SSE framing.
5. UTF-8 encoding.

With `N` connected TUIs, schema and wire encoding therefore ran `N` times for every accepted event.

`liveBounded` was introduced before zero-argument `events.subscribe()` became the unified live interface. It stayed on deprecated `listen` because it provided a stronger contract than the shared unbounded Core PubSub: one slow subscriber could overflow and fail without blocking healthy subscribers.

The global cross-location event stream is intentional. The endpoint is outside `LocationMiddleware`, and the TUI uses event location metadata to update state for multiple locations. The feed must not add request-location filtering.

## Delivery Law

The Server feed preserves this law:

> A connection has an independent finite lag budget. Exceeding it terminates only that connection while publication and healthy connections continue in order.

Each connection receives a `Queue.dropping` with capacity 4,096 accepted public frames.

When an offer returns `false`:

1. The queue is removed from the active subscriber registry immediately.
2. The queue is failed with `SubscriberOverflowError`.
3. The same frame is still offered to every other active queue.
4. Core publication and the Server observer never suspend on that connection.

Previously accepted frames drain before the queue failure surfaces. The overflow-causing frame is not accepted by that connection.

Internal Core events, `server.connected`, and heartbeats do not consume the queue capacity.

## Why Independent Queues

The design was reviewed twice, including explicit consideration of one shared Effect PubSub of encoded frames.

### Shared PubSub benefits

A shared PubSub stores each frame once and gives each subscriber a cursor. Its retained feed storage is proportional to maximum lag rather than the sum of every subscriber's lag.

### Shared PubSub costs

Effect's bounded PubSub strategies do not directly express independent subscriber failure:

- `bounded` can suspend the shared publisher behind the slowest subscriber;
- `dropping` rejects one publication for every subscriber when shared capacity is full;
- `sliding` silently skips events while leaving the stale subscriber connected;
- `unbounded` removes the structural memory bound.

Independent eviction can be built on a dropping PubSub, but requires:

- retaining every subscription's child scope;
- a separate typed overflow signal because subscription closure appears as interruption/completion;
- serialization of registration, removal, eviction, and publication;
- lag scans at capacity;
- waiting for scope closure to release shared ring slots;
- terminal handling if a supposedly impossible shared publish returns `false`;
- immediate discard of the stale subscriber's previously accepted unread backlog.

That is a custom multicast protocol layered over PubSub.

The incremental benefit is queue-slot references, not encoded frame copies: every independent queue stores the same immutable encoded string reference. At 50 clients each retaining 4,096 frames, raw references are roughly 1.6 MiB before array overhead. HTTP runtime, TLS, kernel, proxy, and client buffers may dominate that cost.

The chosen queue design captures the dominant optimization, encode once, while retaining direct queue-local overflow semantics and a smaller failure domain.

Revisit shared PubSub storage only if measurements after shared encoding show queue reference retention or per-queue offers are material.

## Capacity

The migration preserves the existing 4,096-event capacity.

This is compatibility, not a claim that 4,096 is optimal. It is an event-count lag threshold, not a complete memory bound:

- frames vary in size;
- stream pulls may move batches into HTTP buffers before queue lag reflects them;
- kernel and client buffers are outside Server accounting.

Do not raise capacity merely because frames are encoded once. A larger threshold retains stale clients longer.

Tune capacity separately using observed:

- public event rates and burst sizes;
- healthy subscriber queue high-water marks;
- encoded frame-size distribution;
- overflow and reconnect frequency;
- retained heap and RSS;
- downstream drain duration under a stalled reader.

Add a byte budget only if measurements show event count is an inadequate memory safeguard.

## Feed Lifecycle

### Server scope

`EventFeed.layer` is built once with the Server handler graph. It registers one global Core listener outside request location middleware.

The listener is installed synchronously before the feed service is exposed. Public filtering, encoding, and nonblocking queue offers happen inline once per Core event. This avoids both a startup gap and an unbounded asynchronous ingress backlog.

Core invokes the one observer sequentially. It does not fork encoding or fan-out per event, so every healthy subscriber observes the same order.

When no HTTP subscribers are registered, the observer returns before wire encoding, so headless and idle servers do not pay serialization cost.

### Connection scope

Each `feed.subscribe` acquisition:

1. Allocates one dropping queue.
2. Registers it synchronously.
3. Returns `Stream.fromQueue(queue)`.
4. Removes and shuts down the queue when the request scope closes.

The raw handler acquires and registers the queue before prepending its connection-specific `server.connected` frame:

```text
register queue
  -> emit server.connected
  -> drain queued live frames
```

Events before registration may be missed, consistent with a volatile stream. Events after registration queue behind `server.connected`.

Heartbeats remain connection-local and outside the feed.

### Encoding failure

If one accepted public event cannot be encoded:

1. Log its ID, type, and cause.
2. Fail every currently connected queue with `EncodingError`.
3. Skip the malformed volatile event.
4. Keep the feed available for later connections and valid events.

Keeping current clients connected would create a silent gap. Permanently terminating the feed would poison future connections.

## HTTP And Code Generation

Protocol remains unchanged:

```ts
HttpApiSchema.StreamSse({ data: OpenCodeEvent })
```

The raw handler continues to own:

- the unique `server.connected` event;
- the 15-second heartbeat;
- SSE response headers;
- `HttpServerResponse.stream` construction.

The feed supplies complete immutable SSE frame strings for ordinary public events. The handler merges connection-local frames and performs text-to-byte encoding.

Because method, path, schema, and wire representation do not change:

- OpenAPI does not change;
- generated Promise clients do not change;
- generated Effect clients do not change;
- TUI decoding and reconnect behavior do not change;
- client regeneration is not required.

## Core Cleanup

The Server no longer uses `EventV2.liveBounded`, so Core removes that dead helper and its transport-specific overflow error. The feed registers one observer through the existing `listen` interface; other listeners are unchanged.

Transactional projector registration is unrelated and remains unchanged.

## Benchmark

The disposable benchmark reproduced the previous per-connection schema/JSON/SSE encoding path with a representative 8 KiB public event. It used one warmup and nine measured runs; median was the primary metric and median absolute deviation was reported. The benchmark was intentionally not committed because it isolated the removed encoding boundary rather than exercising the complete HTTP stack.

Results on Apple Silicon with Bun 1.3.14:

| Clients | Current median | Shared median | Change |
| ------: | -------------: | ------------: | -----: |
|       1 |       9.488 ms |      9.554 ms |  +0.7% |
|      10 |      96.312 ms |     10.352 ms | -89.3% |
|      50 |     553.928 ms |     12.389 ms | -97.8% |

The benchmark isolates the repeated encoding boundary. It does not claim to measure socket throughput, client decoding, or downstream HTTP buffering. Queue offers and socket writes remain proportional to connected clients.

An experiment replacing direct schema encoding plus `JSON.stringify` with `Schema.fromJsonString(OpenCodeEvent)` was discarded: the one-client median regressed from approximately 9.5 ms to 38.8 ms with substantially higher variance.

## Verification

Behavioral tests cover:

- one encoding operation for multiple subscribers;
- identical frame delivery to healthy subscribers;
- independent slow-subscriber overflow;
- healthy delivery of events after another subscriber overflows;
- filtering internal events before capacity;
- failure of current subscribers after malformed public encoding;
- continued delivery to later subscribers after an encoding failure.

Package typechecks and the existing Core event/event-logger suites protect the Core interface migration.

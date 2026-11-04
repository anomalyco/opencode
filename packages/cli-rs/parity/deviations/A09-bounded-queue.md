# A09: bounded event batch queue

TypeScript: `createClientConnection` (`packages/client/src/solid/connection.ts:65-74`) appends every
event to an unbounded `pending` array and flushes it to `onEvent` every 10 ms on the UI thread. Only
`SharedEvents` subscribers are bounded, at 4,096 queued events
(`packages/client/src/shared-events.ts:33,113-115`).

Rust: the connection loop (`crates/api/src/events.rs`, `connect`) runs on a tokio task and sends each
10 ms batch over a bounded channel (`Options::queue`, 256 batches by default). When the consumer
falls that far behind, the loop drops the stream, records "Event queue full", and reconnects. The
consumer gets `server.connected` again and resynchronizes from the server, as it does after any
reconnect.

Reason: the Rust UI thread is separate from the network task, and `AGENTS.md` requires every queue
between tasks and the UI to be bounded. A UI that stops reading cannot grow memory without bound.

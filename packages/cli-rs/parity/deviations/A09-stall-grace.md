# A09: one second of grace before a stalled event stream drops

TypeScript: `createClientConnection` (`packages/client/src/solid/connection.ts:84-91`) aborts the stream
with "Event stream stalled" when its 45 s watchdog fires. A watchdog whose deadline passed while the
process was stopped fires as soon as it resumes.

Rust: when the 45 s idle deadline passes, the connection loop (`crates/api/src/events.rs`, `connect`)
gives the stream one more second. Any byte in that second keeps the stream; otherwise it drops with
"Event stream stalled", so a real stall reconnects after 46 s instead of 45 s.

Reason: tokio's clock keeps counting while the process is stopped (Ctrl+Z). On `fg`, the runtime can see
the elapsed deadline before the events buffered in the socket, and dropping the stream then lost them
(R4-1 of the live run). The client reloads the open session after a reconnect, as TS does, but events of
other views would still be lost on the wire.

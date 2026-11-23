# O89: pending prompts after a reconnect

**TypeScript.** `pending.sync` replaces the pending list with the server's and adds a transcript row for each prompt
it lists, but never removes the row of a prompt it no longer lists. A prompt another client cancelled while this
client's event stream was down stays in the transcript until the next transcript read. `session.inbox.delivered` moves
the row of a prompt the client holds; for a prompt it never saw admitted (its `session.inbox.enqueued` was lost with
the stream) it does nothing, so the prompt does not show until the next transcript read. A late
`session.inbox.enqueued` for a session the store found missing brings back its pending prompts and transcript (model
O9).

**Rust** (`crates/store/src/inbox.rs`). A pending read removes the transcript row of each prompt it no longer lists,
and a synced transcript then reads its head again, in case the prompt was delivered rather than cancelled.
`session.inbox.delivered` for a prompt the store holds neither as pending nor as a row makes a synced transcript read
its head again. `session.inbox.enqueued` and local admission do nothing for a session the store found missing. The
store model's `KNOWN` sequences "cancel lost in a reconnect", "delivery of a prompt missed in a reconnect" and "late
enqueue for a missing session" cover them.

**Reason.** Defects the TS client shares are fixed in Rust and recorded as deviations.

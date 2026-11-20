# O89: pending prompts after a reconnect

**TypeScript.** `pending.sync` replaces the pending list with the server's and adds a transcript row for each prompt
it lists, but never removes the row of a prompt it no longer lists. A prompt another client cancelled while this
client's event stream was down stays in the transcript until the next transcript read.

**Rust** (`crates/store/src/inbox.rs`). A pending read removes the transcript row of each prompt it no longer lists,
and a synced transcript then reads its head again, in case the prompt was delivered rather than cancelled. The store model's `KNOWN` sequence "cancel lost in a reconnect" covers it.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.

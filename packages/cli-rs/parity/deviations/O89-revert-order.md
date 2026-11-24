# O89: a committed revert removes messages by their place, and reads the inbox again

**TypeScript.** `session.revert.committed` removes the boundary message and every message after it by their place in
the transcript (`packages/client/src/solid/data.ts`). A boundary that is not loaded is older than every loaded
message, so all of them go. Waiting inputs whose rows went are dropped, and the inbox is read again when any input
was waiting, because only the server knows when each was enqueued. When no loaded message is left, the cursor is
cleared and the newest page is read again. A staged revert is shown by the same rule
(`@opencode/util/session-revert`).

**Rust.** `revert_messages` truncates from the first message whose ID is not below the boundary's, and
`on_revert_committed` keeps the waiting inputs whose ID is below it (`crates/store/src/messages.rs`,
`crates/store/src/sessions.rs`). It reads nothing again.

**Reach.** Message IDs do not sort in transcript order. A prompt gets its ID when it is sent and its place when it is
delivered, and scheduled prompts (`msg_sch_…`), automations (`msg_aut_…`) and watch notices (`msg_watch_…`) sort
after every other message. In 42 sessions the two rules differed at 1,181 of 1,376 prompts. On such a transcript Rust
removes messages that the server kept, down to an empty transcript, or keeps messages that the server removed. The
F.7 fold oracle (`session.revert.committed@loaded`) records the inbox read. Its inbox route still lists the waiting
input, so the read puts the input and its row back.

**Reason.** The TypeScript client fixed this defect first. Rust keeps the old rule until the fix is ported.

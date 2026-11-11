# O89: a transcript refresh keeps the reply that streamed during it

**TypeScript.** `message.sync` replaces the transcript with the latest page and keeps only local input rows that
are in the outbox or admitted (`packages/client/src/solid/data.ts:1831-1855`). When the read started before a step,
the `session.step.started` row and its text are gone once the older page lands, and later deltas for that message
are dropped because the row is not loaded. The reply reappears only after another invalidation.

**Rust.** `State::message_live` records, by event sequence, each message an event created or changed. When the
latest page lands, a message that an event touched after the read started keeps its local row: it replaces the
page's copy, or is kept after the page when the page lacks it. Later deltas then apply to it. The record keeps the
newest 512 message IDs. A message that an event removed during the read (a revert) is not tracked; the page can
still bring it back, as in TypeScript.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.

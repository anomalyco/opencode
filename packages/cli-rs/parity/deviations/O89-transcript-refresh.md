# O89: a transcript refresh merges what streamed during it by `durable.seq`

**TypeScript.** `message.sync` publishes the latest page and keeps local input rows that are in the outbox or
admitted (`packages/client/src/solid/data.ts`, `message.sync`). When the page starts inside the loaded transcript,
the loaded messages before it stay, with their cursor, and those that were still running are read again. When the
page does not reach the loaded transcript, up to three older pages (20, 40 and 140 messages) are read to reach it;
past that, the pages replace the transcript. A row after the start of the page that the page lacks is dropped: when the read started before a
step, the `session.step.started` row and its text are gone once the page lands, and later deltas for that message
are dropped because the row is not loaded. The reply reappears only after another invalidation. Events create rows for
any session, also one the store found missing (`message.update` does `draft[sessionID] ??= []`).

**Rust.** Each head read records what overtakes it (`messages::HeadRead`):
the rows events create, each with its event's `durable.seq`, and the durable edits (step, text, reasoning and tool
starts and ends, shell end, retry), in arrival order. The record exists from the start of the read, also before the
transcript is loaded. Like TypeScript, a head read keeps the anchored loaded messages older than its pages along with
their cursor, bridges up to three older pages (20, 40 and 140 messages) when the newest page does not reach them, and
reads unsettled kept messages again; reconnects and unknown-order head reads seal the anchored prefix so events after a
gap cannot join across it. When the pages land:

- The pages win, in server order. A page row that an event created during the read keeps its local copy, since the
  stream saw its whole life, deltas included.
- A row created during the read that the pages lack is placed by `durable.seq` against a page row also created during
  the read: a higher `seq` is newer than the page and is appended; a lower one is older and is dropped, and an older
  page brings it back. A row created before the read and missing from the page is older too. A transcript without a
  cursor covers the whole history, so such rows are appended.
- With a cursor and no page row whose `seq` the client saw, the order is unknown: the transcript is published without
  those rows, its anchor is sealed, and the read runs once more (coalesced through the read's key). The record has the
  1,024-entry bound of the list overlays; past it the read does the same.
- The recorded durable edits then replay onto the transcript. Each sets a whole value, so a replay the page already
  holds changes nothing. Deltas carry no sequence and are not replayed (models Q5): a streaming text may miss a delta
  until `session.text.ended` replaces it.
- Message IDs never decide the order.

This replaces `State::message_live`, which kept every message an event touched during the read after the page. That
put a row created before the read but delivered during it after newer rows (O1; TS drops the row), and a row loaded
before the read and edited during it after the page (O2). The model-switched row and edits that arrive during the
first read are kept (O3-model-row-during-first-read, O4-edit-during-first-read). A head read whose window a revert
ended publishes nothing and reads again; deletion and eviction drop it. The `session.model.selected` refetch updates
its row only while the transcript holds it, so it cannot put back a row the merge dropped as older; TS appends it.
Events for a session the store found missing create no transcript (model O9, transcript half).

**Known gap (O10).** When the stream lags behind the read, the page already holds rows whose events arrive after it
published. A row created before them, delivered later still, has nothing to compare with and is appended after newer
rows until the next read. TS does the same. Closing it client-side needs a re-read for the first row an event creates
in every paged window that has no row with a known `seq`.

**Reason.** Defects the TS client shares are fixed in Rust and recorded as deviations.

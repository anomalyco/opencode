# O89: a transcript refresh merges what streamed during it by `durable.seq`

**TypeScript.** `message.sync` replaces the transcript with the latest page and keeps only local input rows that
are in the outbox or admitted (`packages/client/src/solid/data.ts:1831-1855`). When the read started before a step,
the `session.step.started` row and its text are gone once the older page lands, and later deltas for that message
are dropped because the row is not loaded. The reply reappears only after another invalidation. Events create rows for
any session, also one the store found missing (`message.update` does `draft[sessionID] ??= []`, `data.ts:495`).

**Rust** (model M2, decisions O-91 and O-92 Q2 (a)). Each head read records what overtakes it (`messages::HeadRead`):
the rows events create, each with its event's `durable.seq`, and the durable edits (step, text, reasoning and tool
starts and ends, shell end, retry), in arrival order. The record exists from the start of the read, also before the
transcript is loaded. When the page lands:

- The page wins, in server order. A page row that an event created during the read keeps its local copy, since the
  stream saw its whole life, deltas included.
- A row created during the read that the page lacks is placed by `durable.seq` against a page row also created during
  the read: a higher `seq` is newer than the page and is appended; a lower one is older and is dropped, and an older
  page brings it back. A row created before the read and missing from the page is older too. A page without a cursor
  is the whole transcript, so such rows are appended.
- With a cursor and no page row whose `seq` the client saw, the order is unknown: the page is published alone and the
  read runs once more (coalesced through the read's key). The record has the 1,024-entry bound of the list overlays;
  past it the read does the same.
- The recorded durable edits then replay onto the page. Each sets a whole value, so a replay the page already holds
  changes nothing. Deltas carry no sequence and are not replayed (models Q5): a streaming text may miss a delta until
  `session.text.ended` replaces it.
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

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.

# O4: a durable edit during the first transcript read is kept

**TypeScript.** Streaming events edit a loaded message and are dropped when it is not loaded
(`packages/client/src/solid/data.ts:507-509`, `editAssistant`). During the first `message.sync` nothing is loaded, so a
`session.text.ended` (or a tool or step end) that arrives then is lost. The page, read before it, shows the text as it
was, and it stays so until another read.

**Rust.** A head read in flight records the durable edits of its session, also before the transcript is loaded, and
replays them onto the page when it lands (O89-transcript-refresh). Each sets a whole value, so a replay the page already
holds changes nothing. The model test's `text.ended during the first head read` sequence is `KNOWN`.

**Reason.** Defects the TS client shares are fixed in Rust and recorded as deviations.

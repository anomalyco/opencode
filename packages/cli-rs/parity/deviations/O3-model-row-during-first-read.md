# O3: a model switch during the first transcript read keeps its row

**TypeScript.** `session.model.selected` inserts the model-switched row only when the session's transcript is loaded
(`packages/client/src/solid/data.ts:786`). During the first `message.sync` the transcript is not loaded yet, so the
row is never inserted, and the page, read before the switch, lacks it too. The row is missing until another read.

**Rust.** A head read in flight records the rows events create (O89-transcript-refresh), so `on_model_selected` also
inserts the row while the first read is in flight. When the page lands, the row is placed by `durable.seq` like any
row created during the read. The model test's `model row during the first head read` sequence is `KNOWN`.

**Reason.** The user's decision O-92 (Q3 (a) of the models plan): fix in Rust the defects TS shares, and record them
as deviations.

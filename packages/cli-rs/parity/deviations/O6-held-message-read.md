# O6: a single-message read that ends after its transcript ended publishes nothing

**TypeScript.** `session.model.selected` inserts the model-switched row and then refetches that message with
`session.message.get` (`packages/client/src/solid/data.ts:782-806`). The response upserts into the session's
transcript whenever it arrives. When `session.deleted` lands while the read is in flight, the response creates the
deleted session's transcript again, with the one row, and nothing removes it.

**Rust.** Each session's transcript window has an incarnation, a token from the store's counter. Deleting the session,
evicting its transcript and committing a revert end the window and give it a new incarnation (`State::end_transcript`).
`fetch_message` takes the incarnation when it begins and publishes its response only while the incarnation is the
same, so a response for a deleted, evicted or reverted transcript publishes nothing. The model test's `held
single-message read after a delete` sequence is `KNOWN`.

**Reason.** The user's decision O-92 (Q3 (a) of the models plan): fix in Rust the defects TS shares, and record them
as deviations.

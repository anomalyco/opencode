# O5: a part start that the transcript already holds adds no second part

**TypeScript.** `session.text.started`, `session.reasoning.started` and `session.tool.input.started` push a new part
unconditionally (`packages/client/src/solid/data.ts:1044-1048,1059-1069,1123-1132`). When a head read's page already
holds the part and the durable start is applied after it (it arrived while the read was in flight), the message gets
a second, empty part. `text.ended` then fills only the last text part, so the reply shows twice.

**Rust.** A text or reasoning start is skipped when the message already holds more parts of that kind than the
event's `ordinal` (the server numbers text and reasoning parts from 0 within a message). A tool input start is
skipped when the message already holds a tool part with the same call ID. A start for the next ordinal or another
call ID still adds a part. The model test's `text.started replayed over a snapshot` sequence is `KNOWN`, and
`data.rs` `part_starts_are_idempotent` covers all three starts.

**Reason.** The user's decision O-92 (Q3 (a) of the models plan): fix in Rust the defects TS shares, and record them
as deviations.

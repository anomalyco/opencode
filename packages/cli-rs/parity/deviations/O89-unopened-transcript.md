# O89: a session nobody opened keeps no transcript

**TypeScript.** `createData` stores the messages that events bring only for a session whose transcript was asked
for: a read of its messages ran or runs, or the client created the session or sent a prompt into it (`opened` in
`packages/client/src/solid/data.ts`). Any other session holds at most the assistant message of the step that runs
now, which a permission prompt reads, and nothing once that step ends. With the event of a notice, an input, a
shell, a compaction or the end of a run on an empty store, the session's list stays empty.

**Rust.** `Data::apply` appends every message that an event brings to the session's list, whether or not its
transcript was read, as the TypeScript client did before. The list of a session that nobody opens grows for as long
as the client runs.

**Reason.** The bound is new in the TypeScript client and is not ported. The Rust store keeps its behaviour until it
is; the cases that differ are listed in `allow` of `parity/oracle/F.7-folds.ts`.

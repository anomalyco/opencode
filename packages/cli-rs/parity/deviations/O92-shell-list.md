# O92: the shell list keeps shells created and exited during its read

**TypeScript.** The `shell` location resource sets the location's `shell` record to the `GET /api/shell` snapshot
(`locationResource` `publish`, `packages/client/src/solid/data.ts:1468-1479`, loaded at `1487-1494`). `shell.created`,
`shell.exited` and `shell.deleted` change the record directly (`data.ts:1379-1393`). An event that arrives while the
read is in flight is overwritten by the older snapshot: a shell started meanwhile disappears from the list, and one
that exited meanwhile comes back, until the next invalidation.

**Rust.** A `Catalog::Shell` read starts an overlay of the shells created and exited after it began
(`store/src/shells.rs` `ShellRead`). Only that read's ticket publishes. It publishes the snapshot with the overlay
applied: a created shell is added or updated, and an exited or deleted shell is removed. The overlay holds at most
1,024 changes. If more arrive, the read publishes the snapshot alone, invalidates itself, and reads again.

**Reason.** The user's decisions O-89 and O-92 (Q1 (a), Q3 (a)): fix in Rust the defects TS shares, and record them
as deviations. Model test: `store/tests/model.rs` `shells_converge_to_the_server` and the `KNOWN` shell entries.

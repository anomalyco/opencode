# O89: permission and form lists keep what arrived during their read

**TypeScript.** `permission.sync` sets a session's permission list to the `GET /permission` snapshot
(`packages/client/src/solid/data.ts:1942-1948`), and the form syncs set the form list the same way. A
`permission.asked` or `form.created` event that arrives while the read is in flight is overwritten by the older
snapshot, so a request the server is waiting on disappears until the next invalidation. A request replied to or
cancelled meanwhile comes back with the snapshot.

**Rust.** `State::permission_live` and `form_live` record, by event sequence, which requests and forms events added
and removed. When a list read lands, entries removed after the read started are dropped from the snapshot, and the
entries that events added after it started and the snapshot lacks are kept, after the snapshot's own. This applies
to session permissions, session forms, and the global forms of a location. Each record keeps the newest 512 IDs.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.

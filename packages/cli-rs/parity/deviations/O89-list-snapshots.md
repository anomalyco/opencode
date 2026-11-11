# O89: permission and form lists keep what arrived during their read

**TypeScript.** `permission.sync` sets a session's permission list to the `GET /permission` snapshot
(`packages/client/src/solid/data.ts:1942-1948`), and the form syncs set the form list the same way. A
`permission.asked` or `form.created` event that arrives while the read is in flight is overwritten by the older
snapshot, so a request the server is waiting on disappears until the next invalidation. A request replied to or
cancelled meanwhile comes back with the snapshot.

TS also applies `permission.asked` for a session it already found missing (`data.ts:1300-1306` has no check), so a
late ask for a deleted session brings its permissions back until the next read (model O9).

**Rust, permissions** (model M1, decisions O-91 and O-92). Each permission read takes a ticket when it starts and
records an overlay: the asks and replies (events and local `permission_reply`) of its session while it is in flight,
in arrival order. Only the read whose ticket is current publishes, as the snapshot with the overlay applied: settled
requests are dropped, and asks the snapshot lacks follow its own entries. The overlay holds at most 1,024 changes;
past that the read publishes nothing, keeps the event-applied list, and reads again (O-92 Q1 (a)), so the bound costs
a read, never a request. `permission.asked` for a session the store found missing is dropped.

This replaces the global window of the newest 512 IDs across all sessions, which a burst could overflow: it lost
asks that overtook a read in the same session (O7) or in another session (O8). TS shares O8 and O9, and loses
every overtaking ask in the O7 case.

**Rust, forms.** `State::form_live` records, by event sequence, which forms events added and removed. When a list read
lands, entries removed after the read started are dropped from the snapshot, and the entries that events added after
it started and the snapshot lacks are kept, after the snapshot's own. This applies to session forms and the global
forms of a location. The record keeps the newest 512 IDs.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.

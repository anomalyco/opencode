# O89: permission and form lists keep what arrived during their read

**TypeScript.** `permission.sync` sets a session's permission list to the `GET /permission` snapshot
(`packages/client/src/solid/data.ts:1942-1948`), and the form syncs set the form list the same way. A
`permission.asked` or `form.created` event that arrives while the read is in flight is overwritten by the older
snapshot, so a request the server is waiting on disappears until the next invalidation. A request replied to or
cancelled meanwhile comes back with the snapshot.

TS also applies `permission.asked` and `form.created` for a session it already found missing (`data.ts:1300-1306` and
`data.ts:1372-1378` have no check), so a late ask or form for a deleted session brings its permissions or forms back
until the next read (model O9).

**Rust** (model M1, decisions O-91 and O-92). Permissions and forms share one overlay (`state::Overlay`). Each list
read takes a ticket when it starts and records an overlay of the changes that overtake it, in arrival order:

- permissions: the asks and replies (events and local `permission_reply`) of its session;
- forms: the forms created, replied to and cancelled (events and local `form_reply` and `form_cancel`) of its owner.
  A global form read is per location and records only the global forms of that location; a settlement without a
  location records into every global read.

Only the read whose ticket is current publishes, as the snapshot with the overlay applied: settled entries are
dropped, and new ones the snapshot lacks follow its own entries. A global form read replaces only the forms of the
location the server answered for; global forms of other locations stay. The overlay holds at most 1,024 changes; past
that the read publishes nothing, keeps the event-applied list, and reads again (O-92 Q1 (a)), so the bound costs a
read, never an entry. `permission.asked` and `form.created` for a session the store found missing are dropped.

This replaces the global windows of the newest 512 IDs across all sessions (`permission_live`, `form_live`), which a
burst could overflow: it lost entries that overtook a read in the same session (O7) or in another session (O8). TS
shares O8 and O9 for both lists (O-92 Q3 (a)), and loses every overtaking entry in the O7 case.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.

# V1 to V2 Database Migration

## Approach

- Use the `dev` branch database schema and migration registry as the V1 baseline.
- Remove migrations that exist only on the V2 branch.
- Generate one canonical migration from the `dev` schema to the final V2 schema.
- Add explicit data operations to that migration where generated DDL is insufficient.
- Test the migration against a populated database at the exact `dev` schema.

## Preserve

The canonical V1 data remains in its existing tables. In particular, preserve `session`, `message`, and `part` rows.

Preserve `workspace` rows and existing `session.workspace_id` values unchanged. The migration must not clear or rebuild
workspace relationships.

Keep the `todo` table and its data unchanged. V2 does not currently migrate todos into another representation, and the
generated migration must not drop the table.

## Truncate

Truncate these pre-launch V2 tables before applying schema changes:

- `event`
- `event_sequence`
- `session_message`

These rows are not canonical V1 data. Truncating `event` before adding the required `event.created` column means the
column needs neither a backfill nor a default. After truncation, rebuild `session_message` from canonical V1 `message`
and `part` rows rather than retaining its pre-launch V2 contents.

## Message Backfill

Backfill canonical V1 history from `message` and `part` into `session_message`. This is the main data transformation in
the migration. Preserving the V1 tables alone keeps the data safe but does not make existing history visible through the
V2 session APIs, which read `session_message`.

Reuse each V1 `message.id` as the corresponding `session_message.id`. Stable IDs keep the migration deterministic and
avoid rewriting other persisted state that may refer to a message.

Within each session, order V1 messages by `time_created` and then `id`, matching the existing V1 message index. Assign
contiguous `session_message.seq` values starting at `0`.

Map ordinary V1 messages one-to-one by role. Each ordinary V1 user message becomes one V2 `user` row, and each ordinary
V1 assistant message becomes one V2 `assistant` row. Fold the source message's ordered V1 parts into that row's V2
payload.

Handle semantic marker parts before applying the ordinary mapping. In particular, a V1 user message containing a
`compaction` part and its paired assistant summary represent one compaction operation, not two ordinary messages. Special
part mappings must be decided explicitly before implementing the backfill.

V1 synthetic content is represented by user text parts with `synthetic: true`, not by a separate message role. A V1 user
message whose visible text parts are all synthetic should become a V2 `synthetic` message. If a V1 user message mixes
ordinary and synthetic content, preserve the ordinary content in the V2 `user` row and emit the synthetic content as an
adjacent V2 `synthetic` row. Ignore text parts marked `ignored`, matching V1 model-history behavior.

Use the V1 compaction user message ID as the ID of the collapsed V2 compaction message. This matches V2's use of the
admitted compaction input ID and preserves references to the initiating message.

For a completed compaction, create one V2 `compaction` row with `status: "completed"`. Set `reason` from the V1
compaction part's `auto` flag, join the paired summary assistant's nonempty text parts with blank lines for `summary`, and
serialize the retained V1 tail beginning at `tail_start_id` for `recent`. Use an empty `recent` value when no tail was
retained, and use the compaction user message creation time. Do not emit the paired summary assistant as a separate V2
assistant row.

After rebuilding `session_message`, seed `event_sequence` with one row per migrated session. Set its watermark to that
session's maximum backfilled `session_message.seq`. This prevents new V2 events from reusing sequence numbers or sorting
before migrated history. The `event` table remains empty.

## Drop

Drop these pre-launch V2 tables without preserving or transforming their rows:

- `session_input`
- `session_context_epoch`

Do not transfer `session_input` rows into `session_pending`.

## Create Empty

Let the generated migration create these tables empty:

- `instruction_blob`
- `instruction_entry`
- `instruction_state`
- `session_pending`
- `kv`

V1 has no canonical data to backfill into these tables. V2 initializes their state as it runs.

## Fork Storage

V1 has no fork-boundary state to backfill. New V2 forks use a required message boundary and persist it in
`session.fork_boundary`. The durable fork event contains no parent sequence. Its resolved boundary is one of:

- `before`: copy messages before the identified message.
- `through`: copy messages through the identified message.

Forking an empty session is not supported. `session.fork_seq` and `session.fork_message_id` are not part of the final V2
schema.

New nullable session columns, including `fork_session_id`, `fork_boundary`, and `time_suspended`, require no explicit
backfill. Existing rows naturally receive `NULL` when the generated migration adds the columns.

## Verification

The canonical migration test should seed representative V1 sessions, messages, parts, todos, projects, accounts,
credentials, permissions, shares, and workspaces. After migration, it should verify:

- Preserved rows and encoded values remain unchanged.
- Todo rows remain available in the unchanged `todo` table.
- `event` is empty, and stale pre-launch rows are absent from the rebuilt projections.
- Backfilled `session_message` rows represent the canonical V1 `message` and `part` history.
- Each migrated session's `event_sequence` watermark matches its maximum backfilled message sequence.
- Dropped tables no longer exist.
- New tables exist and are empty.
- The final schema has no ungenerated changes.

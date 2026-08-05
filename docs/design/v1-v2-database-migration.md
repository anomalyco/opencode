# V1 to V2 Database Migration

## Approach

- Use the `dev` branch database schema and migration registry as the V1 baseline.
- Remove migrations that exist only on the V2 branch.
- Generate one canonical migration from the `dev` schema to the final V2 schema.
- Keep the canonical migration focused on schema changes and dropping obsolete tables.
- Run the V1 history backfill through an experimental server endpoint invoked by the CLI before it opens the TUI.
- Show committed session progress while the endpoint runs.

Expose `GET /api/experimental/migration/v1` for status and a blocking `POST /api/experimental/migration/v1` to run or
resume the backfill. The status is `required`, `running`, or `completed`. On startup, the CLI checks status first and
renders no migration UI when it is already complete. For required or running status, it shows a spinner and waits for the
blocking POST without a request timeout. While migration runs, poll GET once per second and render completed and total
session counts. GET derives total from all session rows and completed from rows through the stored cursor; the count
advances only after a session transaction commits. The POST returns `{ status: "completed" }`. Do not add a background
job or streaming progress protocol. Interrupted calls resume from the stored cursor.
Initially, only interactive TUI startup performs this check; noninteractive run, ACP, raw API, service, health, version,
and help flows do not trigger the backfill.

Keep migration behavior in Core: status, semaphore, checkpointing, V1 decoding, transformation, and database writes.
Protocol owns the experimental GET/POST contracts, Server handlers delegate to Core, and the interactive CLI owns only
the status check and spinner presentation.

Guard the endpoint with one process-local Effect `Semaphore`. Concurrent callers wait; after the active call completes,
waiting callers acquire the permit, observe the completion key, and return immediately. No distributed lock is required
for the current single elected server process.

## Preserve

The canonical V1 data remains in its existing tables. In particular, preserve `session`, `message`, and `part` rows.

Preserve `workspace` rows and existing `session.workspace_id` values unchanged. The migration must not clear or rebuild
workspace relationships.

Preserve existing non-null `session.agent` and `session.model` selections. Fill missing values from the latest ordinary
V1 user message ordered by `time_created` and `id`, excluding compaction and subtask-only messages. Copy agent, provider
ID, model ID, and variant, normalizing an absent variant to `default`.

Recompute session usage aggregates from all canonical V1 assistant messages, including compaction or other internal
assistants omitted from the V2 projection. Overwrite session cost and input, output, reasoning, cache-read, and
cache-write token totals with those sums.

Clear persisted `session.revert` state. A staged revert is transient operational state and may refer to omitted projection
rows or unavailable snapshots; it must not resume automatically after upgrading. Preserve the underlying messages,
parts, and file history.

Clear `session.time_compacting`, leave the new `time_suspended` column as `NULL`, and preserve session creation, update,
and archive timestamps. Preserve project `time_initialized`; it is unrelated durable state.

Keep the legacy `todo` table and its data physically unchanged, but do not include it in the final V2 Drizzle schema.
After generation, remove the generated `DROP TABLE todo` statement from the canonical migration so the table remains as
unmanaged legacy storage.

## Per-Session Replacement

Do not truncate `event`, `event_sequence`, or `session_message` globally before the backfill. A whole-table delete can
hold SQLite's writer lock long enough to block the running TUI.

Replace each legacy session's V2 state inside that session's checkpointed migration transaction. Delete `event` rows for
the session aggregate, delete its `session_message` rows, rebuild its projection from canonical V1 `message` and `part`
rows, and overwrite its `event_sequence` watermark. If migration of that session fails, all replacements roll back and
the durable cursor remains at the previously committed session. Rows owned by sessions outside the legacy migration set
remain untouched.

## Message Backfill

Backfill canonical V1 history from `message` and `part` into `session_message`. This is the main data transformation in
the migration. Preserving the V1 tables alone keeps the data safe but does not make existing history visible through the
V2 session APIs, which read `session_message`.

Do not fail the whole migration when a V1 message or part payload cannot be decoded. Skip an undecodable message's V2
projection and log its session and message IDs. Skip an undecodable part while continuing to map its message, and perform
special-message pairing only with decoded rows. Assign sequences after filtering. Leave every malformed source row
untouched in the V1 tables.

Skip and log orphan parts whose source message does not exist and parts with unknown or unsupported types. Continue
migrating the owning message and other valid parts. Include session, message, part ID, and observed type in warnings, and
leave skipped source rows unchanged.

Reuse each V1 `message.id` as the corresponding `session_message.id`. Stable IDs keep the migration deterministic and
avoid rewriting other persisted state that may refer to a message.

For ordinary user and assistant rows, preserve source `message.time_created` and `message.time_updated`. Entirely
synthetic messages preserve their source timestamps, and synthetic rows split from mixed messages use the source user
timestamps. A collapsed compaction uses the compaction user creation time and the later update time of the compaction
user and summary assistant. Keep payload creation/completion times consistent with row timestamps.

Within each session, order V1 messages by `time_created` and then `id`, matching the existing V1 message index. Assign
contiguous `session_message.seq` values starting at `0`.

Map ordinary V1 messages one-to-one by role. Each ordinary V1 user message becomes one V2 `user` row, and each ordinary
V1 assistant message becomes one V2 `assistant` row. Fold the source message's ordered V1 parts into that row's V2
payload.

Keep ordinary messages even when their transformed payload becomes empty after filtering. Preserve an empty V2 user row
with `text: ""` and an empty V2 assistant row with `content: []` so IDs, chronology, and conversation structure remain
stable. Omit only explicitly dropped internal concepts and undecodable messages.

Handle semantic marker parts before applying the ordinary mapping. In particular, a V1 user message containing a
`compaction` part and its paired assistant summary represent one compaction operation, not two ordinary messages. Special
part mappings must be decided explicitly before implementing the backfill.

Do not carry the V1 subtask concept into the V2 projection. Omit user messages containing only `subtask` parts and omit
the paired assistant task-tool messages generated from those markers. For mixed user messages, ignore the `subtask`
parts while preserving ordinary content, and still omit assistant task-tool messages generated by the skipped subtasks.
Keep all source rows unchanged in the V1 `message` and `part` tables.

Map ordinary V1 assistant `text` and `reasoning` parts into the V2 assistant `content` array in part order. Preserve text,
including empty assistant text parts used as structural separators. Map V1 part metadata to optional V2 provider state.
For reasoning, map `time.start` to `time.created` and optional `time.end` to `time.completed`.

Preserve V1 tool parts that are `pending` or `running`, but convert them to terminal V2 tool error states. Preserve the
call ID, tool name, parsed input, metadata, and available start time. Use the assistant message creation time when the V1
state has no start time. Set the error to type `tool.interrupted` with message
`Tool execution was interrupted before V2 migration`. Never resume migrated tool executions.

For a completed V1 tool part, use `callID` as the V2 tool content ID and preserve the tool name and parsed input. Set the
state to `completed`. Convert V1 output into the first text content item and convert stored output attachments into
following file content items with their URI, MIME type, and filename. Preserve state metadata. Map `time.start` to
`time.created` and `time.end` to `time.completed`. When `time.compacted` exists, use
`[Old tool result content cleared]` as the only output and omit attachments.

For a failed V1 tool part, preserve the call ID, tool name, parsed input, metadata, and timestamps, and set the V2 state
to `error`. Convert the V1 error string to a structured error with type `tool.execution`. If V1 metadata contains a string
`output`, preserve it as optional V2 text content. Map `time.start` to `time.created` and `time.end` to `time.completed`.

For an ordinary V1 assistant message, preserve agent, provider ID, model ID, optional variant, creation and completion
times, cost, and input/output/reasoning/cache token counts. Use `default` when the V1 variant is absent. Ignore V1
`tokens.total` because it is derivable and V2 does not persist it.

Use V1 assistant `parentID` only while pairing compactions and skipped subtasks with their originating user messages. Do
not persist it in ordinary V2 assistant rows; V2 uses ordered history rather than user/assistant parent links.

Ignore the optional V1 assistant `structured` output value. V2 has no equivalent top-level assistant field, and visible
text and tool content are migrated separately. Retain the original structured value only in the V1 `message` row.

Ignore V1 assistant `mode` and historical `path` (`cwd` and `root`). Mode is redundant with the preserved assistant
agent, and historical filesystem paths do not belong to the V2 assistant message contract. Retain them only in the V1
`message` row.

For assistant finish reasons, preserve `stop`, `length`, `tool-calls`, `content-filter`, `error`, and `unknown`. Map every
other nonempty V1 finish value to `unknown`, and leave the field absent when V1 omitted it. Do not retain unrecognized raw
finish values in metadata.

Map V1 assistant errors into the current V2 `{ type, message }` storage shape. Normalize Auth, content-filter, context
overflow, structured-output, output-length, aborted, API, and unknown errors to the established V2 string conventions,
preserve the message, and discard V1-only retryability and raw provider details.

Ignore V1 `retry` parts. Do not populate the V2 assistant `retry` field during migration; historical retry state is not
useful enough to preserve. The original retry rows remain in the V1 `part` table.

Do not emit V2 assistant content for V1 `step-start` and `step-finish` parts. Use the first available
`step-start.snapshot` as `assistant.snapshot.start` and the last available `step-finish.snapshot` as
`assistant.snapshot.end`. Continue to source finish, cost, and tokens from the assistant message itself. Ignore step
markers without snapshots.

Do not emit assistant content for standalone V1 `snapshot` or `patch` parts. If no start snapshot came from `step-start`,
use the first standalone snapshot value, then the first patch hash as a final fallback. Only `step-finish.snapshot` may
populate the end snapshot. Merge patch file lists into `assistant.snapshot.files` in first-seen order with duplicates
removed.

V2 follow-up: replace the open `SessionError.Error` string shape with a properly typed persisted error union. This is not
a blocker for the V1 migration, which should target the current storage contract.

V1 synthetic content is represented by user text parts with `synthetic: true`, not by a separate message role. A V1 user
message whose visible text parts are all synthetic should become a V2 `synthetic` message. If a V1 user message mixes
ordinary and synthetic content, preserve the ordinary content in the V2 `user` row and emit the synthetic content as an
adjacent V2 `synthetic` row. Ignore text parts marked `ignored`, matching V1 model-history behavior.

For an ordinary V2 user message, take visible V1 text parts that are neither ignored nor synthetic, preserve part order,
and join their text with `"\n\n"`. Use an empty string when the message contains attachments but no ordinary text.

Ignore the optional V1 user-message `system` override. Do not create a V2 system message or preserve the override in
metadata. The original value remains in the V1 `message` row.

Ignore the optional V1 user-message `tools` map. It represented request-time tool enablement for a historical step and
must not affect future V2 execution. The original value remains in the V1 `message` row.

Ignore the optional V1 user-message `format` field and its schema. It controlled structured-output behavior for a
historical request and must not affect future V2 runs. Preserve visible assistant text normally; retain the original
format only in the V1 `message` row.

Ignore V1 user-message `summary` metadata, including title, body, and diffs. V2 user messages have no equivalent field,
and session-level summary data is already persisted separately. Retain the original summary only in the V1 `message`
row.

Map V1 `agent` parts into the V2 user message's `agents` array in part order. Preserve `name`. When the V1 part has
`source`, map its `value`, `start`, and `end` into the V2 attachment's `mention.text`, `mention.start`, and `mention.end`.
Omit `agents` when there are no agent parts.

Do not read the filesystem or network while migrating V1 file attachments. Attachment migration must be deterministic
from database contents alone. Convert persisted `data:` URLs; represent non-embedded `file:`, HTTP, and other external
URLs with deterministic text rather than fetching them. Keep the original V1 `part` rows unchanged.

For a V1 file backed by a `data:` URL, decode the URL and normalize its payload to base64 for the V2 attachment's `data`.
Preserve `mime` and optional `filename` as `name`. Use a V2 `uri` source with the original URI for a V1 resource source;
otherwise use an `inline` source. When V1 source text metadata exists, map its `value`, `start`, and `end` into the V2
attachment mention. Leave `description` unset and preserve file-part order in the V2 `files` array.

For a non-embedded V1 file, do not create a V2 file attachment. Append
`[Attachment unavailable after migration: <name-or-url> (<mime>)]` to the V2 user text in original part order, separated
by blank lines. Prefer the V1 filename, then resource URI, then part URL for the label. The original URL remains only in
the preserved V1 `part` row.

For a synthetic row split from a mixed user message, derive a generated-looking ID from the source message ID. Preserve
the source ID's 12-character timestamp component and replace its 14-character random component with a deterministic
base-62 encoding of a hash of `v1-synthetic:` plus the source message ID. If that candidate collides with an existing or
derived message ID, deterministically retry with an incrementing salt. Place the synthetic row immediately after its
source user row. Entirely synthetic messages continue to reuse their original message ID.

Use the V1 compaction user message ID as the ID of the collapsed V2 compaction message. This matches V2's use of the
admitted compaction input ID and preserves references to the initiating message.

For a completed compaction, create one V2 `compaction` row with `status: "completed"`. Set `reason` from the V1
compaction part's `auto` flag, join the paired summary assistant's nonempty text parts with blank lines for `summary`, and
serialize the retained V1 tail beginning at `tail_start_id` for `recent`. Use an empty `recent` value when no tail was
retained, and use the compaction user message creation time. Do not emit the paired summary assistant as a separate V2
assistant row.

Do not project incomplete or failed V1 compactions into `session_message`. Omit both the internal compaction user marker
and its paired summary assistant when no successful summary was completed. Assign final sequence numbers after filtering
so omitted compactions leave no gaps. Their source rows remain preserved in the V1 `message` and `part` tables.

After rebuilding a session's `session_message`, replace its `event_sequence` watermark with that session's maximum
backfilled `session_message.seq`. This prevents new V2 events from reusing sequence numbers or sorting before migrated
history. The migrated session's prior `event` rows are removed in the same transaction.

## Drop

Drop these pre-launch V2 tables without preserving or transforming their rows:

- `session_input`
- `session_context_epoch`
- `data_migration`

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

## Execution

Store V1 backfill state in `kv`; do not retain a dedicated `data_migration` table. Store the last successfully migrated
session ID under `migration.v1-v2.session.cursor` and write `migration.v1-v2.completed` with value `true` after every
session finishes. Delete the cursor key on completion and return immediately on later calls when the completion key
exists.

Absence of the completion key means migration is required, including on a fresh database. Running the endpoint against a
database with no sessions completes immediately and writes the completion key; fresh database initialization does not
seed migration state specially.

Process sessions in stable ID order. Rebuild one session in one transaction, including its `session_message` rows,
session-level backfills, `event_sequence` watermark, and cursor update. If interrupted during a session, that transaction
rolls back and the next endpoint call retries the same session. If it committed, the next call continues after the stored
cursor. Mark the migration complete after the final session and return immediately on later calls.

Process every `session` row, including archived, root, child, and empty sessions, as well as sessions whose messages are
all skipped or internal. Each successfully committed session advances the cursor.

## Testing

Detailed migration test design is deferred until after the canonical migration is implemented.

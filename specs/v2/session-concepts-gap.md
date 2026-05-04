# Session V2 Concept Gaps

Compared with `packages/opencode/src/session/message-v2.ts` and `packages/opencode/src/session/processor.ts`, `packages/opencode/src/v2` currently captures the rough event stream for prompts, assistant steps, text, reasoning, tools, retries, and compaction, but it does not yet capture several persisted-message and processor concepts.

## Message Metadata

- User messages are missing selected `agent`, `model`, `system`, enabled `tools`, output `format`, and summary metadata.
- Assistant messages are missing `parentID`, `agent`, `providerID`, `modelID`, `variant`, `path.cwd`, `path.root`, deprecated `mode`, `summary`, `structured`, `finish`, and typed `error`.

## Output Format

- Text output format.
- JSON-schema output format.
- Structured-output retry count.
- Structured assistant result payload.
- Structured-output error classification.

## Errors

- Aborted error.
- Provider auth error.
- API error with status, retryability, headers, body, and metadata.
- Context-overflow error.
- Output-length error.
- Unknown error.
- V2 mostly reduces assistant errors to strings, except retry errors.

## Part Identity

- V1 has stable `MessageID`, `PartID`, `sessionID`, and `messageID` on every part.
- V2 assistant content does not preserve stable per-content IDs.
- Stable content IDs matter for deltas, updates, removals, sync events, and UI reconciliation.

## Part Timing And Metadata

- V1 text, reasoning, and tool states carry timing and provider metadata.
- V2 assistant text and reasoning content only store text.
- V2 events include metadata, but `SessionEntry` currently drops most provider metadata.

## Snapshots And Patches

- Snapshot parts.
- Patch parts.
- Step-start snapshot references.
- Step-finish snapshot references.
- Processor behavior that tracks a snapshot before the stream and emits patches after step finish or cleanup.

## Step Boundaries

- V1 stores `step-start` and `step-finish` as first-class parts.
- V2 has `step.started` and `step.ended` events, but the assistant entry only stores aggregate cost and tokens.
- V2 does not preserve step boundary parts, finish reason, or snapshot details in the entry model.

## Compaction

- V1 compaction parts have `auto`, `overflow`, and `tail_start_id`.
- V2 compacted events have `auto` and optional `overflow`, but no retained-tail marker.
- V1 also has history filtering semantics around completed summary messages and retained tails.

## Files And Sources

- V1 file parts have `mime`, `filename`, `url`, and typed source information.
- V1 source variants include file, symbol, and resource sources.
- Symbol sources include LSP range, name, and kind.
- Resource sources include client name and URI.
- V2 file attachments have `uri`, `mime`, `name`, `description`, and a generic text source, but lose source type, LSP metadata, and resource metadata.

## Agents And Subtasks

- Agent parts.
- Subtask parts.
- Subtask prompt, description, agent, model, and command.
- V2 has agent attachments on prompts, but no assistant/session content equivalent for subtask execution.

## Text Flags

- Synthetic text flag.
- Ignored text flag.
- V2 has a separate synthetic entry, but no ignored text concept.

## Tool Calls

- V1 pending tool state stores parsed input and raw input text separately.
- V2 pending tool state stores a string input but does not preserve a separate raw field.
- V1 completed tool state has `time.start`, `time.end`, and optional `time.compacted`.
- V2 tool time has `created`, `ran`, `completed`, and `pruned`, but the stepper currently does not set `completed` or `pruned`.
- V1 error tool state has `time.start` and `time.end`.
- V1 supports interrupted tool errors with `metadata.interrupted` and preserved partial output.
- V1 tracks provider execution and provider call metadata.
- V2 events include provider info, but `SessionEntryStepper` drops it from entries.
- V1 has tool-output compaction and truncation behavior via `time.compacted`.

## Media Handling

- V1 models tool attachments as file parts and has provider-specific handling for media in tool results.
- V1 can strip media, inject synthetic user messages for unsupported providers, and uses a synthetic attachment prompt.
- V2 has attachments but not these model-message conversion semantics.

## Retries

- V1 stores retries as independently addressable retry parts.
- V2 stores retries as an assistant aggregate.
- V2 captures some retry information, but not the independent part identity/update model.

## Processor Control Flow

- Session status transitions: busy, retry, and idle.
- Retry policy integration.
- Context-overflow-driven compaction.
- Abort and interrupt handling.
- Permission-denied blocking.
- Doom-loop detection.
- Plugin hook for `experimental.text.complete`.
- Background summary generation after steps.
- Cleanup semantics for open text, reasoning, and tool calls.

## Sync And Bus Events

- Message updated.
- Message removed.
- Message part updated.
- Message part delta.
- Message part removed.
- V2 has domain events, but not the sync/bus event model for persisted message and part updates/removals.

## History Retrieval

- Cursor encoding and decoding.
- Paged message retrieval.
- Reverse streaming through history.
- Compaction-aware history filtering.

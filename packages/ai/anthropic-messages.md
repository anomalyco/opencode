# Anthropic Messages Protocol Support

This checklist tracks correctness and parity for the native Anthropic Messages
protocol in `src/protocols/anthropic-messages.ts`, including direct Anthropic,
Anthropic-compatible deployments, and Claude on Google Vertex.

The scope is protocol behavior: request lowering, streamed lifecycle events,
reasoning state, tool calls and results, terminal outcomes, persistence, replay,
and usage. Optional provider capabilities are tracked separately from baseline
flow correctness.

## Status Legend

- `[x]` Implemented and covered by focused tests.
- `[ ]` Missing, incomplete, or awaiting an unmerged fix.

## Reference Baseline

- [Anthropic TypeScript SDK Messages types](https://github.com/anthropics/anthropic-sdk-typescript/blob/bfa9197f0182084941052be9752c948638421601/src/resources/messages/messages.ts)
- [Anthropic TypeScript SDK stream accumulator](https://github.com/anthropics/anthropic-sdk-typescript/blob/bfa9197f0182084941052be9752c948638421601/src/lib/MessageStream.ts)
- [Anthropic TypeScript Vertex client](https://github.com/anthropics/anthropic-sdk-typescript/blob/bfa9197f0182084941052be9752c948638421601/packages/vertex-sdk/src/client.ts)
- [Anthropic streaming protocol](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Anthropic stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
- [Anthropic mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
- [Claude on Google Cloud](https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai)
- OpenCode tracker: [#41932](https://github.com/anomalyco/opencode/issues/41932)

## Change Log

| Status | Change | Tracking |
| --- | --- | --- |
| Merged | Accept nullable Anthropic input usage without losing the `message_start` count | [#43759](https://github.com/anomalyco/opencode/issues/43759), [#43761](https://github.com/anomalyco/opencode/pull/43761) |
| In progress | Ignore unknown named SSE events before JSON decoding | [#43765](https://github.com/anomalyco/opencode/issues/43765), [#43767](https://github.com/anomalyco/opencode/pull/43767) |

Anthropic's `AnthropicVertex` client reuses the Messages API implementation. It
rewrites Google authentication, the endpoint URL, `model`, and
`anthropic_version`; it does not perform agent-history normalization. OpenCode's
basic Vertex projection in `src/providers/google-vertex-messages.ts` follows the
same model.

## Request Lowering

- [x] Lower initial system prompts through the top-level `system` field.
- [x] Lower supported chronological system updates as native `system` messages.
- [x] Reject system updates that split a local `tool_use` from its `tool_result`.
- [x] Fall back to escaped user text when native chronological system updates are unsupported.
- [x] Batch parallel local tool results into one immediately following user turn.
- [x] Lower signed thinking blocks without changing their text or signature.
- [x] Round-trip opaque `redacted_thinking` blocks.
- [x] Lower text, supported base64 images, and PDF documents.
- [x] Enforce Anthropic's four explicit cache-breakpoint limit.
- [ ] Reject or safely lower visible reasoning that has no Anthropic signature. Current lowering emits an invalid unsigned `thinking` block.
- [ ] Enforce manual thinking budget constraints: `budget_tokens >= 1024` and, outside interleaved-thinking exceptions, `budget_tokens < max_tokens`.
- [ ] Reconcile canonical answer-token limits with Anthropic's `max_tokens`, which includes thinking output.
- [ ] Select manual, adaptive, disabled, and always-on thinking according to model capability.
- [ ] Suppress unsupported `temperature`, `top_p`, and `top_k` values for newer models.
- [ ] Reject unsupported thinking and effort combinations before network I/O.
- [ ] Normalize or reject final assistant prefills according to model capability and whitespace rules.
- [ ] Normalize Anthropic tool-call IDs to the provider's accepted character and length constraints.
- [ ] Filter empty request text blocks at the AI-package boundary rather than relying on Core history conversion.
- [ ] Restrict base64 image MIME types to JPEG, PNG, GIF, and WebP.
- [ ] Support URL image/document sources, plain-text/content documents, search-result blocks, and tool references where available.
- [ ] Model typed request metadata and current request controls instead of requiring raw HTTP body overlays.

## Stream Lifecycle

- [x] Parse text, thinking, signature, and tool-input deltas.
- [x] Emit canonical text and reasoning start, delta, and end events.
- [x] Assemble streamed tool JSON and emit one terminal local tool call.
- [x] Settle pending streamed tool calls at `message_stop`.
- [x] Require a canonical terminal event before transport EOF.
- [x] Reject canonical events emitted after a terminal event.
- [ ] Require exactly one `message_start` before message or content events.
- [ ] Reject duplicate `message_start` events.
- [ ] Track open content-block indexes and reject deltas or stops without matching starts.
- [ ] Reject duplicate block starts and stops.
- [ ] Distinguish a normal `content_block_stop` from cleanup at `message_stop` or transport interruption.
- [ ] Require a valid terminal message delta and stop reason before accepting `message_stop`.
- [ ] Reject a standalone `message_stop` instead of manufacturing an unknown successful finish.
- [ ] Preserve abnormal closure state for interrupted text, reasoning, and tool input.
- [x] Ignore unknown named SSE events before decoding their data payload while keeping recognized non-empty event payloads strict. Tracked by [#43765](https://github.com/anomalyco/opencode/issues/43765) and [#43767](https://github.com/anomalyco/opencode/pull/43767).
- [ ] Preserve citation deltas and attach them to their text blocks.
- [ ] Fail safely on unknown replay-critical content blocks instead of silently dropping them.

## Terminal Outcomes

- [x] Preserve raw stop reasons alongside normalized finish reasons.
- [x] Map `end_turn` and `stop_sequence` to normal stop.
- [x] Map `max_tokens` and `model_context_window_exceeded` to length.
- [x] Map `tool_use` to tool continuation.
- [x] Map `refusal` to content-filter outcome.
- [ ] Treat `pause_turn` as a continuation requirement by replaying the assistant content immediately. It is currently normalized as an ordinary stop.
- [ ] Preserve structured refusal `stop_details`, including category and explanation.
- [ ] Discard or quarantine partial visible output when a streamed refusal requires it.
- [ ] Retain response ID, actual served model, container state, initial message metadata, and complete stop diagnostics.
- [ ] Apply a runner-level policy for valid empty `end_turn` responses when the product requires usable output. Empty `end_turn` is valid Anthropic protocol and must not be rejected by the adapter itself.

## Compaction And Context Management

- [ ] Model native context-management request options.
- [ ] Parse `compaction` content blocks and `compaction_delta` events.
- [ ] Preserve compaction `content` and opaque `encrypted_content` exactly.
- [ ] Persist and replay compaction blocks across stateless requests.
- [ ] Map the compaction stop reason to a continuation outcome.
- [ ] Include compaction, advisor, fallback, and message iterations in usage accounting.
- [ ] Fail safely when raw HTTP overlays enable unsupported context management. Current behavior can silently drop compaction output and report an empty unknown completion.

## Hosted Tools

- [x] Parse and replay `server_tool_use` blocks.
- [x] Parse and replay web-search, web-fetch, and code-execution result payloads.
- [x] Mark hosted calls and results as provider-executed so local dispatch is skipped.
- [ ] Lower `ToolDefinition.native` into Anthropic hosted-tool definitions.
- [ ] Support current web search, web fetch, code execution, bash, editor, memory, and tool-search request definitions where deployed.
- [ ] Preserve bash, editor, tool-search, and container-upload response blocks.
- [ ] Preserve `caller` provenance and container continuation state.
- [ ] Support strict schemas, deferred loading, tool references, and eager input streaming.
- [ ] Gate hosted-tool definitions and result families by deployment capability, especially on Vertex.

## Usage And Accounting

- [x] Merge usage split between `message_start` and `message_delta`.
- [x] Preserve unknown Anthropic usage fields in provider metadata.
- [x] Normalize cache-read, cache-write, non-cached input, output, and thinking-token counts.
- [x] Accept nullable `message_delta.usage.input_tokens` while retaining the earlier start count for normalized usage. Implemented by [PR #43761](https://github.com/anomalyco/opencode/pull/43761).
- [ ] Normalize the five-minute and one-hour cache-write split for accurate costing.
- [ ] Aggregate iteration usage once at terminal completion without double counting.

## Google Vertex

- [x] Remove `model` from the body and place it in the Vertex endpoint URL.
- [x] Add `anthropic_version: "vertex-2023-10-16"` to the request body.
- [x] Use `streamRawPredict` for streaming requests.
- [x] Support global, `us`, `eu`, and regional endpoint hosts.
- [x] Support explicit access tokens and lazy Application Default Credentials.
- [ ] Resolve project identity from the Google auth client or quota-project header when not configured explicitly.
- [ ] Preserve all Google auth headers, including quota-project headers, rather than reducing authentication to a bearer token.
- [ ] Classify transient ADC acquisition failures as retryable transport failures instead of missing credentials.
- [ ] Handle the Vertex terminal-system-after-tool-result divergence without treating the workaround as the canonical Messages representation. Tracked by [#43478](https://github.com/anomalyco/opencode/issues/43478) and [PR #43498](https://github.com/anomalyco/opencode/pull/43498).

Anthropic documents a terminal system message immediately after a `tool_result`
as valid and supported on Google Cloud. Vertex nevertheless returns 404 for the
reported continuation shape. Folding the update into the user tool-result turn
avoids the deployment error, but lowers system authority and adds text after a
tool result, which can cause an empty `end_turn`. Treat this as deployment
capability policy rather than a change to the canonical Messages protocol.

## Comparison With Pi

| Area | OpenCode | pi |
| --- | --- | --- |
| Unknown named SSE events | Filters before JSON parsing | Filters before JSON parsing |
| Response ID and refusal details | Missing | Preserved |
| Unsigned thinking replay | Emits invalid thinking | Safely lowers to text by default |
| Empty request content | Core filters some paths | Adapter filters directly |
| Tool-call ID normalization | Missing | Implemented |
| Temperature compatibility | Missing | Model compatibility driven |
| One-hour cache-write accounting | Raw metadata only | Normalized for costing |
| Vertex Anthropic | First-class route | Available through custom `AnthropicVertex` client injection |
| Required terminal EOF | Enforced | Less strict |
| Parallel tool-result batching | Implemented | Implemented |
| Pending tool settlement | Implemented | Implemented |
| Redacted-thinking replay | Implemented | Implemented |
| PDF and media tool results | Implemented | Narrower support |
| Native compaction | Missing | Missing |
| `pause_turn` continuation | Missing | Missing |

## Confirmed Non-Gaps

- [x] Treat `signature_delta.signature` as the complete signature value. Anthropic documents one signature delta before block stop, and the official `MessageStream` also replaces rather than appends it. Appending is optional proxy tolerance.
- [x] Accept empty `end_turn` as a valid provider response. Product-level recovery may request continuation, but the protocol must preserve the valid outcome.
- [x] Require `message_stop` before clean completion. OpenCode is stricter than Anthropic's raw SDK stream here.

## Suggested Work Order

- [x] Merge nullable input usage support in [PR #43761](https://github.com/anomalyco/opencode/pull/43761).
- [ ] Handle unsigned reasoning replay.
- [ ] Restrict image MIME types.
- [ ] Validate manual thinking budgets.
- [ ] Preserve response identity and refusal details.
- [x] Filter unknown named SSE events while preserving strict recognized-event decoding.
- [ ] Enforce the complete stream lifecycle grammar.
- [ ] Add native compaction representation, persistence, and replay.
- [ ] Complete hosted-tool request and response support.

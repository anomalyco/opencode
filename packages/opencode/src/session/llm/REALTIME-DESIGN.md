# OpenAI Realtime (WebSocket) Transport — Design Note

**Status:** Draft scaffold. Not wired into the live `stream()` path yet.
**Scope:** OpenAI Realtime API (`wss://api.openai.com/v1/realtime`) only. **Not** a
replacement for the HTTP/SSE chat or Responses transports — those remain the
default and unchanged.

## Motivation

OpenAI's Realtime API is event-based over WebSocket and exposes lower-latency
streaming, server-side VAD, and audio modalities that aren't accessible through
`@ai-sdk/openai`'s `responses(modelID)` LanguageModelV2 adapter. Some users want
to drive text-mode tool calls through Realtime to get faster first-token + reduced
head-of-line blocking. This scaffold adds the plumbing so that work can be done
behind a flag without disturbing the current chat path.

## Non-goals

- Replacing `@ai-sdk/openai` or the existing `responses()` path.
- Audio/voice features (the WS schema supports them, but text-mode tool-calling
  is the only thing the session loop needs today).
- Cross-provider WS abstraction. This is OpenAI-Realtime-specific; other
  providers ship their own protocols.

## Surface

New file: `packages/opencode/src/session/llm/realtime.ts`

```
export function status(input): RuntimeStatus           // mirrors native-runtime.ts
export function stream(input): Effect<StreamResult>    // returns Stream<LLMEvent>
export const REALTIME_URL = "wss://api.openai.com/v1/realtime"
```

The shape intentionally matches `native-runtime.ts`'s `status()` / `StreamResult`
so that, when wired in, the dispatch site in `session/llm.ts` can pick
`realtime → native → ai-sdk` in priority order with the same selection pattern
already used.

## Config flag

Added to `experimental` in `packages/opencode/src/config/config.ts`:

```
openai_realtime: Schema.optional(Schema.Boolean).annotate({
  description: "Use OpenAI Realtime (WebSocket) transport for OpenAI text models. Default: false."
})
```

Default is `false`. When unset, nothing about today's behavior changes.

## Event mapping

Realtime emits a tagged event stream over the socket. The skeleton maps a
minimum useful subset onto `@opencode-ai/llm` `LLMEvent`:

| Realtime event                              | LLMEvent                              |
| ------------------------------------------- | ------------------------------------- |
| `session.created`                           | (no-op)                               |
| `response.created`                          | `stepStart({ index })`                |
| `response.output_item.added` (type=message) | `textStart({ id })`                   |
| `response.output_text.delta`                | `textDelta({ id, text })`             |
| `response.output_text.done`                 | `textEnd({ id })`                     |
| `response.function_call_arguments.delta`    | `toolInputDelta({ id, name, text })`  |
| `response.function_call_arguments.done`     | `toolInputEnd({ id, name })`          |
| `response.output_item.done` (type=tool)     | `toolCall({ id, name, input })`       |
| `response.done`                             | `stepFinish` + `finish`               |
| `error`                                     | `Stream.fail`                         |

Items not listed (audio.*, transcript.*, rate_limits.updated, etc.) are dropped
in the skeleton. They become no-ops in `toLLMEvents()` and remain easy to add
later without touching the transport.

## Lifecycle / cleanup

- `Effect.acquireRelease` owns the `WebSocket`. The finalizer sends a
  `close()` and unregisters listeners regardless of completion or failure.
- The caller's `AbortSignal` is bridged to `ws.close(1000, "abort")`.
- An idle-timeout is applied at the same layer the SSE path uses
  (`Stream.timeoutOrElse`), keeping symmetry with the
  `feat/llm-stream-idle-timeout` PR.

## Auth

Realtime accepts the standard `Authorization: Bearer <key>` over the WS
upgrade headers, plus an `OpenAI-Beta: realtime=v1` header. No OAuth path
yet — initial scope is API-key only; OAuth can layer in once the provider
auth code supports passing an access token through `upgrade` headers.

## Why scaffold-only

- The Realtime event surface is wide and still evolving (OpenAI has rolled
  several non-breaking additions in 2025-2026).
- The wiring into `session/llm.ts` is mechanically simple but should follow
  the maintainers' preferred dispatch pattern — better to land the skeleton
  first and iterate on integration in review.
- Sessions that depend on existing tool-call semantics shouldn't be migrated
  silently; the flag-gate ensures opt-in.

## Open questions for maintainers

1. **Provider model** — register Realtime as a separate `providerID`
   (e.g. `openai-realtime`) with its own model list, or keep it under
   `openai` and switch transport based on the flag + model id prefix?
2. **Tool schema translation** — Realtime expects `function` tool defs in
   the `session.update` event; should this reuse `ProviderTransform.tools`
   or stay a Realtime-specific path?
3. **Reasoning models** — `gpt-5*` reasoning items aren't first-class in
   Realtime today. Block them at `status()` time, or pass through and let
   the API return a clear error?

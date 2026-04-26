import { Cause, Effect, Schema, Stream } from "effect"
import * as Sse from "effect/unstable/encoding/Sse"
import type { HttpClientResponse } from "effect/unstable/http"
import { ProviderChunkError } from "../schema"

export const Json = Schema.fromJsonString(Schema.Unknown)
export const decodeJson = Schema.decodeUnknownSync(Json)
export const encodeJson = Schema.encodeSync(Json)

export const chunkError = (adapter: string, message: string, raw?: string) =>
  new ProviderChunkError({ adapter, message, raw })

export const parseJson = (adapter: string, input: string, message: string) =>
  Effect.try({
    try: () => decodeJson(input),
    catch: () => chunkError(adapter, message, input),
  })

/**
 * Join the `text` field of a list of parts with newlines. Used by adapters
 * that flatten system / message content arrays into a single provider string
 * (OpenAI Chat `system` content, OpenAI Responses `system` content, Gemini
 * `systemInstruction.parts[].text`).
 */
export const joinText = (parts: ReadonlyArray<{ readonly text: string }>) =>
  parts.map((part) => part.text).join("\n")

/**
 * Parse the streamed JSON input of a tool call. Treats an empty string as
 * `"{}"` — providers occasionally finish a tool call without ever emitting
 * input deltas (e.g. zero-arg tools). The error message is uniform across
 * adapters: `Invalid JSON input for <adapter> tool call <name>`.
 */
export const parseToolInput = (adapter: string, name: string, raw: string) =>
  parseJson(adapter, raw || "{}", `Invalid JSON input for ${adapter} tool call ${name}`)

const streamError = (adapter: string, message: string, cause: Cause.Cause<unknown>) => {
  const failed = cause.reasons.find(Cause.isFailReason)?.error
  if (failed instanceof ProviderChunkError) return failed
  return chunkError(adapter, message, Cause.pretty(cause))
}

/**
 * Generic streaming-response decoder used by every adapter. Splits the
 * response stream into:
 *
 *   bytes → frames (caller-supplied) → chunk → (state, events)
 *
 * The `framing` step is the protocol-specific part — SSE adapters use the
 * `sseFraming` helper below; binary protocols (Bedrock event-stream)
 * supply their own byte-level decoder. Everything else (transport-error
 * normalization, schema decoding per chunk, stateful chunk → event mapping,
 * `onHalt` flush, terminal-error normalization) is shared.
 */
export const framed = <Frame, Chunk, State, Event>(input: {
  readonly adapter: string
  readonly response: HttpClientResponse.HttpClientResponse
  readonly readError: string
  readonly framing: (
    bytes: Stream.Stream<Uint8Array, ProviderChunkError>,
  ) => Stream.Stream<Frame, ProviderChunkError>
  readonly decodeChunk: (frame: Frame) => Effect.Effect<Chunk, ProviderChunkError>
  readonly initial: () => State
  readonly process: (
    state: State,
    chunk: Chunk,
  ) => Effect.Effect<readonly [State, ReadonlyArray<Event>], ProviderChunkError>
  readonly onHalt?: (state: State) => ReadonlyArray<Event>
}): Stream.Stream<Event, ProviderChunkError> => {
  const bytes = input.response.stream.pipe(
    Stream.mapError((error) => chunkError(input.adapter, input.readError, String(error))),
  )
  return input.framing(bytes).pipe(
    Stream.mapEffect(input.decodeChunk),
    Stream.mapAccumEffect(input.initial, input.process, input.onHalt ? { onHalt: input.onHalt } : undefined),
    Stream.catchCause((cause) => Stream.fail(streamError(input.adapter, input.readError, cause))),
  )
}

/**
 * `framing` step for Server-Sent Events. Decodes UTF-8, runs the SSE channel
 * decoder, and drops empty / `[DONE]` keep-alive events so the downstream
 * `decodeChunk` sees one JSON string per element. The SSE channel emits a
 * `Retry` control event on its error channel; we drop it here (we don't
 * implement client-driven retries) so the public error channel stays
 * `ProviderChunkError`.
 */
export const sseFraming = (
  bytes: Stream.Stream<Uint8Array, ProviderChunkError>,
): Stream.Stream<string, ProviderChunkError> =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.catchTag("Retry", () => Stream.empty),
    Stream.filter((event) => event.data.length > 0 && event.data !== "[DONE]"),
    Stream.map((event) => event.data),
  )

/**
 * SSE-specific convenience over `framed`. Identical surface as the original
 * `sse` helper; preserves the `decodeChunk: (data: string) => …` signature
 * so existing adapters don't need to know about `Frame`.
 */
export const sse = <Chunk, State, Event>(input: {
  readonly adapter: string
  readonly response: HttpClientResponse.HttpClientResponse
  readonly readError: string
  readonly decodeChunk: (data: string) => Effect.Effect<Chunk, ProviderChunkError>
  readonly initial: () => State
  readonly process: (
    state: State,
    chunk: Chunk,
  ) => Effect.Effect<readonly [State, ReadonlyArray<Event>], ProviderChunkError>
  readonly onHalt?: (state: State) => ReadonlyArray<Event>
}): Stream.Stream<Event, ProviderChunkError> => framed({ ...input, framing: sseFraming })

export * as ProviderShared from "./shared"

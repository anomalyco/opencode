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

const streamError = (adapter: string, message: string, cause: Cause.Cause<unknown>) => {
  const failed = cause.reasons.find(Cause.isFailReason)?.error
  if (failed instanceof ProviderChunkError) return failed
  return chunkError(adapter, message, Cause.pretty(cause))
}

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
}): Stream.Stream<Event, ProviderChunkError> =>
  input.response.stream.pipe(
    Stream.mapError((error) => chunkError(input.adapter, input.readError, String(error))),
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.filter((event) => event.data.length > 0 && event.data !== "[DONE]"),
    Stream.mapEffect((event) => input.decodeChunk(event.data)),
    Stream.mapAccumEffect(input.initial, input.process, input.onHalt ? { onHalt: input.onHalt } : undefined),
    Stream.catchCause((cause) => Stream.fail(streamError(input.adapter, input.readError, cause))),
  )

export * as ProviderShared from "./shared"

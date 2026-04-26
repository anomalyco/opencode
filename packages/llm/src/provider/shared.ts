import { Cause, Effect, Schema, Stream } from "effect"
import * as Sse from "effect/unstable/encoding/Sse"
import type { HttpClientResponse } from "effect/unstable/http"
import { ProviderChunkError } from "../schema"

export const Json = Schema.fromJsonString(Schema.Unknown)
export const decodeJson = Schema.decodeUnknownSync(Json)
export const encodeJson = Schema.encodeSync(Json)

export const chunkError = (adapter: string, message: string, raw?: string) =>
  new ProviderChunkError({ adapter, message, raw })

export const parseJson = (adapter: string, input: string, message: string) => {
  try {
    return decodeJson(input)
  } catch {
    throw chunkError(adapter, message, input)
  }
}

const streamError = (adapter: string, message: string, cause: Cause.Cause<unknown>) => {
  const failed = cause.reasons.find(Cause.isFailReason)?.error
  if (failed instanceof ProviderChunkError) return failed
  return chunkError(adapter, message, Cause.pretty(cause))
}

export const sse = <Chunk, State, Event>(input: {
  readonly adapter: string
  readonly response: HttpClientResponse.HttpClientResponse
  readonly readError: string
  readonly invalidChunk: string
  readonly decodeChunk: (data: string) => Chunk
  readonly initial: () => State
  readonly process: (state: State, chunk: Chunk) => readonly [State, ReadonlyArray<Event>]
  readonly onHalt?: (state: State) => ReadonlyArray<Event>
}): Stream.Stream<Event, ProviderChunkError> =>
  input.response.stream.pipe(
    Stream.mapError((error) => chunkError(input.adapter, input.readError, String(error))),
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.filter((event) => event.data.length > 0 && event.data !== "[DONE]"),
    Stream.mapEffect((event) =>
      Effect.try({
        try: () => input.decodeChunk(event.data),
        catch: (error) =>
          error instanceof ProviderChunkError ? error : chunkError(input.adapter, input.invalidChunk, event.data),
      }),
    ),
    Stream.mapAccum(input.initial, input.process, input.onHalt ? { onHalt: input.onHalt } : undefined),
    Stream.catchCause((cause) => Stream.fail(streamError(input.adapter, input.readError, cause))),
  )

export * as ProviderShared from "./shared"

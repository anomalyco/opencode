export * as OpenCode from "./client.js"

import { Cause, Context, Effect, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { SharedEvents } from "../shared-events.js"
import { ClientError, OpenCode } from "./generated/index.js"
import { RpcClientRuntime } from "./rpc.js"
import type { RpcCallOptions } from "../promise/rpc.js"

const CurrentHeaders = Context.Reference<RpcCallOptions["headers"]>("@opencode-ai/client/effect/rpc/headers", {
  defaultValue: () => undefined,
})

export const make = Effect.fn("OpenCode.make")(function* (options?: { readonly baseUrl?: URL | string }) {
  const httpClient = yield* HttpClient.HttpClient
  const raw = yield* OpenCode.make(options).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.mapRequestEffect(httpClient, (request) =>
        Effect.map(CurrentHeaders, (headers) =>
          headers ? HttpClientRequest.setHeaders(request, new Headers(headers)) : request,
        ),
      ),
    ),
  )
  const context = yield* Effect.context()
  const native = raw.event.subscribe()
  // Async iterators throw a squashed cause; retain the native typed failures and defects intact.
  class EventFailure {
    constructor(readonly cause: Cause.Cause<Stream.Error<typeof native>>) {}
  }
  const shared = SharedEvents.make((signal) =>
    Stream.toAsyncIterableWith(
      native.pipe(
        Stream.interruptWhen(RpcClientRuntime.aborted(signal)),
        Stream.catchCause((cause) => Stream.fail(new EventFailure(cause))),
      ),
      context,
    ),
  )
  const subscribe = () =>
    Stream.fromAsyncIterable(shared.subscribe(), (error) => error).pipe(
      Stream.catch((error) =>
        Stream.failCause(error instanceof EventFailure ? error.cause : Cause.fail(new ClientError({ cause: error }))),
      ),
    )
  return {
    ...raw,
    event: { ...raw.event, subscribe },
    rpc: Object.assign(
      RpcClientRuntime.make(
        (input, options) => raw.rpc.call(input).pipe(Effect.provideService(CurrentHeaders, options?.headers)),
        subscribe,
      ),
      raw.rpc,
    ),
  }
})

import {
  methods,
  type AgentApp,
  type AnyMessage,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type JsonRpcId,
  RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
} from "@agentclientprotocol/sdk"
import { Context, Deferred, Duration, Effect, Option } from "effect"
import { ACPError } from "./error"

export const Responded = Context.Reference<Effect.Effect<void>>("@opencode/cli/acp/Connection/Responded", {
  defaultValue: () => Effect.void,
})

/** Long enough for a slow tunnel, short enough that a stall is reported instead of hidden. */
export const ConnectedTimeout = Context.Reference<Duration.Input>("@opencode/cli/acp/Connection/ConnectedTimeout", {
  defaultValue: () => Duration.seconds(10),
})

const connectionDeadlines = new WeakMap<object, number>()

/**
 * Waits for the event stream to open and fails with EventStreamUnavailableError when it never did.
 * The deadline is remembered per connection, so a caller that arrives after the stream was already
 * declared silent fails at once instead of waiting the whole timeout again.
 */
export const awaitConnected = (connected: Deferred.Deferred<void>) =>
  Effect.gen(function* () {
    // A stream that opened long ago is still open: the deadline only bounds waiting for one that never did.
    if (Option.isSome(yield* Deferred.poll(connected))) return
    const timeout = yield* ConnectedTimeout
    const deadline = connectionDeadlines.get(connected) ?? Date.now() + Duration.toMillis(timeout)
    connectionDeadlines.set(connected, deadline)
    const remaining = deadline - Date.now()
    const opened =
      remaining > 0 &&
      Option.isSome(yield* Deferred.await(connected).pipe(Effect.timeoutOption(Duration.millis(remaining))))
    if (opened) return
    return yield* new ACPError.EventStreamUnavailableError({ seconds: Duration.toSeconds(timeout) })
  })

export interface Interface {
  readonly sessionUpdate: (params: SessionNotification) => Effect.Effect<void, RequestError>
  readonly requestPermission: (
    params: RequestPermissionRequest,
  ) => Effect.Effect<RequestPermissionResponse, RequestError>
  readonly extNotification: (method: string, params: Record<string, unknown>) => Effect.Effect<void, RequestError>
  readonly createElicitation: (
    params: CreateElicitationRequest,
  ) => Effect.Effect<CreateElicitationResponse, RequestError>
  readonly responded: (requestId: JsonRpcId) => Effect.Effect<void>
}

export function make(app: AgentApp, stream: Stream) {
  const responses = new Map<JsonRpcId, Deferred.Deferred<void>>()
  const writer = stream.writable.getWriter()
  const agent = app.connect({
    readable: stream.readable,
    writable: new WritableStream<AnyMessage>({
      write: async (message) => {
        await writer.write(message)
        if ("method" in message) return
        const responded = responses.get(message.id)
        if (!responded) return
        responses.delete(message.id)
        Deferred.doneUnsafe(responded, "result" in message ? Effect.void : Effect.interrupt)
      },
      close: () => writer.close(),
      abort: (reason) => writer.abort(reason),
    }),
  })
  return {
    agent,
    connection: {
      sessionUpdate: (params) => promise(() => agent.client.notify(methods.client.session.update, params)),
      requestPermission: (params) =>
        promise((signal) =>
          agent.client.request(methods.client.session.requestPermission, params, { cancellationSignal: signal }),
        ),
      extNotification: (method, params) => promise(() => agent.client.notify(method, params)),
      createElicitation: (params) =>
        promise((signal) =>
          agent.client.request(methods.client.elicitation.create, params, { cancellationSignal: signal }),
        ),
      responded: (requestId) => {
        const responded = Deferred.makeUnsafe<void>()
        responses.set(requestId, responded)
        return Deferred.await(responded)
      },
    } satisfies Interface,
  }
}

function promise<A>(evaluate: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({ try: evaluate, catch: (cause) => cause }).pipe(
    Effect.catch((cause) => (cause instanceof RequestError ? Effect.fail(cause) : Effect.die(cause))),
  )
}

export * as ACPConnection from "./connection"

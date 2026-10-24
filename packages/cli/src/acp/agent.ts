import {
  agent,
  RequestError,
  type AgentHandlerContext,
  type AgentNotificationHandlersByMethod,
  type AgentNotificationMethod,
  type AgentRequestHandlersByMethod,
  type AgentRequestMethod,
  type JsonRpcId,
  type Stream,
} from "@agentclientprotocol/sdk"
import type { WireStream } from "@agentclientprotocol/sdk/experimental/v2"
import type { OpenCodeClient } from "@opencode/client/effect"
import { Cause, Deferred, Effect, Ref, type Scope } from "effect"
import { ACPCapabilities } from "./capabilities"
import { ACPCatalog } from "./catalog"
import { ACPClient } from "./client"
import { ACPConnection } from "./connection"
import { ACPError } from "./error"
import { ACPService } from "./service"
import { ACPSessions } from "./sessions"
import { ACPTurn } from "./turn"

type HandlerContext<Params> = AgentHandlerContext<Params> & { readonly requestId?: JsonRpcId }

// Untraced so request spans parent to the caller's span instead of a setup span that has already ended.
export const connect = Effect.fnUntraced(function* (client: OpenCodeClient, stream: Stream) {
  const run = Effect.runPromiseWith(yield* Effect.context<Scope.Scope>())
  const catalog = yield* ACPCatalog.make(client)
  // Requests can dispatch before the service below is built.
  const ready = yield* Deferred.make<{
    readonly service: ACPService.Interface
    readonly connection: ACPConnection.Interface
  }>()
  const handle =
    <Params, A>(
      call: (service: ACPService.Interface, ctx: AgentHandlerContext<Params>) => Effect.Effect<A, ACPError.Failure>,
    ) =>
    (name: string) => {
      const handler = Effect.fn(name)(
        function* (ctx: HandlerContext<Params>) {
          const connected = yield* Deferred.await(ready)
          if (ctx.requestId === undefined) return yield* call(connected.service, ctx)
          return yield* call(connected.service, ctx).pipe(
            Effect.provideService(ACPConnection.Responded, connected.connection.responded(ctx.requestId)),
          )
        },
        Effect.catchTags({
          ACPCatalogLoadError: (error) => ACPClient.classify(error.cause),
          ACPCatalogNotReadyError: (error) =>
            Effect.fail(new ACPError.ServiceFailureError({ safeMessage: error.message, errorName: "CatalogNotReady" })),
        }),
        Effect.mapError((error) => (error instanceof RequestError ? error : ACPError.toRequestError(error))),
        Effect.tapCauseIf(Cause.hasDies, (cause) => Effect.logError("ACP request failed", cause)),
        Effect.catchDefect((defect) => Effect.fail(ACPError.toRequestError(ACPError.fromUnknown(defect)))),
      )
      return (ctx: HandlerContext<Params>) => run(handler(ctx))
    }
  const app = agent({ name: "opencode" })
  const request = <Method extends AgentRequestMethod>(
    method: Method,
    make: (name: string) => AgentRequestHandlersByMethod[Method],
  ) => app.onRequest(method, make(spanName(method)))
  const notification = <Method extends AgentNotificationMethod>(
    method: Method,
    make: (name: string) => AgentNotificationHandlersByMethod[Method],
  ) => app.onNotification(method, make(spanName(method)))

  request(
    "initialize",
    handle((service, ctx) => service.initialize(ctx.params)),
  )
  request(
    "authenticate",
    handle((service, ctx) => service.authenticate(ctx.params)),
  )
  request(
    "session/new",
    handle((service, ctx) => service.newSession(ctx.params)),
  )
  request(
    "session/load",
    handle((service, ctx) => service.loadSession(ctx.params)),
  )
  request(
    "session/list",
    handle((service, ctx) => service.listSessions(ctx.params)),
  )
  request(
    "session/delete",
    handle((service, ctx) => service.deleteSession(ctx.params)),
  )
  request(
    "session/resume",
    handle((service, ctx) => service.resumeSession(ctx.params)),
  )
  request(
    "session/close",
    handle((service, ctx) => service.closeSession(ctx.params)),
  )
  request(
    "session/fork",
    handle((service, ctx) => service.forkSession(ctx.params)),
  )
  request(
    "session/set_config_option",
    handle((service, ctx) => service.setSessionConfigOption(ctx.params)),
  )
  request(
    "session/set_mode",
    handle((service, ctx) => service.setSessionMode(ctx.params)),
  )
  request(
    "session/prompt",
    handle((service, ctx) => service.prompt(ctx.params, ctx.signal)),
  )
  notification(
    "session/cancel",
    handle((service, ctx) => service.cancel(ctx.params)),
  )
  const acp = ACPConnection.make(app, stream)
  const connection = acp.connection
  const sessions = yield* ACPSessions.make({ client, connection, catalog })
  const capabilities = yield* Ref.make(ACPCapabilities.parse(undefined))
  const turn = yield* ACPTurn.make({ client, connection, sessions, catalog, capabilities })
  yield* Deferred.succeed(ready, {
    service: ACPService.make({ client, connection, catalog, sessions, capabilities, turn }),
    connection,
  })
  return acp.agent
})

export const router = Effect.fnUntraced(function* (
  client: OpenCodeClient,
  options: { readonly experimentalV2?: boolean } = {},
) {
  const { agentProtocolRouter } = yield* Effect.promise(() => import("@agentclientprotocol/sdk/experimental/v2"))
  const { ACPAgentV2 } = yield* Effect.promise(() => import("./agent-v2"))
  const run = Effect.runPromiseWith(yield* Effect.context<Scope.Scope>())
  return {
    connect(stream: WireStream) {
      const controller = new AbortController()
      const selected: { close?: (reason?: unknown) => void } = {}
      const observe = <
        Connection extends {
          readonly closed: Promise<void>
          readonly signal: AbortSignal
          close(reason?: unknown): void
        },
      >(
        connection: Connection,
      ) => {
        selected.close = (reason) => connection.close(reason)
        void connection.closed.then(() => controller.abort(connection.signal.reason))
        return connection
      }
      const reader = stream.readable.getReader()
      const readable = new ReadableStream({
        pull: (output) =>
          reader.read().then(
            (item) => {
              if (item.done) {
                output.close()
                return
              }
              output.enqueue(item.value)
            },
            (error) => {
              controller.abort(error)
              output.error(error)
            },
          ),
        cancel: (reason) => reader.cancel(reason),
      })
      const protocol = agentProtocolRouter().withV1({
        // SAFETY: the SDK router removes v2 batch framing before dispatching to v1.
        connect: (stream) => run(connect(client, stream as Stream)).then(observe),
      })
      if (options.experimentalV2)
        protocol.withV2({ connect: (stream) => run(ACPAgentV2.connect(client, stream)).then(observe) })
      const connection = protocol.connect({ readable, writable: stream.writable })
      return {
        ...connection,
        closed: connection.closed.then(() => selected.close?.(controller.signal.reason)),
        signal: controller.signal,
      }
    },
  }
})

const spanName = (method: string) => `cli.acp.${method.replaceAll("/", ".")}`

export * as ACP from "./agent"

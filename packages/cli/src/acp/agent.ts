import {
  agent,
  RequestError,
  type AgentHandlerContext,
  type AgentNotificationHandlersByMethod,
  type AgentNotificationMethod,
  type AgentRequestHandlersByMethod,
  type AgentRequestMethod,
  type Stream,
} from "@agentclientprotocol/sdk"
import type { OpenCodeClient } from "@opencode/client/promise"
import { Cause, Deferred, Effect, Ref, type Scope } from "effect"
import { ACPCatalog } from "./catalog"
import { ACPConnection } from "./connection"
import { ACPError } from "./error"
import { ACPPromise } from "./promise"
import { ACPService } from "./service"
import { ACPSessions } from "./sessions"
import { ACPTurn } from "./turn"

// Untraced so request spans parent to the caller's span instead of a setup span that has already ended.
export const connect = Effect.fnUntraced(function* (client: OpenCodeClient, stream: Stream) {
  const run = Effect.runPromiseWith(yield* Effect.context<Scope.Scope>())
  const catalog = yield* ACPCatalog.make(client)
  // Requests can dispatch once the stream's read loop yields, which may be before the service below is built.
  const ready = yield* Deferred.make<ACPService.Interface>()
  const handle =
    <Params, A>(
      call: (service: ACPService.Interface, ctx: AgentHandlerContext<Params>) => Effect.Effect<A, ACPService.Failure>,
    ) =>
    (name: string) => {
      const handler = Effect.fn(name)(
        (ctx: AgentHandlerContext<Params>) =>
          Deferred.await(ready).pipe(Effect.flatMap((service) => call(service, ctx))),
        Effect.catchTags({
          ACPCatalogLoadError: (error) => ACPPromise.classify(error.cause),
          ACPCatalogNotReadyError: (error) => Effect.die(error),
        }),
        Effect.mapError((error) => (error instanceof RequestError ? error : ACPError.toRequestError(error))),
        Effect.tapCauseIf(Cause.hasDies, (cause) => Effect.logError("ACP request failed", cause)),
        Effect.catchDefect((defect) => Effect.fail(ACPError.toRequestError(ACPError.fromUnknown(defect)))),
      )
      return (ctx: AgentHandlerContext<Params>) => run(handler(ctx))
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
  // The SDK signal is passed through rather than interrupting the fiber: a cancelled turn still resolves with
  // `stopReason: "cancelled"`.
  request(
    "session/prompt",
    handle((service, ctx) => service.prompt(ctx.params, ctx.signal)),
  )
  notification(
    "session/cancel",
    handle((service, ctx) => service.cancel(ctx.params)),
  )
  const agentConnection = app.connect(stream)
  const connection = ACPConnection.make(agentConnection)
  const sessions = yield* ACPSessions.make({ client, connection, catalog })
  const capabilities = yield* Ref.make({ childSessionUpdates: false })
  const turn = yield* ACPTurn.make({
    client,
    connection,
    permissions: ACPConnection.promise(agentConnection),
    sessions,
    catalog,
    capabilities,
  })
  yield* Deferred.succeed(ready, ACPService.make({ client, connection, catalog, sessions, capabilities, turn }))
  return agentConnection
})

const spanName = (method: string) => `cli.acp.${method.replaceAll("/", ".")}`

export * as ACP from "./agent"

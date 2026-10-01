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
import { ClientError, type OpenCodeClient } from "@opencode/client/promise"
import { Cause, Effect, type Scope } from "effect"
import { ACPCatalog } from "./catalog"
import { ACPConnection } from "./connection"
import { ACPError } from "./error"
import { ACPService } from "./service"

// Untraced so request spans parent to the caller's span instead of a setup span that has already ended.
export const connect = Effect.fnUntraced(function* (client: OpenCodeClient, stream: Stream) {
  const run = Effect.runPromiseWith(yield* Effect.context<Scope.Scope>())
  const catalog = yield* ACPCatalog.make(client)
  const handle =
    <Params, A>(call: (ctx: AgentHandlerContext<Params>) => Effect.Effect<A, ACPError.Error | RequestError>) =>
    (name: string) => {
      const handler = Effect.fn(name)(
        call,
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
    handle((ctx) => promise(() => service.initialize(ctx.params))),
  )
  request(
    "authenticate",
    handle((ctx) => promise(() => service.authenticate(ctx.params))),
  )
  request(
    "session/new",
    handle((ctx) => promise(() => service.newSession(ctx.params))),
  )
  request(
    "session/load",
    handle((ctx) => promise(() => service.loadSession(ctx.params))),
  )
  request(
    "session/list",
    handle((ctx) => promise(() => service.listSessions(ctx.params))),
  )
  request(
    "session/delete",
    handle((ctx) => promise(() => service.deleteSession(ctx.params))),
  )
  request(
    "session/resume",
    handle((ctx) => promise(() => service.resumeSession(ctx.params))),
  )
  request(
    "session/close",
    handle((ctx) => promise(() => service.closeSession(ctx.params))),
  )
  request(
    "session/fork",
    handle((ctx) => promise(() => service.forkSession(ctx.params))),
  )
  request(
    "session/set_config_option",
    handle((ctx) => promise(() => service.setSessionConfigOption(ctx.params))),
  )
  request(
    "session/set_mode",
    handle((ctx) => promise(() => service.setSessionMode(ctx.params))),
  )
  // The SDK signal is passed through rather than interrupting the fiber: a cancelled turn still resolves with
  // `stopReason: "cancelled"`.
  request(
    "session/prompt",
    handle((ctx) => promise(() => service.prompt(ctx.params, ctx.signal))),
  )
  notification(
    "session/cancel",
    handle((ctx) => promise(() => service.cancel(ctx.params))),
  )
  const connection = app.connect(stream)
  // Inbound dispatch starts after the stream's async read loop yields, so handlers never observe this before assignment.
  const service = ACPService.make({ client, connection: ACPConnection.make(connection), catalog, run })
  return connection
})

const spanName = (method: string) => `cli.acp.${method.replaceAll("/", ".")}`

const promise = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({
    try: evaluate,
    // A catalog load failure is classified by the client error that caused it.
    catch: (cause) => (cause instanceof ACPCatalog.LoadError ? cause.cause : cause),
  }).pipe(
    Effect.catch((cause) => {
      if (cause instanceof RequestError || ACPError.is(cause)) return Effect.fail(cause)
      if (cause instanceof ClientError && cause.reason === "Transport")
        return Effect.fail(new ACPError.ServerUnavailableError())
      return Effect.die(cause)
    }),
  )

export * as ACP from "./agent"

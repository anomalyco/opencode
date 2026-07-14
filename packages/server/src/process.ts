export * as ServerProcess from "./process"

import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node"
import { HealthGroup } from "@opencode-ai/protocol/groups/health"
import { Context, Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpMiddleware, HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApi, HttpApiClient } from "effect/unstable/httpapi"
import { createServer } from "node:http"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { ServerAuth } from "./auth"
import { createRoutes } from "./routes"
import { ServerInfo } from "./server-info"

export type Options = {
  readonly hostname: string
  readonly port: Option.Option<number>
  readonly password: string
  readonly restartContinuity?: boolean
}

const ReadinessApi = HttpApi.make("readiness").add(HealthGroup)

export const start = Effect.fn("ServerProcess.start")(function* (options: Options) {
  if (!options.password) return yield* Effect.fail(new Error("Missing server password"))
  const address = yield* listen(options)
  yield* Effect.gen(function* () {
    const client = yield* HttpApiClient.make(ReadinessApi, {
      baseUrl: HttpServer.formatAddress(address),
      transformClient: HttpClient.mapRequest((request) =>
        HttpClientRequest.setHeader(
          request,
          "authorization",
          ServerAuth.header({ username: "opencode", password: options.password }) ?? "",
        ),
      ),
    })
    yield* client["server.health"]["health.get"]({})
  }).pipe(Effect.provide(NodeHttpClient.layerNodeHttp))
  return address
})

function listen(options: Options) {
  if (Option.isSome(options.port)) return bind(options, options.port.value)
  const next = (port: number): ReturnType<typeof bind> =>
    bind(options, port).pipe(Effect.catch((error) => (port === 65_535 ? Effect.fail(error) : next(port + 1))))
  return next(4096)
}

function bind(options: Options, port: number) {
  const server = createServer()
  return Layer.build(
    createRoutes(options.password, () => {
      const address = server.address()
      if (address === null || typeof address === "string") return []
      const host = address.family === "IPv6" ? `[${address.address}]` : address.address
      return ServerInfo.connectionURLs(`http://${host}:${address.port}`, options.hostname)
    }).pipe(
      Layer.flatMap((context) => {
        const serve = HttpServer.serve(
          Context.get(context, HttpRouter.HttpRouter).asHttpEffect(),
          HttpMiddleware.logger,
        )
        if (!options.restartContinuity) return serve
        const restart = Context.get(context, SessionRestart.Service)
        return Layer.merge(serve, restartContinuity(restart))
      }),
      Layer.provideMerge(NodeHttpServer.layer(() => server, { port, host: options.hostname })),
    ),
  ).pipe(
    Effect.tap(() => Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()))),
    Effect.map((context) => Context.get(context, HttpServer.HttpServer).address),
  )
}

/**
 * The managed server owns restart continuity: it resumes Sessions the previous server suspended and
 * suspends its own active Sessions on graceful shutdown. Suspension runs while the drains are still
 * alive: connections close first, this finalizer runs next, and Session execution teardown follows.
 */
function restartContinuity(restart: SessionRestart.Interface) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      yield* Effect.forkScoped(restart.resumeSuspendedSessions)
      // Registered after the fork so suspension observes still-running resumed drains during teardown.
      yield* Effect.addFinalizer(() => restart.suspendActiveSessions)
    }),
  )
}

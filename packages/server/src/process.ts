export * as ServerProcess from "./process"

import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node"
import { HealthGroup } from "@opencode-ai/protocol/groups/health"
import { Context, Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpMiddleware, HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApi, HttpApiClient } from "effect/unstable/httpapi"
import { createServer } from "node:http"
import { ServerAuth } from "./auth"
import { createRoutes } from "./routes"

export type Options = {
  readonly hostname: string
  readonly port: Option.Option<number>
  readonly password: string
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
  if (Option.isSome(options.port)) return bind(options.hostname, options.port.value, options.password)
  const next = (port: number): ReturnType<typeof bind> =>
    bind(options.hostname, port, options.password).pipe(
      Effect.catch((error) => (port === 65_535 ? Effect.fail(error) : next(port + 1))),
    )
  return next(4096)
}

function bind(hostname: string, port: number, password: string) {
  const server = createServer()
  return Layer.build(
    createRoutes(password).pipe(
      Layer.flatMap((context) =>
        HttpServer.serve(Context.get(context, HttpRouter.HttpRouter).asHttpEffect(), HttpMiddleware.logger),
      ),
      Layer.provideMerge(NodeHttpServer.layer(() => server, { port, host: hostname })),
    ),
  ).pipe(
    Effect.tap(() => Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()))),
    Effect.map((context) => Context.get(context, HttpServer.HttpServer).address),
  )
}

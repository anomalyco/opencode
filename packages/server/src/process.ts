export * as ServerProcess from "./process"

import { NodeHttpServer, NodeHttpServerRequest } from "@effect/platform-node"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { ServiceStatus } from "@opencode-ai/protocol/groups/health"
import { hasPtyConnectTicketURL } from "@opencode-ai/protocol/groups/pty"
import { Cause, Context, Deferred, Effect, Exit, Layer, Option, Ref, Schema, Scope } from "effect"
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createServer } from "node:http"
import { ServerAuth } from "./auth"
import { authorizedRequest } from "./middleware/authorization"
import { createRoutes } from "./routes"
import { ServerInfo } from "./server-info"
import { Status } from "./service-status"

export type Options<E = never, R = never> = {
  readonly hostname: string
  readonly port: Option.Option<number>
  readonly password: string
  readonly instanceID: string
  readonly service?: {
    readonly onListen: (address: HttpServer.Address) => Effect.Effect<void, E, R>
  }
}

type App = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  unknown,
  HttpServerRequest.HttpServerRequest | Scope.Scope
>

export const start = Effect.fn("ServerProcess.start")(function* <E, R>(options: Options<E, R>) {
  if (!options.password) return yield* Effect.fail(new Error("Missing server password"))
  const shutdown = yield* Deferred.make<void>()
  const status = yield* Status.make({
    instanceID: options.instanceID,
    managed: options.service !== undefined,
  })
  const bound = yield* listen(options)
  const application = yield* Ref.make(Option.none<App>())
  yield* bound.http.serve(dispatch(options.password, status, application, shutdown), HttpMiddleware.logger)
  if (options.service) yield* options.service.onListen(bound.http.address)

  const parentScope = yield* Scope.Scope
  const applicationScope = yield* Scope.fork(parentScope)
  yield* Effect.addFinalizer(() =>
    status
      .beginStopping()
      .pipe(
        Effect.andThen(Ref.set(application, Option.none())),
        Effect.andThen(Effect.sync(() => bound.server.closeAllConnections())),
      ),
  )

  const boot = Effect.gen(function* () {
    const context = yield* Layer.buildWithScope(
      createRoutes(options.password, () => {
        const address = bound.server.address()
        if (address === null || typeof address === "string") return []
        const host = address.family === "IPv6" ? `[${address.address}]` : address.address
        return ServerInfo.connectionURLs(`http://${host}:${address.port}`, options.hostname)
      }).pipe(Layer.provide(NodeHttpServer.layerHttpServices)),
      applicationScope,
    )
    if (options.service) {
      yield* installRestartContinuity(Context.get(context, SessionRestart.Service)).pipe(
        Effect.provideService(Scope.Scope, applicationScope),
      )
    }
    yield* Ref.set(application, Option.some(Context.get(context, HttpRouter.HttpRouter).asHttpEffect()))
    yield* status.ready
    return { address: bound.http.address, shutdown: Deferred.await(shutdown) }
  }).pipe(
    Effect.catchCause((cause) => {
      if (!options.service || Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
      return status
        .fail({
          message: "The background service could not start.",
          action: "Run `opencode service restart` after checking the service logs.",
        })
        .pipe(
          Effect.andThen(
            Scope.close(applicationScope, Exit.failCause(cause)).pipe(
              Effect.catchCause((cleanupCause) =>
                Effect.logError("failed to clean up background service boot", { cause: cleanupCause }),
              ),
            ),
          ),
          Effect.andThen(Effect.logError("background service boot failed", { cause })),
          Effect.andThen(Effect.never),
        )
    }),
  )
  if (!options.service) return yield* boot
  return yield* Effect.raceFirst(boot, Deferred.await(shutdown).pipe(Effect.andThen(Effect.interrupt)))
})

function listen(options: { readonly hostname: string; readonly port: Option.Option<number> }) {
  if (Option.isSome(options.port)) return bind(options.hostname, options.port.value)
  const next = (port: number): ReturnType<typeof bind> =>
    bind(options.hostname, port).pipe(
      Effect.catch((error) => (port < 65_535 && addressInUse(error) ? next(port + 1) : Effect.fail(error))),
    )
  return next(4096)
}

function bind(hostname: string, port: number) {
  return Effect.gen(function* () {
    const parentScope = yield* Scope.Scope
    const serverScope = yield* Scope.fork(parentScope)
    const server = createServer()
    return yield* Effect.gen(function* () {
      const http = yield* NodeHttpServer.make(() => server, { port, host: hostname })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()))
      return { http, server }
    }).pipe(
      Effect.provideService(Scope.Scope, serverScope),
      Effect.onError((cause) => Scope.close(serverScope, Exit.failCause(cause))),
    )
  })
}

function addressInUse(error: unknown) {
  if (typeof error !== "object" || error === null || !("cause" in error)) return false
  const cause = error.cause
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EADDRINUSE"
}

function dispatch(
  password: string,
  status: Status.Interface,
  application: Ref.Ref<Option.Option<App>>,
  shutdown: Deferred.Deferred<void>,
): App {
  const auth = ServerAuth.Config.of({ username: "opencode", password: Option.some(password) })
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    const lifecycle =
      request.method === "GET" && url.pathname === "/api/health"
        ? "health"
        : request.method === "POST" && url.pathname === "/api/service/stop"
          ? "stop"
          : undefined
    if (lifecycle !== undefined) {
      if (!(yield* authorizedRequest(request, auth))) return unauthorized()
      return yield* control(request, lifecycle, status, () => Deferred.doneUnsafe(shutdown, Effect.void))
    }
    const state = yield* status.current
    const app = yield* Ref.get(application)
    const ready = state.type === "ready" && Option.isSome(app)
    if ((!ready || !hasPtyConnectTicketURL(url)) && !(yield* authorizedRequest(request, auth))) return unauthorized()
    if (ready) return yield* app.value
    return unavailable(state)
  })
}

function unauthorized() {
  return HttpServerResponse.empty({
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Secure Area"' },
  })
}

const control = Effect.fnUntraced(function* (
  request: HttpServerRequest.HttpServerRequest,
  route: "health" | "stop",
  status: Status.Interface,
  stop: () => void,
) {
  if (route === "health") return yield* healthResponse(status)
  const body = yield* request.json.pipe(Effect.option)
  const input = Option.isSome(body) ? Schema.decodeUnknownOption(ServiceStatus.StopRequest)(body.value) : Option.none()
  if (Option.isNone(input)) return HttpServerResponse.jsonUnsafe({ code: "invalid_request" }, { status: 400 })
  const accepted = yield* status.requestStop(input.value)
  if (accepted) {
    const response = NodeHttpServerRequest.toServerResponse(request)
    yield* Effect.sync(() => {
      const complete = () => {
        response.off("finish", complete)
        response.off("close", complete)
        stop()
      }
      response.once("finish", complete)
      response.once("close", complete)
    })
  }
  return HttpServerResponse.jsonUnsafe({ accepted })
})

const healthResponse = Effect.fnUntraced(function* (status: Status.Interface) {
  const health = yield* status.health
  return HttpServerResponse.jsonUnsafe(health, {
    status: health.status.type === "ready" ? 200 : 503,
    headers:
      health.status.type === "starting" || health.status.type === "stopping" ? { "retry-after": "1" } : undefined,
  })
})

function unavailable(status: ServiceStatus.State) {
  if (status.type === "failed")
    return HttpServerResponse.jsonUnsafe(
      { code: "service_failed", message: status.message, action: status.action },
      { status: 503 },
    )
  return HttpServerResponse.jsonUnsafe(
    { code: status.type === "stopping" ? "service_stopping" : "service_starting" },
    { status: 503, headers: { "retry-after": "1" } },
  )
}

/**
 * The managed server owns restart continuity: it resumes Sessions the previous server suspended and
 * suspends its own active Sessions on graceful shutdown. Suspension runs while the drains are still
 * alive: connections close first, this finalizer runs next, and Session execution teardown follows.
 */
const installRestartContinuity = Effect.fnUntraced(function* (restart: SessionRestart.Interface) {
  yield* Effect.forkScoped(restart.resumeSuspendedSessions)
  // Registered after the fork so suspension observes still-running resumed drains during teardown.
  yield* Effect.addFinalizer(() => restart.suspendActiveSessions)
})

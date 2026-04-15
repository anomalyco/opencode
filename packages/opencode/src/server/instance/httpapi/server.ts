import { NodeHttpServer } from "@effect/platform-node"
import { Context, Effect, Exit, Layer, Scope } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createServer } from "node:http"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { memoMap } from "@/effect/run-service"
import { Flag } from "@/flag/flag"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { PermissionApi, PermissionLive } from "./permission"
import { QuestionApi, QuestionLive } from "./question"

export namespace ExperimentalHttpApiServer {
  export type Listener = {
    hostname: string
    port: number
    url: URL
    stop: () => Promise<void>
  }

  function text(input: string, status: number, headers?: Record<string, string>) {
    return HttpServerResponse.text(input, { status, headers })
  }

  function decode(input: string) {
    try {
      return decodeURIComponent(input)
    } catch {
      return input
    }
  }

  const auth = <E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    Effect.gen(function* () {
      if (!Flag.OPENCODE_SERVER_PASSWORD) return yield* effect

      const req = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(req.url, "http://localhost")
      const token = url.searchParams.get("auth_token")
      const header = token ? `Basic ${token}` : req.headers.authorization
      const expected = `Basic ${Buffer.from(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${Flag.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
      if (header === expected) return yield* effect

      return text("Unauthorized", 401, {
        "www-authenticate": 'Basic realm="opencode experimental httpapi"',
      })
    })

  const instance = <E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(req.url, "http://localhost")
      const raw = url.searchParams.get("directory") || req.headers["x-opencode-directory"] || process.cwd()
      const workspace = url.searchParams.get("workspace") || undefined
      const ctx = yield* Effect.promise(() =>
        Instance.provide({
          directory: Filesystem.resolve(decode(raw)),
          init: () => AppRuntime.runPromise(InstanceBootstrap),
          fn: () => Instance.current,
        }),
      )

      const next = workspace ? effect.pipe(Effect.provideService(WorkspaceRef, workspace)) : effect
      return yield* next.pipe(Effect.provideService(InstanceRef, ctx))
    })

  export async function listen(opts: { hostname: string; port: number }): Promise<Listener> {
    const scope = await Effect.runPromise(Scope.make())
    const serverLayer = NodeHttpServer.layer(createServer, { port: opts.port, host: opts.hostname })
    const routes = Layer.mergeAll(
      HttpApiBuilder.layer(QuestionApi, { openapiPath: "/experimental/httpapi/question/doc" }).pipe(
        Layer.provide(QuestionLive),
      ),
      HttpApiBuilder.layer(PermissionApi, { openapiPath: "/experimental/httpapi/permission/doc" }).pipe(
        Layer.provide(PermissionLive),
      ),
    )
    const live = Layer.mergeAll(
      serverLayer,
      HttpRouter.serve(routes, {
        disableListenLog: true,
        disableLogger: true,
        middleware: (effect) => auth(instance(effect)),
      }).pipe(Layer.provide(serverLayer)),
    )

    const ctx = await Effect.runPromise(Layer.buildWithMemoMap(live, memoMap, scope))
    const server = Context.get(ctx, HttpServer.HttpServer)

    if (server.address._tag !== "TcpAddress") {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      throw new Error("Experimental HttpApi server requires a TCP address")
    }

    const url = new URL("http://localhost")
    url.hostname = server.address.hostname
    url.port = String(server.address.port)

    return {
      hostname: server.address.hostname,
      port: server.address.port,
      url,
      stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    }
  }
}

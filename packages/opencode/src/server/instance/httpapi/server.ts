import { NodeHttpServer } from "@effect/platform-node"
import { Context, Effect, Exit, Layer, Scope, Schema } from "effect"
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

const Query = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  auth_token: Schema.optional(Schema.String),
})

const Headers = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  "x-opencode-directory": Schema.optional(Schema.String),
})

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

  const auth = HttpRouter.middleware()(
    Effect.gen(function* () {
      return (effect) =>
        Effect.gen(function* () {
          if (!Flag.OPENCODE_SERVER_PASSWORD) return yield* effect

          const query = yield* HttpServerRequest.schemaSearchParams(Query)
          const headers = yield* HttpServerRequest.schemaHeaders(Headers)
          const header = query.auth_token ? `Basic ${query.auth_token}` : headers.authorization
          const expected = `Basic ${Buffer.from(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${Flag.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
          if (header === expected) return yield* effect

          return text("Unauthorized", 401, {
            "www-authenticate": 'Basic realm="opencode experimental httpapi"',
          })
        })
    }),
  ).layer

  const instance = HttpRouter.middleware()(
    Effect.gen(function* () {
      return (effect) =>
        Effect.gen(function* () {
          const query = yield* HttpServerRequest.schemaSearchParams(Query)
          const headers = yield* HttpServerRequest.schemaHeaders(Headers)
          const raw = query.directory || headers["x-opencode-directory"] || process.cwd()
          const workspace = query.workspace || undefined
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
    }),
  ).layer

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
    ).pipe(Layer.provide(auth), Layer.provide(instance))
    const live = Layer.mergeAll(
      serverLayer,
      HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(Layer.provide(serverLayer)),
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

import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/unstable/http"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { Observability } from "@/effect"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util"
import { authorizationLayer } from "./auth"
import { ConfigApi, configHandlers } from "./config"
import { eventRoute } from "./event"
import { FileApi, fileHandlers } from "./file"
import { ExperimentalApi, experimentalHandlers } from "./experimental"
import { InstanceApi, instanceHandlers } from "./instance"
import { McpApi, mcpHandlers } from "./mcp"
import { PermissionApi, permissionHandlers } from "./permission"
import { ProjectApi, projectHandlers } from "./project"
import { ProviderApi, providerHandlers } from "./provider"
import { QuestionApi, questionHandlers } from "./question"
import { SessionApi, sessionHandlers } from "./session"
import { SyncApi, syncHandlers } from "./sync"
import { WorkspaceApi, workspaceHandlers } from "./workspace"
import { disposeMiddleware } from "./lifecycle"
import { memoMap } from "@opencode-ai/core/effect/memo-map"

const Query = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  auth_token: Schema.optional(Schema.String),
})

const Headers = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  "x-opencode-directory": Schema.optional(Schema.String),
})

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

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

export const routes = Layer.mergeAll(
  eventRoute,
  HttpApiBuilder.layer(ConfigApi).pipe(Layer.provide(configHandlers)),
  HttpApiBuilder.layer(ExperimentalApi).pipe(Layer.provide(experimentalHandlers)),
  HttpApiBuilder.layer(FileApi).pipe(Layer.provide(fileHandlers)),
  HttpApiBuilder.layer(InstanceApi).pipe(Layer.provide(instanceHandlers)),
  HttpApiBuilder.layer(McpApi).pipe(Layer.provide(mcpHandlers)),
  HttpApiBuilder.layer(ProjectApi).pipe(Layer.provide(projectHandlers)),
  HttpApiBuilder.layer(QuestionApi).pipe(Layer.provide(questionHandlers)),
  HttpApiBuilder.layer(PermissionApi).pipe(Layer.provide(permissionHandlers)),
  HttpApiBuilder.layer(ProviderApi).pipe(Layer.provide(providerHandlers)),
  HttpApiBuilder.layer(SessionApi).pipe(Layer.provide(sessionHandlers)),
  HttpApiBuilder.layer(SyncApi).pipe(Layer.provide(syncHandlers)),
  HttpApiBuilder.layer(WorkspaceApi).pipe(Layer.provide(workspaceHandlers)),
).pipe(
  Layer.provide(authorizationLayer),
  Layer.provide(instance),
  Layer.provide(HttpServer.layerServices),
  Layer.provideMerge(Observability.layer),
)

export const webHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    memoMap,
    middleware: disposeMiddleware,
  }),
)

export * as ExperimentalHttpApiServer from "./server"

import { Effect, Layer, Redacted, Schema } from "effect"
import { HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/unstable/http"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { Observability } from "@/effect"
import { Flag } from "@/flag/flag"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util"
import { ConfigApi, configHandlers } from "./config"
import { PermissionApi, permissionHandlers } from "./permission"
import { ProjectApi, projectHandlers } from "./project"
import { ProviderApi, providerHandlers } from "./provider"
import { QuestionApi, questionHandlers } from "./question"
import { memoMap } from "@/effect/memo-map"

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

class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

class Authorization extends HttpApiMiddleware.Service<Authorization>()("@opencode/ExperimentalHttpApiAuthorization", {
  error: Unauthorized,
  security: {
    basic: HttpApiSecurity.basic,
  },
}) {}

const normalize = HttpRouter.middleware()(
  Effect.gen(function* () {
    return (effect) =>
      Effect.gen(function* () {
        const query = yield* HttpServerRequest.schemaSearchParams(Query)
        if (!query.auth_token) return yield* effect
        const req = yield* HttpServerRequest.HttpServerRequest
        const next = req.modify({
          headers: {
            ...req.headers,
            authorization: `Basic ${query.auth_token}`,
          },
        })
        return yield* effect.pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, next))
      })
  }),
).layer

const auth = Layer.succeed(
  Authorization,
  Authorization.of({
    basic: (effect, { credential }) =>
      Effect.gen(function* () {
        if (!Flag.OPENCODE_SERVER_PASSWORD) return yield* effect

        const user = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
        if (credential.username !== user) {
          return yield* new Unauthorized({ message: "Unauthorized" })
        }
        if (Redacted.value(credential.password) !== Flag.OPENCODE_SERVER_PASSWORD) {
          return yield* new Unauthorized({ message: "Unauthorized" })
        }
        return yield* effect
      }),
  }),
)

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

const QuestionSecured = QuestionApi.middleware(Authorization)
const PermissionSecured = PermissionApi.middleware(Authorization)
const ProjectSecured = ProjectApi.middleware(Authorization)
const ProviderSecured = ProviderApi.middleware(Authorization)
const ConfigSecured = ConfigApi.middleware(Authorization)

export const routes = Layer.mergeAll(
  HttpApiBuilder.layer(ConfigSecured).pipe(Layer.provide(configHandlers)),
  HttpApiBuilder.layer(ProjectSecured).pipe(Layer.provide(projectHandlers)),
  HttpApiBuilder.layer(QuestionSecured).pipe(Layer.provide(questionHandlers)),
  HttpApiBuilder.layer(PermissionSecured).pipe(Layer.provide(permissionHandlers)),
  HttpApiBuilder.layer(ProviderSecured).pipe(Layer.provide(providerHandlers)),
).pipe(
  Layer.provide(auth),
  Layer.provide(normalize),
  Layer.provide(instance),
  Layer.provide(HttpServer.layerServices),
  Layer.provideMerge(Observability.layer),
)

export const webHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    memoMap,
  }),
)

export * as ExperimentalHttpApiServer from "./server"

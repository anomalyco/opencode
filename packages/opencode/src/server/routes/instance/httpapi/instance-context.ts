import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

const Query = Schema.Struct({
  directory: Schema.optionalKey(Schema.String),
  workspace: Schema.optionalKey(Schema.String),
  auth_token: Schema.optionalKey(Schema.String),
})

const Headers = Schema.Struct({
  authorization: Schema.optionalKey(Schema.String),
  "x-opencode-directory": Schema.optionalKey(Schema.String),
})

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<InstanceContextMiddleware>()(
  "@opencode/ExperimentalHttpApiInstanceContext",
) {}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function currentDirectory() {
  try {
    return Instance.directory
  } catch {
    return process.cwd()
  }
}

function provideInstanceContext<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const query = yield* HttpServerRequest.schemaSearchParams(Query).pipe(Effect.orDie)
    const headers = yield* HttpServerRequest.schemaHeaders(Headers).pipe(Effect.orDie)
    const raw = query.directory || headers["x-opencode-directory"] || currentDirectory()
    const ctx = yield* Effect.promise(() =>
      Instance.provide({
        directory: Filesystem.resolve(decode(raw)),
        init: () => AppRuntime.runPromise(InstanceBootstrap),
        fn: () => Instance.current,
      }),
    )

    return yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.provideService(WorkspaceRef, query.workspace),
    )
  })
}

export const instanceContextLayer = Layer.succeed(
  InstanceContextMiddleware,
  InstanceContextMiddleware.of((effect) => provideInstanceContext(effect)),
)

export const instanceRouterLayer = HttpRouter.middleware()(Effect.succeed((effect) => provideInstanceContext(effect))).layer

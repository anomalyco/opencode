import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import type { InstanceContext } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { WorkspaceRouteContext } from "./workspace-routing"

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<
  InstanceContextMiddleware,
  {
    requires: WorkspaceRouteContext
  }
>()("@opencode/ExperimentalHttpApiInstanceContext") {}

function decode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function makeInstanceContext(directory: string): Effect.Effect<InstanceContext> {
  return Effect.promise(() =>
    Instance.provide({
      directory: Filesystem.resolve(decode(directory)),
      init: () => AppRuntime.runPromise(InstanceBootstrap),
      fn: () => Instance.current,
    }),
  )
}

function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    const ctx = yield* makeInstanceContext(route.directory)
    return yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.provideService(WorkspaceRef, route.workspaceID),
    )
  })
}

export const instanceContextLayer = Layer.succeed(
  InstanceContextMiddleware,
  InstanceContextMiddleware.of((effect) => provideInstanceContext(effect)),
)

export const instanceRouterMiddleware = HttpRouter.middleware()((effect) => provideInstanceContext(effect))

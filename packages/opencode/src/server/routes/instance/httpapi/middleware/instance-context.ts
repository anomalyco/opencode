import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceStore } from "@/project/instance-store"
import { Effect, Layer } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { notFound } from "../errors"
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

function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
  fs: FSUtil.Interface,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    const directory = decode(route.directory)
    // Validate the requested directory before loading: load may return a cached context or resolve a missing child
    // through an ancestor repository.
    if (!(yield* fs.isDir(directory))) {
      return HttpServerResponse.jsonUnsafe(notFound(`Project directory not found: ${directory}`), { status: 404 })
    }

    const ctx = yield* store.load({ directory })
    return yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.provideService(WorkspaceRef, route.workspaceID),
    )
  })
}

export const instanceContextLayer = Layer.effect(
  InstanceContextMiddleware,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const fs = yield* FSUtil.Service
    return InstanceContextMiddleware.of((effect) => provideInstanceContext(effect, store, fs))
  }),
)

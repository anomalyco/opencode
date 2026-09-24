import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Workspace } from "@/control-plane/workspace"
import { Effect, Layer } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
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

export function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
  workspace: Workspace.Interface,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    const ctx = yield* store.load({ directory: decode(route.directory) })
    // Loading the project initializes its plugins and registers its adapters.
    yield* workspace.resumeWorkspaceSyncing(ctx.project.id)
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
    const workspace = yield* Workspace.Service
    return InstanceContextMiddleware.of((effect) => provideInstanceContext(effect, store, workspace))
  }),
)

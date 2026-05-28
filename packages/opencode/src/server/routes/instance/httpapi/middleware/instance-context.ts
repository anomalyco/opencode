import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Effect, Layer, Scope } from "effect"
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

function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    const ctx = yield* store.load({ directory: decode(route.directory) })
    return yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.provideService(WorkspaceRef, route.workspaceID),
    )
  })
}

function canUseLightweightInstanceContext(input: { readonly group: string; readonly endpoint: string }) {
  if (input.group === "session") {
    return ["list", "get", "children", "todo", "diff", "messages", "message"].includes(input.endpoint)
  }
  if (input.group === "v2.session") {
    return input.endpoint === "sessions" || input.endpoint === "context"
  }
  return false
}

function provideLightweightInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
  project: Project.Interface,
  scope: Scope.Scope,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    const directory = decode(route.directory)
    const result = yield* project.fromDirectory(directory)
    const ctx = {
      directory,
      worktree: result.sandbox,
      project: result.project,
    }

    // Warm the full instance in the background so later write/execute routes
    // have plugin, MCP, file watcher, and skill state initialized.
    yield* store.load({ directory, worktree: result.sandbox, project: result.project }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("background instance load failed", { cause, directory })),
      Effect.forkIn(scope),
      Effect.asVoid,
    )

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
    const project = yield* Project.Service
    const scope = yield* Scope.Scope
    return InstanceContextMiddleware.of((effect, options) => {
      if (canUseLightweightInstanceContext({ group: options.group.identifier, endpoint: options.endpoint.name })) {
        return provideLightweightInstanceContext(effect, store, project, scope)
      }
      return provideInstanceContext(effect, store)
    })
  }),
)

export const instanceRouterMiddleware = HttpRouter.middleware()(
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    return (effect) => provideInstanceContext(effect, store)
  }),
)

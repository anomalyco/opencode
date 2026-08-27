export * as SessionEngineBindings from "./engine-bindings.js"

import { Context, Effect, Layer, Scope } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import type { SessionEngine } from "../location-services.js"
import { SessionSchema } from "./schema.js"

/**
 * Process-local map from Session ID to a values-constructed engine graph.
 * Execution resolves a bound context before falling back to the Session's
 * Location graph, so tier-2 sessions drain against caller-supplied
 * capabilities while every other session is untouched.
 */
export interface Interface {
  /** Bind until the enclosing scope closes. Rebinding the same ID replaces the previous binding. */
  readonly bind: (
    id: SessionSchema.ID,
    context: Context.Context<SessionEngine>,
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly get: (id: SessionSchema.ID) => Context.Context<SessionEngine> | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionEngineBindings") {}

export const layer = Layer.sync(Service, () => {
  // Entries wrap the context so release identity is per bind call: binding the
  // same context twice from different scopes must not let the first release
  // tear down the survivor's entry.
  const map = new Map<SessionSchema.ID, { readonly context: Context.Context<SessionEngine> }>()
  return Service.of({
    bind: (id, context) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const entry = { context }
          map.set(id, entry)
          return entry
        }),
        (entry) =>
          Effect.sync(() => {
            // A later rebind owns the entry now; do not tear it down.
            if (map.get(id) === entry) map.delete(id)
          }),
      ).pipe(Effect.asVoid),
    get: (id) => map.get(id)?.context,
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

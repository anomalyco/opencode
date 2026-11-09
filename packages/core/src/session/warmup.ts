export * as SessionWarmup from "./warmup.js"

import { placesMarkers, type LLMRequest } from "@opencode/ai/effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import type { SessionSchema } from "./schema.js"

/**
 * Tells session warming about the step requests the runner sends. Only Sessions that warming watches are recorded, and
 * only until it forgets them.
 */
export interface Interface {
  readonly watch: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly forget: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Called by the runner with each step request it sends. */
  readonly record: (sessionID: SessionSchema.ID, request: LLMRequest) => Effect.Effect<void>
  /**
   * Whether the Session's latest step request wrote its prompt cache at explicit markers. False on routes that cache
   * implicitly, and undefined until a request is recorded.
   */
  readonly marked: (sessionID: SessionSchema.ID) => Effect.Effect<boolean | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionWarmup") {}

export const layer = Layer.sync(Service, () => {
  const marked = new Map<SessionSchema.ID, boolean | undefined>()
  return Service.of({
    watch: (sessionID) =>
      Effect.sync(() => {
        if (!marked.has(sessionID)) marked.set(sessionID, undefined)
      }),
    forget: (sessionID) =>
      Effect.sync(() => {
        marked.delete(sessionID)
      }),
    record: (sessionID, request) =>
      Effect.sync(() => {
        if (marked.has(sessionID)) marked.set(sessionID, placesMarkers(request))
      }),
    marked: (sessionID) => Effect.sync(() => marked.get(sessionID)),
  })
})

export const node = makeLocationNode({ service: Service, layer, deps: [] })

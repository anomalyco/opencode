export * as SessionWarmup from "./warmup.js"

import type { LLMRequest } from "@opencode/ai/effect"
import type { StreamOptions } from "@opencode/ai/route"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import type { SessionSchema } from "./schema.js"

/** A step request as it was sent, so a keep-alive can resend the same prompt. */
export interface Sent {
  readonly request: LLMRequest
  readonly options: StreamOptions
}

/**
 * The latest step request of each watched Session. A request holds the whole conversation, so only Sessions that
 * warming has armed are recorded, and only until warming forgets them.
 */
export interface Interface {
  readonly watch: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly forget: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly record: (sessionID: SessionSchema.ID, request: LLMRequest, options: StreamOptions) => Effect.Effect<void>
  readonly latest: (sessionID: SessionSchema.ID) => Effect.Effect<Sent | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionWarmup") {}

export const layer = Layer.sync(Service, () => {
  const sent = new Map<SessionSchema.ID, Sent | undefined>()
  return Service.of({
    watch: (sessionID) =>
      Effect.sync(() => {
        if (!sent.has(sessionID)) sent.set(sessionID, undefined)
      }),
    forget: (sessionID) =>
      Effect.sync(() => {
        sent.delete(sessionID)
      }),
    record: (sessionID, request, options) =>
      Effect.sync(() => {
        if (!sent.has(sessionID)) return
        // The step's WebSocket is the Session's stateful channel; a keep-alive goes over HTTP like any one-off request.
        sent.set(sessionID, { request, options: options.http ? { http: options.http } : {} })
      }),
    latest: (sessionID) => Effect.sync(() => sent.get(sessionID)),
  })
})

export const node = makeLocationNode({ service: Service, layer, deps: [] })

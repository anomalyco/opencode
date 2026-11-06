export * as SessionContextLimit from "./context-limit.js"

import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KV } from "../kv.js"
import { SessionSchema } from "./schema.js"

export class Service extends Context.Service<
  Service,
  {
    readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<number | null>
    readonly set: (sessionID: SessionSchema.ID, tokens: number | null) => Effect.Effect<void>
  }
>()("@opencode/SessionContextLimit") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    return Service.of({
      get: (sessionID) =>
        kv
          .get(`session.context-limit.${sessionID}`)
          .pipe(Effect.map((value) => Schema.decodeUnknownSync(Schema.NullOr(Schema.Number))(value ?? null))),
      set: (sessionID, tokens) =>
        tokens === null
          ? kv.remove(`session.context-limit.${sessionID}`)
          : kv.set(`session.context-limit.${sessionID}`, tokens),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })

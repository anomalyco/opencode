export * as ServerPairing from "./pairing"

import { Cache, Context, Duration, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { randomBytes } from "node:crypto"

const TTL = Duration.minutes(5)

export interface Interface {
  readonly issue: () => Effect.Effect<{ readonly code: string; readonly expires_in: number }>
  readonly consume: (code: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerPairing") {}

// Codes are inserted via Cache.set and removed via invalidateWhen, so the lookup never runs.
const noLookup = () => Effect.die(new Error("ServerPairing cache must be used via set/invalidateWhen, never get"))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cache = yield* Cache.make<string, true>({ capacity: 1_000, lookup: noLookup, timeToLive: TTL })
    return Service.of({
      issue: Effect.fn("ServerPairing.issue")(function* () {
        const code = randomBytes(16).toString("base64url")
        yield* Cache.set(cache, code, true)
        return { code, expires_in: Duration.toSeconds(TTL) }
      }),
      consume: Effect.fn("ServerPairing.consume")(function* (code) {
        return yield* Cache.invalidateWhen(cache, code, () => true)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

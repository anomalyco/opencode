export * as PushOptions from "./options.js"

import { Effect } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { Config } from "../config.js"
import { Flag } from "../flag.js"
import { Location } from "../location.js"
import { LocationServiceMap } from "../location-service-map.js"

export const defaultRelay = "https://opencode-notify-relay.anomalyco.workers.dev"

export interface Options {
  readonly enabled: boolean
  readonly relays: readonly string[]
}

/** Reads the `push` flag and relays from the server's base configuration. */
export const make = Effect.gen(function* () {
  const global = yield* Global.Service
  const locations = yield* LocationServiceMap.Service
  return Effect.gen(function* () {
    const enabled = yield* Flag.enabled("push")
    const config = yield* Config.Service
    const entries = yield* config.entries()
    const extra = Config.latest(entries, "push")?.relays ?? []
    const relays = [defaultRelay, ...extra.map((relay) => URL.parse(relay)?.origin ?? relay)]
    return { enabled, relays } satisfies Options
  }).pipe(
    Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))),
    Effect.orElseSucceed((): Options => ({ enabled: false, relays: [defaultRelay] })),
  )
})

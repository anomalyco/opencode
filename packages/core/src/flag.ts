export * as Flag from "./flag.js"

import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { ConfigFlag } from "@opencode/schema/config/flag"
import type { Entry } from "@opencode/schema/config"
import { App } from "./app.js"
import { Config } from "./config.js"
import { FlagResolve } from "./flag/resolve.js"

export type Key = ConfigFlag.Key

export type State = FlagResolve.State

export interface Interface {
  readonly resolve: (entries: readonly Entry[]) => Record<Key, State>
  readonly all: Effect.Effect<Record<Key, State>>
  readonly enabled: (key: Key) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Flag") {}

export const Overrides = FlagResolve.Overrides

export const resolve = FlagResolve.resolve

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const app = yield* App.Service
    const config = yield* Config.Service
    const overrides = yield* Overrides
    const resolveEntries = (entries: readonly Entry[]) => resolve({ entries, channel: app.channel, overrides })
    const all = Effect.gen(function* () {
      return resolveEntries(yield* config.entries())
    })
    return Service.of({
      resolve: resolveEntries,
      all,
      enabled: (key) => Effect.map(all, (flags) => flags[key].enabled),
    })
  }),
)

export const testLayer = (
  entries: Entry[] = [],
  options?: { readonly app?: Partial<App.Info>; readonly overrides?: string },
) =>
  Layer.fresh(layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(App.layer(options?.app), Config.testLayer(entries), Layer.succeed(Overrides, options?.overrides)),
    ),
  )

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [App.node, Config.node],
})

/** Every flag with its value and where it came from, read from the location's Config on each call. */
export const all = Service.use((flags) => flags.all)

export const enabled = (key: Key) => Service.use((flags) => flags.enabled(key))

export * as Flag from "./flag.js"

import { Context, Effect, Layer, PubSub, Record, Stream } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { ConfigFlag } from "@opencode/schema/config/flag"
import { Event, type Entry } from "@opencode/schema/config"
import { Bus } from "./bus.js"
import { App } from "./app.js"
import { Config } from "./config.js"
import { FlagResolve } from "./flag/resolve.js"

export type Key = ConfigFlag.Key

export type State = FlagResolve.State

export interface Interface {
  readonly current: () => Record<Key, State>
  readonly changes: () => Stream.Stream<ReadonlySet<Key>>
  readonly all: Effect.Effect<Record<Key, State>>
  readonly enabled: (key: Key) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Flag") {}

export const Overrides = FlagResolve.Overrides

export const resolve = FlagResolve.resolve

const make = Effect.fnUntraced(function* (updates: Stream.Stream<unknown>) {
  const app = yield* App.Service
  const config = yield* Config.Service
  const overrides = yield* Overrides
  const changes = yield* PubSub.unbounded<ReadonlySet<Key>>()
  yield* Effect.addFinalizer(() => PubSub.shutdown(changes))
  const resolveEntries = (entries: readonly Entry[]) => resolve({ entries, channel: app.channel, overrides })
  let current = resolveEntries(yield* config.entries())
  const refresh = Effect.gen(function* () {
    const next = resolveEntries(yield* config.entries())
    const changed = new Set(
      Record.keys(ConfigFlag.registry).filter((key) => current[key].enabled !== next[key].enabled),
    )
    current = next
    if (changed.size > 0) yield* PubSub.publish(changes, changed)
  })
  yield* updates.pipe(
    Stream.runForEach(() => refresh),
    Effect.forkScoped({ startImmediately: true }),
  )
  // Close the gap between the initial read and subscribing.
  yield* refresh
  return Service.of({
    current: () => current,
    changes: () => Stream.fromPubSub(changes),
    all: Effect.map(config.entries(), resolveEntries),
    enabled: (key) => Effect.map(config.entries(), (entries) => resolveEntries(entries)[key].enabled),
  })
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return yield* make(bus.subscribe(Event.Updated))
  }),
)

/** Static flag fixture. Use Flag.node with Config.testLayer to exercise config updates. */
export const testLayer = (
  entries: Entry[] = [],
  options?: { readonly app?: Partial<App.Info>; readonly overrides?: string },
) =>
  Layer.effect(Service, make(Stream.never)).pipe(
    Layer.provideMerge(
      Layer.mergeAll(App.layer(options?.app), Config.testLayer(entries), Layer.succeed(Overrides, options?.overrides)),
    ),
  )

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [App.node, Config.node, Bus.node],
})

/** Every flag with its value and where it came from. */
export const all = Service.use((flags) => flags.all)

export const enabled = (key: Key) => Service.use((flags) => flags.enabled(key))

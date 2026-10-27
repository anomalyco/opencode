export * as RuntimeStats from "./runtime-stats.js"

import { Context, Effect, Layer, Option } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

/**
 * Pull-based sizes of long-lived structures, read by `GET /api/experimental/debug/runtime`. A
 * structure registers a closure over sizes it already holds; nothing runs until a client reads.
 * Gauges must be O(entries) reads at most, never IO.
 */
export type Gauge = () => number | Readonly<Record<string, number>>

export interface Interface {
  /** Every gauge's current value. Gauges with several instances also report `<name>.instances`. */
  readonly read: () => Record<string, number>
  readonly add: (name: string, gauge: Gauge) => () => void
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RuntimeStats") {}

export const layer = Layer.sync(Service, () => {
  const gauges = new Map<string, Set<Gauge>>()
  return Service.of({
    add: (name, gauge) => {
      const set = gauges.get(name) ?? new Set()
      gauges.set(name, set.add(gauge))
      return () => {
        set.delete(gauge)
        if (set.size === 0 && gauges.get(name) === set) gauges.delete(name)
      }
    },
    read: () => {
      const out: Record<string, number> = {}
      const add = (key: string, n: number) => (out[key] = (out[key] ?? 0) + n)
      for (const [name, set] of [...gauges].sort(([a], [b]) => a.localeCompare(b))) {
        if (set.size > 1) out[`${name}.instances`] = set.size
        for (const gauge of set) {
          const value = safe(gauge)
          if (typeof value === "number") add(name, value)
          else for (const [key, n] of Object.entries(value)) add(`${name}.${key}`, n)
        }
      }
      return out
    },
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

/**
 * Register a gauge for the current scope. Same-named gauges (one per Location, say) are summed.
 * Does nothing where the service is not provided, such as a structure built alone in a test.
 */
export const gauge = (name: string, read: Gauge) =>
  Effect.serviceOption(Service).pipe(
    Effect.flatMap((stats) =>
      Option.isSome(stats)
        ? Effect.acquireRelease(
            Effect.sync(() => stats.value.add(name, read)),
            (remove) => Effect.sync(remove),
          )
        : Effect.void,
    ),
    Effect.asVoid,
  )

function safe(gauge: Gauge) {
  try {
    return gauge()
  } catch {
    // JSON has no NaN; -1 marks a gauge that threw.
    return -1
  }
}

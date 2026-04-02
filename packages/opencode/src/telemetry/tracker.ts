import { Log } from "@/util/log"
import { Effect } from "effect"

const log = Log.create({ service: "tracker" })
const active = new Map<string, number>()

export function track<T>(label: string, promise: Promise<T>): Promise<T> {
  const count = (active.get(label) ?? 0) + 1
  active.set(label, count)
  return promise.finally(() => {
    const next = (active.get(label) ?? 1) - 1
    if (next <= 0) active.delete(label)
    else active.set(label, next)
  })
}

export function trackEffect<A, E, R>(label: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  const count = (active.get(label) ?? 0) + 1
  active.set(label, count)
  return effect.pipe(
    Effect.ensuring(
      Effect.sync(() => {
        const next = (active.get(label) ?? 1) - 1
        if (next <= 0) active.delete(label)
        else active.set(label, next)
      }),
    ),
  )
}

export function fire(label: string, promise: Promise<unknown>) {
  const count = (active.get(label) ?? 0) + 1
  active.set(label, count)
  promise
    .catch((e) => {
      log.error("fire-and-forget rejected", { label, error: e instanceof Error ? e.message : String(e) })
    })
    .finally(() => {
      const next = (active.get(label) ?? 1) - 1
      if (next <= 0) active.delete(label)
      else active.set(label, next)
    })
}

export function gauges(): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [k, v] of active) {
    result["track_" + k] = v
  }
  return result
}

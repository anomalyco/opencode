import { LocationServiceMap } from "@opencode/core/location-service-map"
import { RuntimeStats } from "@opencode/core/runtime-stats"
import { Effect, Option, RcMap } from "effect"

const OBJECT_TYPES = 25

/** `debug.runtime` in the `server.experimental` group. Counters only unless `heap` asks for object counts. */
export const makeDebugRuntime = Effect.gen(function* () {
  const stats = yield* RuntimeStats.Service
  return Effect.fn("server.debug.runtime")(function* (query: { readonly heap?: boolean }) {
    const locations = yield* Effect.serviceOption(LocationServiceMap.Service)
    const { rss, heapTotal, heapUsed, external, arrayBuffers } = process.memoryUsage()
    return {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      memory: { rss, heapTotal, heapUsed, external, arrayBuffers },
      ...(query.heap ? { objectTypes: yield* objectTypes } : {}),
      locations: Option.isSome(locations) ? Array.from(yield* RcMap.keys(locations.value.rcMap)).length : 0,
      gauges: stats.read(),
    }
  })
})

// Walks the heap without serializing it: about 10 ns per object, where a snapshot takes about 1 s per million.
const objectTypes = Effect.tryPromise(() => import("bun:jsc")).pipe(
  Effect.map((jsc) =>
    Object.fromEntries(
      Object.entries(jsc.heapStats().objectTypeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, OBJECT_TYPES),
    ),
  ),
  Effect.orElseSucceed(() => ({})),
)

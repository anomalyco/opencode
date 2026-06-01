import { Context, Effect, Layer } from "effect"

import { Heartbeat } from "./heartbeat"
import { Curation } from "./curation"
import { HealthCheck } from "./health-check"
import { MemoryStore } from "./memory-store"
import { Decay } from "./decay"
import { PatternExtractor } from "./pattern-extractor"

// ── Re-exports ──────────────────────────────────────────────────────────────
export { MemoryID, MemoryType, MemoryLayer, MemoryInfo, MemoryRelation } from "./schema"
export { memoryTable } from "./memory.sql"
export { curationLogTable } from "./curation-log.sql"
export { MemoryStore } from "./memory-store"
export { Decay } from "./decay"
export { SelfImprovementTools } from "./tools"

export * as Heartbeat from "./heartbeat"
export * as Curation from "./curation"
export * as HealthCheck from "./health-check"
export * as PatternExtractor from "./pattern-extractor"
export * as CurationBusEvents from "./curation-bus-events"
export * as MemoryBusEvents from "./memory-bus-events"

// ── Boot service — triggers all fibers to start, registers cleanup ──────────
export class Boot extends Context.Service<Boot, {}>()("@opencode/SelfImprovement/Boot") {}

const bootLayer = Layer.effect(
  Boot,
  Effect.gen(function* () {
    const heartbeat = yield* Heartbeat.Service
    const curation = yield* Curation.Service
    const health = yield* HealthCheck.Service

    // Register finalizers FIRST so stop() runs on scope close
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        [heartbeat.stop(), curation.stop(), health.stop()],
        (eff) => eff.pipe(Effect.ignore),
      ),
    )

    // Then start fibers
    yield* heartbeat.start()
    yield* curation.start()
    yield* health.start()

    return Boot.of({})
  }),
)

// ── Merged default layer ────────────────────────────────────────────────────
export const defaultLayer = Layer.mergeAll(
  MemoryStore.defaultLayer,
  Decay.defaultLayer,
  PatternExtractor.defaultLayer,
  Heartbeat.defaultLayer,
  Curation.defaultLayer,
  HealthCheck.defaultLayer,
  bootLayer.pipe(
    Layer.provide(Heartbeat.defaultLayer),
    Layer.provide(Curation.defaultLayer),
    Layer.provide(HealthCheck.defaultLayer),
  ),
)

export * as SelfImprovement from "."

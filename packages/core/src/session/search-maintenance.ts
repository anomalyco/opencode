export * as SessionSearchMaintenance from "./search-maintenance.js"

import { Cause, Clock, Context, Effect, Latch, Layer, Option, RcMap, Schema, Stream } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Flag } from "../flag.js"
import { LocationServiceMap } from "../location-service-map.js"
import { SessionEvent } from "./event.js"
import { SessionSearchIndex } from "./search-index.js"

export interface Interface {
  /**
   * Keeps the search index in step with `experimental.sqlite_fts`: builds it, backfills existing history in small
   * transactions while no Session is writing, and indexes changes as Sessions write. Runs until interrupted, so fork
   * it.
   */
  readonly run: Effect.Effect<never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSearchMaintenance") {}

const isSessionEvent = Schema.is(SessionEvent.Durable)

/** Work this long before re-reading config, so turning the flag off stops a backfill promptly. */
const SLICE = 1_000
/** Pause between transactions so requests waiting on the JS thread or the write lock get a turn. */
const PAUSE = "5 millis"
/** Re-read config at least this often, so a location that enables the index starts it without activity. */
const IDLE = "30 seconds"
/** After activity, wait this long so a streaming reply settles into one batch. */
const SETTLE = "1 second"
const SLOW_BATCH = 250
/**
 * The backfill runs only once no Session has written for this long, so its transactions, which hold the JS thread
 * and the write lock, never land while a reply streams. Changes to the queue are drained either way.
 */
const QUIET = 5_000

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const bus = yield* Bus.Service
    const locations = yield* LocationServiceMap.Service
    const doorbell = yield* Latch.make()
    const state = {
      active: false,
      unsupported: false,
      backfilled: false,
      backfill: undefined as { started: number; batches: number; slowest: number } | undefined,
      activity: 0,
    }

    yield* bus.subscribe().pipe(
      Stream.filter(isSessionEvent),
      Stream.runForEach(() =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) => {
            state.activity = now
            return state.active ? doorbell.open : Effect.void
          }),
        ),
      ),
      Effect.forkScoped,
    )

    // Config is per location, but the index covers the whole database, so it is maintained while any loaded
    // location enables it. Off, like any flag, only stops new work: an index already built stays as it is.
    const enabled = Effect.gen(function* () {
      const flags = yield* Effect.forEach(Array.from(yield* RcMap.keys(locations.rcMap)), (ref) =>
        Effect.gen(function* () {
          const context = yield* locations.contextEffectOption(ref)
          if (Option.isNone(context)) return false
          return yield* Context.get(context.value, Flag.Service).enabled("sqlite_fts")
        }).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => false),
        ),
      )
      return flags.includes(true)
    })

    /**
     * Runs one transaction. Returns how many milliseconds to wait before the next one, or undefined when only new
     * changes are left.
     */
    const batch = Effect.gen(function* () {
      if ((yield* SessionSearchIndex.processBatch(db)) > 0) return 0
      if (state.backfilled) return undefined
      const now = yield* Clock.currentTimeMillis
      if (now - state.activity < QUIET) return state.activity + QUIET - now
      const result = yield* SessionSearchIndex.backfillBatch(db)
      const elapsed = (yield* Clock.currentTimeMillis) - now
      if (result.done && state.backfill === undefined) {
        state.backfilled = true
        return undefined
      }
      const backfill = state.backfill ?? { started: now, batches: 0, slowest: 0 }
      state.backfill = backfill
      backfill.batches++
      backfill.slowest = Math.max(backfill.slowest, elapsed)
      if (elapsed > SLOW_BATCH) yield* Effect.logWarning("session search backfill batch was slow", { ms: elapsed })
      if (!result.done) return 0
      state.backfilled = true
      state.backfill = undefined
      const status = yield* SessionSearchIndex.status(db)
      yield* Effect.logInfo("session search backfill finished", {
        ms: now + elapsed - backfill.started,
        batches: backfill.batches,
        slowestBatchMs: backfill.slowest,
        documents: status.documents,
      })
      return undefined
    })

    /** Returns how many milliseconds to wait before the next tick, or undefined to wait for new changes. */
    const tick = Effect.gen(function* () {
      state.active = yield* enabled
      if (!state.active || state.unsupported) return undefined
      const capability = yield* SessionSearchIndex.ensure(db)
      if (!capability.supported) {
        state.unsupported = true
        yield* Effect.logWarning("session search index is not supported by this SQLite", {
          reason: capability.reason,
        })
        return undefined
      }
      if (capability.rebuilt) {
        state.backfilled = false
        state.backfill = undefined
        yield* Effect.logInfo("session search backfill started")
      }
      const start = yield* Clock.currentTimeMillis
      while ((yield* Clock.currentTimeMillis) - start < SLICE) {
        const wait = yield* batch
        if (wait !== 0) return wait
        yield* Effect.sleep(PAUSE)
      }
      return 0
    })

    const loop = Effect.gen(function* () {
      yield* doorbell.close
      const wait = yield* tick.pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          (cause) => Effect.logError("session search maintenance failed", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (wait !== undefined) return yield* Effect.sleep(wait === 0 ? PAUSE : wait)
      yield* doorbell.await.pipe(Effect.timeoutOption(IDLE))
      yield* Effect.sleep(SETTLE)
    })

    return Service.of({ run: Effect.forever(loop) })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Bus.node, Database.node, LocationServiceMap.node],
})

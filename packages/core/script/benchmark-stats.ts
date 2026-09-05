import { parseArgs } from "util"
import { setTimeout } from "node:timers/promises"
import { Effect, Layer } from "effect"
import { Database } from "../src/database/database"
import { EffectDrizzleSqlite } from "../src/database/drizzle"
import { sqliteLayer } from "../src/database/sqlite.bun"
import { SessionStats } from "../src/session/stats"

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    database: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    timezone: { type: "string", default: "UTC" },
    runs: { type: "string", default: "7" },
    "expected-digest": { type: "string" },
  },
})
if (!args.values.database || !args.values.from || !args.values.to) {
  throw new Error("Pass --database <snapshot.db> --from <epoch-ms> --to <epoch-ms>. Never use a live database.")
}
const runs = Number(args.values.runs)
const from = Number(args.values.from)
const to = Number(args.values.to)
if (!Number.isInteger(runs) || runs < 1 || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
  throw new Error("Invalid runs or date range")
}

// Bypass migrations and open read-only: this measures the real stats implementation,
// not server startup, schema setup, or a separate SQL reimplementation.
const database = Layer.effect(
  Database.Service,
  Effect.map(EffectDrizzleSqlite.makeWithDefaults(), (db) => ({ db })),
).pipe(
  Layer.provide(
    sqliteLayer({ filename: args.values.database, readonly: true, readwrite: false, create: false, disableWAL: true }),
  ),
)

await Effect.runPromise(
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db.run("PRAGMA cache_size = -64000")
    const samples = yield* Effect.forEach(
      Array.from({ length: runs + 1 }),
      (_, index) =>
        Effect.gen(function* () {
          const delay = { last: performance.now(), max: 0 }
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              setInterval(() => {
                const now = performance.now()
                delay.max = Math.max(delay.max, now - delay.last)
                delay.last = now
              }, 1),
            ),
            (timer) => Effect.sync(() => clearInterval(timer)),
          )
          const start = performance.now()
          const result = yield* SessionStats.get({ from, to, timezone: args.values.timezone, tools: "none" })
          const ms = performance.now() - start
          // Let a timer delayed by synchronous SQLite work report before stopping it.
          yield* Effect.promise(() => setTimeout(0))
          const digest = Bun.hash(JSON.stringify(result)).toString()
          if (args.values["expected-digest"] && digest !== args.values["expected-digest"])
            throw new Error("Statistics changed")
          // Only a digest is printed: model names and other private data stay local.
          console.log(
            JSON.stringify({
              run: index,
              warmup: index === 0,
              ms,
              eventLoopDelayMs: delay.max,
              digest,
            }),
          )
          return { ms, eventLoopDelayMs: delay.max }
        }).pipe(Effect.scoped),
      { concurrency: 1 },
    )
    const sorted = samples
      .slice(1)
      .map((sample) => sample.ms)
      .toSorted((a, b) => a - b)
    console.log(`METRIC stats_median_ms=${sorted[Math.floor(sorted.length / 2)].toFixed(2)}`)
    console.log(`METRIC stats_min_ms=${sorted[0].toFixed(2)}`)
    console.log(`METRIC stats_max_ms=${sorted[sorted.length - 1].toFixed(2)}`)
    console.log(
      `METRIC stats_event_loop_max_ms=${Math.max(...samples.slice(1).map((sample) => sample.eventLoopDelayMs)).toFixed(2)}`,
    )
  }).pipe(Effect.provide(database)),
)

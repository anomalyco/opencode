import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionMessage } from "@opencode-ai/core/session/message"

// ── Layer Setup ──────────────────────────────────────────────────────────
const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const store = SessionStore.layer.pipe(Layer.provide(database))
const sessions = SessionV2.layer.pipe(
  Layer.provide(events),
  Layer.provide(database),
  Layer.provide(store),
  Layer.provide(Project.defaultLayer),
  Layer.provide(SessionExecution.noopLayer),
)
const layer = Layer.mergeAll(database, events, projector, store, SessionExecution.noopLayer, sessions)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

// ── Helpers ───────────────────────────────────────────────────────────────
function format(ms: number): string {
  return ms.toFixed(2) + "ms"
}

function quantile(sorted: number[], q: number): number {
  const idx = Math.floor(sorted.length * q)
  return sorted[Math.min(idx, sorted.length - 1)]
}

// Measure the time of an effect (single invocation)
function timed<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<{ value: A; elapsed: number }, E, R> {
  return Effect.gen(function* () {
    const t = performance.now()
    const value = yield* effect
    return { value, elapsed: performance.now() - t }
  })
}

// Run an effect N times, collecting timings
function benchN<A, E, R>(n: number, effect: Effect.Effect<A, E, R>): Effect.Effect<number[], E, R> {
  return Effect.forEach(
    Array.from({ length: n }, (_, i) => i),
    () => timed(effect).pipe(Effect.map((r) => r.elapsed)),
  )
}

// ── Benchmarks (as Effects) ────────────────────────────────────────────────

const benchSessionCreate = (count: number) =>
  benchN(count, SessionV2.Service.use((svc) => svc.create({ location })))

const benchSessionCreateBatch = (count: number) =>
  timed(
    Effect.forEach(
      Array.from({ length: count }, (_, i) => i),
      () => SessionV2.Service.use((svc) => svc.create({ location })),
      { concurrency: count },
    ),
  )

const benchPromptAdmit = (sessionID: SessionV2.ID, count: number) =>
  benchN(count, SessionV2.Service.use((svc) => svc.prompt({ sessionID, prompt: new Prompt({ text: "m" }), delivery: "steer", resume: false })))

const benchContextLoad = (sessionID: SessionV2.ID, reads: number) =>
  benchN(reads, SessionStore.Service.use((svc) => svc.context(sessionID)))

const benchSingleMessage = (sessionID: SessionV2.ID, messageID: SessionMessage.ID, reads: number) =>
  benchN(reads, SessionV2.Service.use((svc) => svc.message({ sessionID, messageID })))

const benchGetSession = (sessionID: SessionV2.ID, reads: number) =>
  benchN(reads, SessionV2.Service.use((svc) => svc.get(sessionID)))

const benchListSessions = (reads: number) =>
  benchN(reads, SessionV2.Service.use((svc) => svc.list()))

const benchConcurrentCreate = (total: number, concurrency: number) =>
  timed(
    Effect.gen(function* () {
      const batchSize = Math.ceil(total / concurrency)
      const fibers = Array.from({ length: concurrency }, () =>
        Effect.forEach(
          Array.from({ length: batchSize }, (_, i) => i),
          () => SessionV2.Service.use((svc) => svc.create({ location })),
        ),
      )
      yield* Effect.all(fibers, { concurrency })
    }),
  )

// ── Report ────────────────────────────────────────────────────────────────

function report(name: string, label: string, times: number[]) {
  const sorted = [...times].sort((a, b) => a - b)
  const n = sorted.length
  const total = sorted.reduce((a, b) => a + b, 0)
  const avg = total / n
  const ops = (n / (total / 1000)).toFixed(0)
  console.log(`${name} (${label}):`)
  console.log(`  total:    ${format(total)} (${ops} ops/s)`)
  console.log(`  avg:      ${format(avg)}`)
  console.log(`  p50:      ${format(quantile(sorted, 0.5))}`)
  console.log(`  p95:      ${format(quantile(sorted, 0.95))}`)
  console.log(`  p99:      ${format(quantile(sorted, 0.99))}`)
  console.log(`  min:      ${format(sorted[0])}`)
  console.log(`  max:      ${format(sorted[sorted.length - 1])}`)
  return { avg, p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95) }
}

function metric(key: string, value: number) {
  console.log(`METRIC ${key}=${value}`)
}

// ── Main ──────────────────────────────────────────────────────────────────

const main = Effect.gen(function* () {
  // warmup
  yield* SessionV2.Service.use((svc) => svc.create({ location }))

  console.log("\n=== Session / Prompt Processing Benchmarks ===\n")

  // Session Creation (serial)
  {
    const times = yield* benchSessionCreate(50)
    const stats = report("Session Creation", "50 serial", times)
    console.log()
    metric("session_create_count", 50)
    metric("session_create_avg_ms", stats.avg)
    metric("session_create_p50_ms", stats.p50)
    metric("session_create_p95_ms", stats.p95)
  }

  // Session Creation (concurrent)
  {
    const result = yield* benchSessionCreateBatch(50)
    console.log(`\nSession Create Concurrent (50 parallel):`)
    console.log(`  total:    ${format(result.elapsed)} (${(50 / (result.elapsed / 1000)).toFixed(0)} ops/s)`)
    console.log()
    metric("session_create_concurrent_total_ms", result.elapsed)
  }

  // Prompt Admission
  {
    const sid = SessionV2.ID.create()
    yield* SessionV2.Service.use((svc) => svc.create({ id: sid, location }))
    const times = yield* benchPromptAdmit(sid, 200)
    const stats = report("Prompt Admission", "200 serial", times)
    console.log()
    metric("prompt_admit_count", 200)
    metric("prompt_admit_avg_ms", stats.avg)
    metric("prompt_admit_p50_ms", stats.p50)
    metric("prompt_admit_p95_ms", stats.p95)
  }

  // Context Load at various sizes
  for (const count of [10, 50, 200]) {
    const sid = SessionV2.ID.create()
    yield* SessionV2.Service.use((svc) => svc.create({ id: sid, location }))
    yield* Effect.forEach(
      Array.from({ length: count }, (_, i) => i),
      (i) => SessionV2.Service.use((svc) => svc.prompt({ sessionID: sid, prompt: new Prompt({ text: `m${i}` }), delivery: "steer", resume: false })),
    )
    const times = yield* benchContextLoad(sid, 100)
    const sorted = [...times].sort((a, b) => a - b)
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length
    const p50 = quantile(sorted, 0.5)
    const p95 = quantile(sorted, 0.95)
    console.log(`\nContext Load (${count} messages, 100 reads):`)
    console.log(`  avg:      ${format(avg)}`)
    console.log(`  p50:      ${format(p50)}`)
    console.log(`  p95:      ${format(p95)}`)
    console.log()
    metric(`context_load_count_${count}_avg_ms`, avg)
    metric(`context_load_count_${count}_p50_ms`, p50)
    metric(`context_load_count_${count}_p95_ms`, p95)
  }

  // Single Message Lookup
  {
    const sid = SessionV2.ID.create()
    yield* SessionV2.Service.use((svc) => svc.create({ id: sid, location }))
    const admitted = yield* SessionV2.Service.use((svc) => svc.prompt({ sessionID: sid, prompt: new Prompt({ text: "lookup target" }), delivery: "steer", resume: false }))
    const times = yield* benchSingleMessage(sid, admitted.id, 100)
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const sorted = [...times].sort((a, b) => a - b)
    console.log(`\nSingle Message Lookup (100 reads):`)
    console.log(`  avg:      ${format(avg)}`)
    console.log(`  p50:      ${format(quantile(sorted, 0.5))}`)
    console.log(`  p95:      ${format(quantile(sorted, 0.95))}`)
    console.log()
    metric("message_lookup_avg_ms", avg)
  }

  // Get Session
  {
    const sid = SessionV2.ID.create()
    yield* SessionV2.Service.use((svc) => svc.create({ id: sid, location }))
    const times = yield* benchGetSession(sid, 100)
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const sorted = [...times].sort((a, b) => a - b)
    console.log(`\nGet Session (100 reads):`)
    console.log(`  avg:      ${format(avg)}`)
    console.log(`  p50:      ${format(quantile(sorted, 0.5))}`)
    console.log(`  p95:      ${format(quantile(sorted, 0.95))}`)
    console.log()
    metric("session_get_avg_ms", avg)
  }

  // List Sessions
  {
    const times = yield* benchListSessions(100)
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const sorted = [...times].sort((a, b) => a - b)
    console.log(`\nList Sessions (100 reads):`)
    console.log(`  avg:      ${format(avg)}`)
    console.log(`  p50:      ${format(quantile(sorted, 0.5))}`)
    console.log(`  p95:      ${format(quantile(sorted, 0.95))}`)
    console.log()
    metric("session_list_avg_ms", avg)
  }

  // Concurrent Session Creates at different concurrency levels
  {
    for (const concurrency of [5, 10, 25]) {
      const result = yield* benchConcurrentCreate(50, concurrency)
      console.log(`\nConcurrent Session Create (50 total, ${concurrency} concurrent):`)
      console.log(`  total:    ${format(result.elapsed)} (${(50 / (result.elapsed / 1000)).toFixed(0)} ops/s)`)
      console.log()
      metric(`session_concurrent_create_${concurrency}_total_ms`, result.elapsed)
    }
  }

  console.log("=== Done ===\n")
})

Effect.runPromise(main.pipe(Effect.provide(layer))).then(() => process.exit(0))

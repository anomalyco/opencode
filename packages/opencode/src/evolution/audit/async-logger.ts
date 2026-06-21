import { Context, Effect, Fiber, Layer, Option, Queue, Ref } from "effect"
import type { AuditEntry } from "@/evolution/decision/p6-types"
import { promises as fs } from "fs"
import path from "path"

const MAX_BATCH_SIZE = 100

export interface Interface {
  readonly log: (entry: AuditEntry) => Effect.Effect<void>
  readonly flush: Effect.Effect<void>
  readonly start: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
  readonly getQueueDepth: Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AsyncAuditLogger") {}

function appendLines(ledgerPath: string, lines: string): Effect.Effect<void> {
  return Effect.promise(() => fs.appendFile(ledgerPath, lines, "utf-8"))
}

function drainAll(
  queue: Queue.Queue<AuditEntry>,
  queueDepthRef: Ref.Ref<number>,
  ledgerPath: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const remaining: AuditEntry[] = []
    while (true) {
      const entry = yield* Queue.poll(queue)
      if (Option.isNone(entry)) break
      remaining.push(entry.value)
    }
    if (remaining.length === 0) return
    yield* Ref.set(queueDepthRef, 0)
    const lines = remaining.map((e) => JSON.stringify(e)).join("\n") + "\n"
    yield* appendLines(ledgerPath, lines)
  })
}

function writeBatch(
  queue: Queue.Queue<AuditEntry>,
  queueDepthRef: Ref.Ref<number>,
  ledgerPath: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const batch = yield* Queue.takeBetween(queue, 1, MAX_BATCH_SIZE)
    yield* Ref.update(queueDepthRef, (n) => n - batch.length)
    const lines = batch.map((e) => JSON.stringify(e)).join("\n") + "\n"
    yield* appendLines(ledgerPath, lines)
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ledgerPath = path.join(".opencode", "evolution", "LEDGER_ABADI.jsonl")
    const queue = yield* Queue.unbounded<AuditEntry>()
    const queueDepthRef = yield* Ref.make(0)
    const fiberRef = yield* Ref.make<Fiber.Fiber<void> | undefined>(undefined)

    const start: Effect.Effect<void> = Effect.gen(function* () {
      const f = yield* Effect.forkScoped(
        writeBatch(queue, queueDepthRef, ledgerPath).pipe(
          Effect.forever,
        ),
      )
      yield* Ref.set(fiberRef, f)
    })

    const stop: Effect.Effect<void> = Effect.gen(function* () {
      const fiber = yield* Ref.get(fiberRef)
      if (fiber) {
        yield* Fiber.interrupt(fiber)
        yield* Ref.set(fiberRef, undefined)
      }
      yield* drainAll(queue, queueDepthRef, ledgerPath)
    })

    const log = (entry: AuditEntry): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Queue.offer(queue, entry)
        yield* Ref.update(queueDepthRef, (n) => n + 1)
      })

    const flush: Effect.Effect<void> = drainAll(queue, queueDepthRef, ledgerPath)

    const getQueueDepth: Effect.Effect<number> = Ref.get(queueDepthRef)

    yield* start
    yield* Effect.addFinalizer(() => stop)

    return Service.of({ log, flush, start, stop, getQueueDepth })
  }),
)

export function logAuditAsync(entry: AuditEntry): Effect.Effect<void> {
  return Effect.gen(function* () {
    const svc = yield* Service
    return yield* svc.log(entry)
  })
}

export * as AsyncAuditLogger from "./async-logger"

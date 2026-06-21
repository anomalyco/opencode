import { Context, Duration, Effect, Layer, Option, Queue, Ref } from "effect"
import type { QueuedTask, WorkerPoolState } from "@/evolution/decision/p6-types"

const MAX_WORKERS = 5
const WORKER_TIMEOUT = Duration.seconds(60)

export interface Interface {
  readonly submitTask: (id: string, task: () => Promise<unknown>) => Effect.Effect<void>
  readonly getPoolState: Effect.Effect<WorkerPoolState>
  readonly resetPool: Effect.Effect<void>
}

function runTask(
  id: string,
  task: () => Promise<unknown>,
  queue: Queue.Queue<QueuedTask>,
  activeRef: Ref.Ref<number>,
  queuedRef: Ref.Ref<number>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.promise(task).pipe(
      Effect.timeout(WORKER_TIMEOUT),
      Effect.catch(() => Effect.logWarning(`[WorkerPool] Task ${id} timed out or failed`)),
    )
    yield* Ref.update(activeRef, (n) => n - 1)
    yield* drainQueue(queue, activeRef, queuedRef)
  })
}

function drainQueue(
  queue: Queue.Queue<QueuedTask>,
  activeRef: Ref.Ref<number>,
  queuedRef: Ref.Ref<number>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const active = yield* Ref.get(activeRef)
    if (active >= MAX_WORKERS) return
    const next = yield* Queue.poll(queue)
    if (Option.isNone(next)) return
    yield* Ref.update(queuedRef, (n) => n - 1)
    yield* Ref.update(activeRef, (n) => n + 1)
    yield* Effect.forkDetach(runTask(next.value.id, next.value.task, queue, activeRef, queuedRef))
  })
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkerPool") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const activeRef = yield* Ref.make(0)
    const queuedRef = yield* Ref.make(0)
    const queue = yield* Queue.unbounded<QueuedTask>()

    const submitTask = Effect.fn("WorkerPool.submitTask")(function* (id: string, task: () => Promise<unknown>) {
      const active = yield* Ref.get(activeRef)
      if (active < MAX_WORKERS) {
        yield* Ref.update(activeRef, (n) => n + 1)
        yield* Effect.forkDetach(runTask(id, task, queue, activeRef, queuedRef))
      } else {
        yield* Ref.update(queuedRef, (n) => n + 1)
        yield* Queue.offer(queue, { id, task, enqueuedAt: Date.now() })
      }
    })

    const getPoolState: Effect.Effect<WorkerPoolState> = Effect.gen(function* () {
      const active = yield* Ref.get(activeRef)
      const queued = yield* Ref.get(queuedRef)
      return { active, queued, maxWorkers: MAX_WORKERS }
    })

    const resetPool: Effect.Effect<void> = Ref.set(activeRef, 0)

    return Service.of({ submitTask, getPoolState, resetPool })
  }),
)

export * as WorkerPool from "./worker-pool"

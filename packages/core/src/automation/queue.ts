export * as AutomationQueue from "./queue"

import { Context, Effect, Layer, Ref, Fiber, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import {
  AutomationClassifier,
  type Classification,
  type Complexity,
  type TaskType,
} from "./classifier"

export class DeduplicationError extends Schema.TaggedErrorClass<DeduplicationError>()(
  "AutomationQueue.DeduplicationError",
  {
    key: Schema.String,
  },
) {}

export interface QueueConfig {
  readonly globalConcurrency: number
  readonly defaultComplexity: Complexity
  readonly defaultTaskType: TaskType
  /** Maps a task type to the agent that should execute those jobs. */
  readonly agentByTaskType: Partial<Record<TaskType, string>>
  /** Overrides routing for high-complexity jobs regardless of task type. */
  readonly highComplexityAgent?: string
  /** Runs the post-run reflection/verification gate for jobs of this complexity or higher. */
  readonly verifyFrom: Complexity
  /** How long a deduplication key remains active after enqueue (ms). Default 60 000. */
  readonly deduplicationTtlMs: number
  /** Maps complexity to numeric priority when the caller doesn't provide one. */
  readonly priorityByComplexity: Record<Complexity, number>
}

export const QueueConfigRef = Context.Reference<QueueConfig>(
  "@opencode/v2/AutomationQueueConfig",
  {
    defaultValue: () => ({
      globalConcurrency: 4,
      defaultComplexity: "medium" as Complexity,
      defaultTaskType: "refactor" as TaskType,
      agentByTaskType: {
        recon: "explore",
        plan: "plan",
        refactor: "general",
        build: "build",
        verify: "general",
      },
      highComplexityAgent: "build",
      verifyFrom: "high",
      deduplicationTtlMs: 60_000,
      priorityByComplexity: { low: 0, medium: 5, high: 10 } as Record<Complexity, number>,
    }),
  },
)

const RANK: Record<Complexity, number> = { low: 0, medium: 1, high: 2 }

/**
 * Activation rule: resolves which agent should run a classified job.
 * Explicit per-trigger overrides are applied by callers and take precedence;
 * otherwise high-complexity jobs route to the careful agent and everything
 * else routes by task type. Returns undefined when nothing applies, leaving
 * the session's current agent in place.
 */
export const routeAgent = (
  classification: Classification,
  config: Pick<QueueConfig, "agentByTaskType" | "highComplexityAgent">,
): string | undefined => {
  if (classification.complexity === "high") return config.highComplexityAgent
  return config.agentByTaskType[classification.taskType]
}

export interface QueuedJob {
  readonly id: string
  readonly prompt: string
  readonly complexity: Complexity
  readonly sessionID: string
  readonly triggerID: string
  readonly classification: Classification
  /** Explicit agent chosen to run this job (never classified). */
  readonly agent?: string
  /** Automation run to update on completion/failure. */
  readonly runID?: string
  /** Trigger lock owner to release when the job settles. */
  readonly lockOwner?: string
  /** Numeric priority — higher values are dispatched first. Default 0. */
  readonly priority: number
  /** Idempotent deduplication key. Rejects a second enqueue while active. */
  readonly deduplicationKey?: string
}

export type JobHandler = (job: QueuedJob) => Effect.Effect<void, never>

export interface Interface {
  readonly enqueue: (
    input: Omit<QueuedJob, "id" | "complexity" | "classification" | "priority"> & {
      complexity?: Complexity
      classification?: Classification
      priority?: number
    },
  ) => Effect.Effect<void, DeduplicationError>
  readonly status: () => Effect.Effect<{
    readonly pending: number
    readonly running: number
    readonly byComplexity: Record<Complexity, number>
    readonly dedupActive: number
  }>
  readonly stop: Effect.Effect<void>
  readonly setHandler: (handler: JobHandler) => Effect.Effect<void>
  /** Whether a queued job is eligible for the post-run verification gate. */
  readonly willVerify: (job: QueuedJob) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AutomationQueue") {}

interface DedupRecord {
  readonly jobId: string
  readonly expiresAt: number
}

interface QueueState {
  pending: QueuedJob[]
  running: Set<string>
  byComplexity: Record<Complexity, number>
  dedupIndex: Map<string, DedupRecord>
  handler: JobHandler | null
}

const initialState = (): QueueState => ({
  pending: [],
  running: new Set(),
  byComplexity: { low: 0, medium: 0, high: 0 },
  dedupIndex: new Map(),
  handler: null,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const classifier = yield* AutomationClassifier.Service
    const config = yield* QueueConfigRef

    const state = yield* Ref.make<QueueState>(initialState())

    const tryRunNext = Effect.gen(function* () {
      const current = yield* Ref.get(state)
      if (current.running.size >= config.globalConcurrency) return false
      if (current.pending.length === 0) return false

      const job = current.pending[0]!
      const remaining = current.pending.slice(1)
      const newRunning = new Set(current.running)
      newRunning.add(job.id)
      const newByComplexity = {
        ...current.byComplexity,
        [job.complexity]: current.byComplexity[job.complexity] - 1,
      }

      yield* Ref.set(state, {
        ...current,
        pending: remaining,
        running: newRunning,
        byComplexity: newByComplexity,
      })

      if (current.handler) {
        const handler = current.handler
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            yield* handler(job).pipe(Effect.ignore)
            yield* Ref.update(state, (s) => {
              const next = new Set(s.running)
              next.delete(job.id)
              const dedupIndex = new Map(s.dedupIndex)
              if (job.deduplicationKey) dedupIndex.delete(job.deduplicationKey)
              return { ...s, running: next, dedupIndex }
            })
          }).pipe(Effect.catch(() => Effect.void)),
        )
      }

      return true
    })

    const worker = Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep("100 millis")
        yield* tryRunNext
      }
    })

    yield* Effect.forkScoped(worker.pipe(Effect.catch(() => Effect.void)))

    const matchComplexity = (a: Complexity, b: Complexity) => RANK[a] >= RANK[b]

    const enqueue: Interface["enqueue"] = Effect.fn("AutomationQueue.enqueue")(function* (input) {
      const now = Date.now()

      // Deduplication check — reject if an active (non-expired) key already exists.
      if (input.deduplicationKey) {
        const s = yield* Ref.get(state)
        const existing = s.dedupIndex.get(input.deduplicationKey)
        if (existing && existing.expiresAt > now) {
          return yield* new DeduplicationError({ key: input.deduplicationKey })
        }
      }

      const classification =
        input.classification ??
        (yield* classifier.classify(input.prompt).pipe(
          Effect.catch(() =>
            Effect.succeed({
              complexity: config.defaultComplexity,
              taskType: config.defaultTaskType,
              reason: "classifier unavailable, using default",
            } as Classification),
          ),
        ))

      const complexity = input.complexity ?? classification.complexity
      const agent = input.agent ?? routeAgent(classification, config)
      // Explicit priority wins; otherwise derive from complexity.
      const priority = input.priority ?? config.priorityByComplexity[complexity] ?? 0

      const job: QueuedJob = {
        id: crypto.randomUUID(),
        prompt: input.prompt,
        complexity,
        priority,
        sessionID: input.sessionID,
        triggerID: input.triggerID,
        classification,
        ...(agent ? { agent } : {}),
        ...(input.runID ? { runID: input.runID } : {}),
        ...(input.lockOwner ? { lockOwner: input.lockOwner } : {}),
        ...(input.deduplicationKey ? { deduplicationKey: input.deduplicationKey } : {}),
      }

      yield* Ref.update(state, (s) => {
        const dedupIndex = new Map(s.dedupIndex)
        if (input.deduplicationKey) {
          dedupIndex.set(input.deduplicationKey, {
            jobId: job.id,
            expiresAt: now + config.deduplicationTtlMs,
          })
        }
        return {
          ...s,
          pending: [...s.pending, job].sort((a, b) => b.priority - a.priority),
          dedupIndex,
          byComplexity: {
            ...s.byComplexity,
            [job.complexity]: s.byComplexity[job.complexity] + 1,
          },
        }
      })
    })

    const status: Interface["status"] = Effect.fn("AutomationQueue.status")(function* () {
      const s = yield* Ref.get(state)
      const now = Date.now()
      let dedupActive = 0
      for (const record of s.dedupIndex.values()) {
        if (record.expiresAt > now) dedupActive++
      }
      return {
        pending: s.pending.length,
        running: s.running.size,
        byComplexity: s.byComplexity,
        dedupActive,
      }
    })

    const setHandler: Interface["setHandler"] = Effect.fn("AutomationQueue.setHandler")(function* (handler) {
      yield* Ref.update(state, (s) => ({ ...s, handler }))
    })

    const stop: Interface["stop"] = Effect.void

    const willVerify: Interface["willVerify"] = (job) => matchComplexity(job.complexity, config.verifyFrom)

    return Service.of({ enqueue, status, stop, setHandler, willVerify })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [AutomationClassifier.node],
})

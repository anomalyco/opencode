export * as AutomationQueue from "./queue"

import { Context, Effect, Layer, Ref, Fiber } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import {
  AutomationClassifier,
  type Classification,
  type Complexity,
  type TaskType,
} from "./classifier"

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
}

export const QueueConfigRef = Context.Reference<QueueConfig>(
  "@opencode/v2/AutomationQueueConfig",
  {
    defaultValue: () => ({
      globalConcurrency: 2,
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
}

export type JobHandler = (job: QueuedJob) => Effect.Effect<void, never>

export interface Interface {
  readonly enqueue: (
    input: Omit<QueuedJob, "id" | "complexity" | "classification"> & {
      complexity?: Complexity
      classification?: Classification
    },
  ) => Effect.Effect<void>
  readonly status: () => Effect.Effect<{
    readonly pending: number
    readonly running: number
    readonly byComplexity: Record<Complexity, number>
  }>
  readonly stop: Effect.Effect<void>
  readonly setHandler: (handler: JobHandler) => Effect.Effect<void>
  /** Whether a queued job is eligible for the post-run verification gate. */
  readonly willVerify: (job: QueuedJob) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AutomationQueue") {}

interface QueueState {
  pending: QueuedJob[]
  running: Set<string>
  byComplexity: Record<Complexity, number>
  handler: JobHandler | null
}

const initialState = (): QueueState => ({
  pending: [],
  running: new Set(),
  byComplexity: { low: 0, medium: 0, high: 0 },
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
              return { ...s, running: next }
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

      const job: QueuedJob = {
        id: crypto.randomUUID(),
        prompt: input.prompt,
        complexity,
        sessionID: input.sessionID,
        triggerID: input.triggerID,
        classification,
        ...(agent ? { agent } : {}),
        ...(input.runID ? { runID: input.runID } : {}),
        ...(input.lockOwner ? { lockOwner: input.lockOwner } : {}),
      }

      yield* Ref.update(state, (s) => ({
        ...s,
        pending: [...s.pending, job],
        byComplexity: {
          ...s.byComplexity,
          [job.complexity]: s.byComplexity[job.complexity] + 1,
        },
      }))
    })

    const status: Interface["status"] = Effect.fn("AutomationQueue.status")(function* () {
      const s = yield* Ref.get(state)
      return {
        pending: s.pending.length,
        running: s.running.size,
        byComplexity: s.byComplexity,
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

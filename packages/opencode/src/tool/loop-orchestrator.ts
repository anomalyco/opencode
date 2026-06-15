import { Effect, Layer, Context, Schema, Ref, Clock, Option } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { LoopState } from "./loop-state"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { PhaseStarted, StuckDetected } from "./loop-event"

export class NoActiveLoopError extends Schema.TaggedErrorClass<NoActiveLoopError>()(
  "LoopOrchestrator.NoActiveLoopError",
  {},
) {
  override get message() {
    return "No loop is currently active. Use loop_plan_create first."
  }
}

export class LoopTimeoutError extends Schema.TaggedErrorClass<LoopTimeoutError>()(
  "LoopOrchestrator.LoopTimeoutError",
  {
    elapsedMs: Schema.Int,
    globalTimeoutMs: Schema.Int,
  },
) {
  override get message() {
    return `Loop timed out after ${this.elapsedMs}ms (limit: ${this.globalTimeoutMs}ms)`
  }
}

export class PhaseTimeoutError extends Schema.TaggedErrorClass<PhaseTimeoutError>()(
  "LoopOrchestrator.PhaseTimeoutError",
  {
    phaseId: Schema.String,
    elapsedMs: Schema.Int,
    phaseTimeoutMs: Schema.Int,
  },
) {
  override get message() {
    return `Phase "${this.phaseId}" timed out after ${this.elapsedMs}ms`
  }
}

export class StuckDetectedError extends Schema.TaggedErrorClass<StuckDetectedError>()(
  "LoopOrchestrator.StuckDetectedError",
  {
    phaseId: Schema.String,
    iterations: Schema.Int,
    lastTool: Schema.String,
  },
) {
  override get message() {
    return `Phase "${this.phaseId}" appears stuck after ${this.iterations} identical tool calls (${this.lastTool})`
  }
}

export const GLOBAL_TIMEOUT_MS = 1_800_000
export const PHASE_TIMEOUT_MS = 600_000
export const GRACE_PERIOD_MS = 300_000
export const STUCK_THRESHOLD = 3

interface ToolCallEntry {
  readonly phaseId: string
  readonly tool: string
  readonly error?: string
  readonly argsHash?: string
  readonly timestamp: number
}

export interface LoopMetrics {
  readonly completedPhases: number
  readonly totalPhases: number
  readonly currentPhase: Option.Option<string>
  readonly elapsedMs: number
  readonly globalTimeoutMs: number
  readonly phaseTimeoutMs: number
  readonly percentage: number
  readonly stuck: boolean
  readonly formattedElapsed: string
}

export interface Interface {
  readonly start: () => Effect.Effect<void>
  readonly startPhase: (phaseId: string, sessionID?: string, phaseTitle?: string, totalPhases?: number) => Effect.Effect<void>
  readonly recordToolCall: (phaseId: string, tool: string, error?: string, args?: Record<string, unknown>) => Effect.Effect<void>
  readonly isStuck: (phaseId: string, sessionID?: string) => Effect.Effect<boolean, StuckDetectedError>
  readonly metrics: () => Effect.Effect<LoopMetrics, NoActiveLoopError>
  readonly isTimedOut: () => Effect.Effect<boolean>
  readonly isPhaseTimedOut: (phaseId: string) => Effect.Effect<boolean>
  readonly reset: () => Effect.Effect<void>
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class Service extends Context.Service<Service, Interface>()("@opencode/LoopOrchestrator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const loopState = yield* LoopState.Service
    const maybeConfig = yield* Effect.serviceOption(Config.Service)
    const loopCfg = Option.isSome(maybeConfig)
      ? (yield* maybeConfig.value.get().pipe(Effect.catch(() => Effect.succeed({} as any)))).loop
      : undefined
    const globalTimeout = loopCfg?.global_timeout_ms ?? GLOBAL_TIMEOUT_MS
    const phaseTimeout = loopCfg?.phase_timeout_ms ?? PHASE_TIMEOUT_MS
    const stuckThreshold = loopCfg?.stuck_threshold ?? STUCK_THRESHOLD
    const maybeEvents = yield* Effect.serviceOption(EventV2Bridge.Service)

    const state = yield* InstanceState.make(
      Effect.fn("LoopOrchestrator.state")(() =>
        Effect.succeed({
          loopStartTime: Ref.makeUnsafe<number>(0),
          phaseStartTimes: Ref.makeUnsafe<Map<string, number>>(new Map()),
          toolCallHistory: Ref.makeUnsafe<readonly ToolCallEntry[]>([]),
        }),
      ),
    )

    const start = Effect.fn("LoopOrchestrator.start")(function* () {
      const refs = yield* InstanceState.get(state)
      const now = yield* Clock.currentTimeMillis
      yield* Ref.set(refs.loopStartTime, now)
    })

    const startPhase = Effect.fn("LoopOrchestrator.startPhase")(function* (phaseId: string, sessionID?: string, phaseTitle?: string, totalPhases?: number) {
      yield* Effect.sleep("100 millis")
      const refs = yield* InstanceState.get(state)
      const now = yield* Clock.currentTimeMillis
      yield* Ref.update(refs.phaseStartTimes, (m) => new Map(m).set(phaseId, now))
      if (sessionID && Option.isSome(maybeEvents)) {
        yield* maybeEvents.value.publish(PhaseStarted, {
          timestamp: now,
          sessionID,
          phaseId,
          phaseTitle: phaseTitle ?? "",
          totalPhases: totalPhases ?? 0,
        }).pipe(Effect.ignore)
      }
    })

    const recordToolCall = Effect.fn("LoopOrchestrator.recordToolCall")(function* (
      phaseId: string,
      tool: string,
      error?: string,
      args?: Record<string, unknown>,
    ) {
      const refs = yield* InstanceState.get(state)
      const now = yield* Clock.currentTimeMillis
      const argsHash = args !== undefined ? JSON.stringify(args) : undefined
      yield* Ref.update(refs.toolCallHistory, (h) => {
        const entry = { phaseId, tool, error, argsHash, timestamp: now }
        const updated = [...h, entry]
        return updated.length > 100 ? updated.slice(-50) : updated
      })
    })

    const isStuck = Effect.fn("LoopOrchestrator.isStuck")(function* (phaseId: string, sessionID?: string) {
      const refs = yield* InstanceState.get(state)
      const history = yield* Ref.get(refs.toolCallHistory)
      const recent = history.filter((h) => h.phaseId === phaseId)

      if (recent.length < stuckThreshold) return false

      const last = recent.slice(-stuckThreshold)
      const allSame = last.every((h) => h.tool === last[0].tool && h.error === last[0].error && h.argsHash === last[0].argsHash)
      if (allSame) {
        if (sessionID && Option.isSome(maybeEvents)) {
          yield* maybeEvents.value.publish(StuckDetected, {
            timestamp: Date.now(),
            sessionID,
            phaseId,
            tool: last[0].tool,
            iterations: recent.length,
          }).pipe(Effect.ignore)
        }
        return yield* new StuckDetectedError({
          phaseId,
          iterations: recent.length,
          lastTool: last[0].tool,
        })
      }
      return false
    })

    const metrics = Effect.fn("LoopOrchestrator.metrics")(function* () {
      const current = yield* loopState.get()
      const refs = yield* InstanceState.get(state)
      const now = yield* Clock.currentTimeMillis

      if (!current.plan) return yield* new NoActiveLoopError()

      const startTime = yield* Ref.get(refs.loopStartTime)
      const elapsedMs = startTime === 0 ? 0 : now - startTime
      const total = current.plan.phases.length
      const completed = current.completedPhases
      const failed = current.failedPhases
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
      const currentPhase = current.plan.phases[current.plan.currentPhaseIndex]
      const stuck = currentPhase ? yield* isStuck(currentPhase.id).pipe(Effect.catch(() => Effect.succeed(true))) : false

      const totalSec = Math.floor(elapsedMs / 1000)
      const formattedElapsed = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`

      return {
        completedPhases: completed,
        totalPhases: total,
        currentPhase: currentPhase ? Option.some(currentPhase.title) : Option.none(),
        elapsedMs,
        globalTimeoutMs: globalTimeout,
        phaseTimeoutMs: phaseTimeout,
        percentage,
        stuck,
        formattedElapsed,
      }
    })

    const isTimedOut = Effect.fn("LoopOrchestrator.isTimedOut")(function* () {
      const refs = yield* InstanceState.get(state)
      const startTime = yield* Ref.get(refs.loopStartTime)
      if (startTime === 0) return false
      const now = yield* Clock.currentTimeMillis
      return (now - startTime) > globalTimeout + GRACE_PERIOD_MS
    })

    const isPhaseTimedOut = Effect.fn("LoopOrchestrator.isPhaseTimedOut")(function* (phaseId: string) {
      const refs = yield* InstanceState.get(state)
      const times = yield* Ref.get(refs.phaseStartTimes)
      const start = times.get(phaseId)
      if (!start) return false
      const now = yield* Clock.currentTimeMillis
      return (now - start) > phaseTimeout
    })

    const reset = Effect.fn("LoopOrchestrator.reset")(function* () {
      const refs = yield* InstanceState.get(state)
      yield* Ref.set(refs.loopStartTime, 0)
      yield* Ref.set(refs.phaseStartTimes, new Map())
      yield* Ref.set(refs.toolCallHistory, [])
    })

    return Service.of({ start, startPhase, recordToolCall, isStuck, metrics, isTimedOut, isPhaseTimedOut, reset })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(LoopState.defaultLayer))

export const node = LayerNode.make(layer, [LoopState.node, Config.node])

export * as LoopOrchestrator from "./loop-orchestrator"

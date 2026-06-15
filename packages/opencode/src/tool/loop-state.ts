import { Effect, Layer, Context, Schema, Ref } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"

export interface Phase {
  id: string
  title: string
  scope: string
  acceptanceCriteria: string[]
  interfaceContract?: string
  status: "pending" | "in_progress" | "completed" | "failed"
  attempts: number
  result?: string
}

export interface Plan {
  description: string
  phases: Phase[]
  createdAt: number
  currentPhaseIndex: number
}

export interface LoopState {
  plan: Plan | null
  startedAt: number | null
  completedPhases: number
  failedPhases: number
  status: "idle" | "running" | "success" | "partial" | "blocked"
}

export const initialState: LoopState = {
  plan: null,
  startedAt: null,
  completedPhases: 0,
  failedPhases: 0,
  status: "idle",
}

export interface Interface {
  readonly get: () => Effect.Effect<LoopState>
  readonly set: (state: LoopState) => Effect.Effect<void>
  readonly update: (fn: (state: LoopState) => LoopState) => Effect.Effect<LoopState>
  readonly reset: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LoopState") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(
      Effect.fn("LoopState.state")(() => Ref.make(initialState)),
    )

    const get = Effect.fn("LoopState.get")(function* () {
      const ref = yield* InstanceState.get(state)
      return yield* Ref.get(ref)
    })

    const set = Effect.fn("LoopState.set")(function* (next: LoopState) {
      const ref = yield* InstanceState.get(state)
      return yield* Ref.set(ref, next)
    })

    const update = Effect.fn("LoopState.update")(function* (fn: (state: LoopState) => LoopState) {
      const ref = yield* InstanceState.get(state)
      return yield* Ref.updateAndGet(ref, fn)
    })

    const reset = Effect.fn("LoopState.reset")(function* () {
      const ref = yield* InstanceState.get(state)
      return yield* Ref.set(ref, initialState)
    })

    return Service.of({ get, set, update, reset })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(defaultLayer, [])

export const PhaseInput = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  scope: Schema.String,
  acceptanceCriteria: Schema.Array(Schema.String),
  interfaceContract: Schema.optional(Schema.String),
})

export const PlanCreateParams = Schema.Struct({
  description: Schema.String,
  phases: Schema.Array(PhaseInput),
})

export const PhaseDefineParams = Schema.Struct({
  phaseId: Schema.String,
  spec: Schema.optional(Schema.String),
  acceptanceCriteria: Schema.optional(Schema.Array(Schema.String)),
  interfaceContract: Schema.optional(Schema.String),
})

export const VerifyQualityParams = Schema.Struct({
  phaseId: Schema.String,
  checks: Schema.Array(
    Schema.Literals(["lint", "typecheck", "test", "contract", "scope"]),
  ),
  directory: Schema.optional(Schema.String),
})

export const LoopSummaryParams = Schema.Struct({
  detail: Schema.optional(Schema.Literals(["brief", "full"])),
})

export const LoopCompleteParams = Schema.Struct({
  status: Schema.Literals(["success", "partial", "blocked"]),
  finalSummary: Schema.String,
})

export * as LoopState from "./loop-state"
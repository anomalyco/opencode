import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { createGoalManager, type GoalStatusResult } from "./manager"
import type { ActiveGoalState } from "./store"
import type { Goal } from "./types"

export interface Interface {
  init: () => Effect.Effect<ActiveGoalState | null>
  create: (objective: string) => Effect.Effect<Goal>
  status: () => Effect.Effect<GoalStatusResult>
  pause: () => Effect.Effect<Goal>
  resume: () => Effect.Effect<Goal>
  enforceBudget: () => Effect.Effect<Goal>
  clear: () => Effect.Effect<Goal>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Goal") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const manager = createGoalManager(ctx)

    return Service.of({
      init: () => Effect.promise(() => manager.init()),
      create: (objective) => Effect.promise(() => manager.create(objective)),
      status: () => Effect.promise(() => manager.status()),
      pause: () => Effect.promise(() => manager.pause()),
      resume: () => Effect.promise(() => manager.resume()),
      enforceBudget: () => Effect.promise(() => manager.enforceBudget()),
      clear: () => Effect.promise(() => manager.clear()),
    })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as Goal from "./service"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context } from "effect"
import { EvolutionMemory } from "./memory"
import { EvolutionProject } from "./project"
import { EvolutionDecisions } from "./decisions"

export interface Interface {
  readonly memory: EvolutionMemory.Interface
  readonly project: EvolutionProject.Interface
  readonly decisions: EvolutionDecisions.Interface
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionBrain") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* EvolutionMemory.Service
    const project = yield* EvolutionProject.Service
    const decisions = yield* EvolutionDecisions.Service
    return Service.of({ memory, project, decisions })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EvolutionMemory.defaultLayer),
  Layer.provide(EvolutionProject.defaultLayer),
  Layer.provide(EvolutionDecisions.defaultLayer),
)

export const node = LayerNode.make(layer, [EvolutionMemory.node, EvolutionProject.node, EvolutionDecisions.node])

export * as EvolutionBrain from "."

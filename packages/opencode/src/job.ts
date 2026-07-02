import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Service, make } from "@opencode-ai/core/job"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer } from "effect"

export {
  Service,
  type BackgroundAllInput,
  type BlockInput,
  type BlockResult,
  type Info,
  type Interface,
  type StartInput,
  type Status,
  type WaitInput,
  type WaitResult,
} from "@opencode-ai/core/job"

/** Keeps the legacy service instance-scoped while sharing the core registry engine. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(() => make)
    return Service.of({
      list: () => InstanceState.useEffect(state, (jobs) => jobs.list()),
      get: (id) => InstanceState.useEffect(state, (jobs) => jobs.get(id)),
      start: (input) => InstanceState.useEffect(state, (jobs) => jobs.start(input)),
      wait: (input) => InstanceState.useEffect(state, (jobs) => jobs.wait(input)),
      block: (input) => InstanceState.useEffect(state, (jobs) => jobs.block(input)),
      background: (id) => InstanceState.useEffect(state, (jobs) => jobs.background(id)),
      backgroundAll: (input) => InstanceState.useEffect(state, (jobs) => jobs.backgroundAll(input)),
      cancel: (id) => InstanceState.useEffect(state, (jobs) => jobs.cancel(id)),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as Job from "./job"

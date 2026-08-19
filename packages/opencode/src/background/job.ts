import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BackgroundJob as CoreBackgroundJob } from "@opencode-ai/core/background-job"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer } from "effect"

export {
  Service,
  type ExactEntry,
  type ExtendInput,
  type Info,
  type Interface,
  type Lifetime,
  type StartInput,
  type Status,
  type WaitInput,
  type WaitResult,
} from "@opencode-ai/core/background-job"

/** Keeps the legacy service instance-scoped while sharing the core registry engine. */
const layer = Layer.effect(
  CoreBackgroundJob.Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(() => CoreBackgroundJob.make)
    return CoreBackgroundJob.Service.of({
      list: () => InstanceState.useEffect(state, (jobs) => jobs.list()),
      listExact: () => InstanceState.useEffect(state, (jobs) => jobs.listExact()),
      get: (id) => InstanceState.useEffect(state, (jobs) => jobs.get(id)),
      start: (input) => InstanceState.useEffect(state, (jobs) => jobs.start(input)),
      extend: (input) => InstanceState.useEffect(state, (jobs) => jobs.extend(input)),
      wait: (input) => InstanceState.useEffect(state, (jobs) => jobs.wait(input)),
      waitForPromotion: (id) => InstanceState.useEffect(state, (jobs) => jobs.waitForPromotion(id)),
      promote: (id) => InstanceState.useEffect(state, (jobs) => jobs.promote(id)),
      cancel: (id) => InstanceState.useEffect(state, (jobs) => jobs.cancel(id)),
      cancelExact: (lifetime) => InstanceState.useEffect(state, (jobs) => jobs.cancelExact(lifetime)),
    })
  }),
)

export const node = LayerNode.make({ service: CoreBackgroundJob.Service, layer, deps: [] })

export * as BackgroundJob from "./job"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BackgroundJob as CoreBackgroundJob } from "@opencode-ai/core/background-job"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer } from "effect"
import { InstanceActivity } from "@opencode-ai/core/instance-activity"

export {
  Service,
  type ExtendInput,
  type Info,
  type Interface,
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
    const tracked = (activity: InstanceActivity.Identity, run: Effect.Effect<string, unknown>) =>
      Effect.sync(() => InstanceActivity.touch(activity)).pipe(
        Effect.andThen(run),
        Effect.ensuring(Effect.sync(() => InstanceActivity.touch(activity))),
      )
    return CoreBackgroundJob.Service.of({
      list: () => InstanceState.useEffect(state, (jobs) => jobs.list()),
      get: (id) => InstanceState.useEffect(state, (jobs) => jobs.get(id)),
      start: (input) =>
        Effect.gen(function* () {
          const activity = InstanceActivity.identify(yield* InstanceState.directory)
          InstanceActivity.touch(activity)
          return yield* InstanceState.useEffect(state, (jobs) =>
            jobs.start({ ...input, run: tracked(activity, input.run) }),
          )
        }),
      extend: (input) =>
        Effect.gen(function* () {
          const activity = InstanceActivity.identify(yield* InstanceState.directory)
          InstanceActivity.touch(activity)
          return yield* InstanceState.useEffect(state, (jobs) =>
            jobs.extend({ ...input, run: tracked(activity, input.run) }),
          )
        }),
      wait: (input) => InstanceState.useEffect(state, (jobs) => jobs.wait(input)),
      waitForPromotion: (id) => InstanceState.useEffect(state, (jobs) => jobs.waitForPromotion(id)),
      promote: (id) => InstanceState.useEffect(state, (jobs) => jobs.promote(id)),
      cancel: (id) => InstanceState.useEffect(state, (jobs) => jobs.cancel(id)),
    })
  }),
)

export const node = LayerNode.make({ service: CoreBackgroundJob.Service, layer, deps: [] })

export * as BackgroundJob from "./job"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BackgroundJob as CoreBackgroundJob } from "@opencode-ai/core/background-job"
import { InstanceState } from "@/effect/instance-state"
import { SessionClosure } from "@/session/closure/coordinator"
import { Effect, Layer } from "effect"
import { BackgroundJobBinder } from "./binder"

export {
  Service,
  AnswerLog,
  Announce,
  type Admission,
  type Answer,
  type ArmPermit,
  type BindDecision,
  type BindRequest,
  type Binder,
  type Detected,
  type DetectedAnswer,
  type ExactEntry,
  type ExtendExactInput,
  type ExtendExactResult,
  type ExtendInput,
  type Info,
  type Interface,
  type Invocation,
  type InvocationHandle,
  type HandleObservation,
  type Lifetime,
  type LifetimeState,
  type Observation,
  type SequenceNote,
  type SequenceOutcome,
  type StartExactResult,
  type StartInput,
  type Status,
  type TerminalInput,
  type WaitAnswerInput,
  type WaitAnswerResult,
  type WaitExactInput,
  type WaitHandleInput,
  type WaitInput,
  type WaitResult,
} from "@opencode-ai/core/background-job"

/**
 * Keeps the service Instance-scoped while sharing core's registry and a closure-aware binder.
 * There is no permissive layer variant: callers without admission must fail closed.
 *
 * `SessionClosure` comes from context so tests can provide a fake. A real closure without an
 * Instance runtime waits for runtime readiness and will not initialize in a bare layer test.
 */
export const layer = Layer.effect(
  CoreBackgroundJob.Service,
  Effect.gen(function* () {
    const closure = yield* SessionClosure.Service
    const binder = yield* BackgroundJobBinder.make(closure)
    const state = yield* InstanceState.make(() => CoreBackgroundJob.makeWith(binder))
    return CoreBackgroundJob.Service.of({
      list: () => InstanceState.useEffect(state, (jobs) => jobs.list()),
      get: (id) => InstanceState.useEffect(state, (jobs) => jobs.get(id)),
      start: (input) => InstanceState.useEffect(state, (jobs) => jobs.start(input)),
      extend: (input) => InstanceState.useEffect(state, (jobs) => jobs.extend(input)),
      extendWithHandle: (input) => InstanceState.useEffect(state, (jobs) => jobs.extendWithHandle(input)),
      wait: (input) => InstanceState.useEffect(state, (jobs) => jobs.wait(input)),
      waitForPromotion: (id) => InstanceState.useEffect(state, (jobs) => jobs.waitForPromotion(id)),
      promote: (id) => InstanceState.useEffect(state, (jobs) => jobs.promote(id)),
      cancel: (id) => InstanceState.useEffect(state, (jobs) => jobs.cancel(id)),
      startExact: (input) => InstanceState.useEffect(state, (jobs) => jobs.startExact(input)),
      listExact: () => InstanceState.useEffect(state, (jobs) => jobs.listExact()),
      getExact: (lifetime) => InstanceState.useEffect(state, (jobs) => jobs.getExact(lifetime)),
      extendExact: (input) => InstanceState.useEffect(state, (jobs) => jobs.extendExact(input)),
      waitExact: (input) => InstanceState.useEffect(state, (jobs) => jobs.waitExact(input)),
      waitHandle: (input) => InstanceState.useEffect(state, (jobs) => jobs.waitHandle(input)),
      waitForPromotionExact: (lifetime) =>
        InstanceState.useEffect(state, (jobs) => jobs.waitForPromotionExact(lifetime)),
      promoteExact: (lifetime) => InstanceState.useEffect(state, (jobs) => jobs.promoteExact(lifetime)),
      cancelExact: (lifetime) => InstanceState.useEffect(state, (jobs) => jobs.cancelExact(lifetime)),
      observe: (invocation) => InstanceState.useEffect(state, (jobs) => jobs.observe(invocation)),
      observeHandle: (handle) => InstanceState.useEffect(state, (jobs) => jobs.observeHandle(handle)),
      waitAnswer: (input) => InstanceState.useEffect(state, (jobs) => jobs.waitAnswer(input)),
    })
  }),
)

/** Requires a real Instance runtime or a test-provided `SessionClosure`. */
export const node = LayerNode.make({
  service: CoreBackgroundJob.Service,
  layer,
  deps: [SessionClosure.node],
})

export * as BackgroundJob from "./job"

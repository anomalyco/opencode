import { Effect, Layer, Ref } from "effect"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"

/**
 * The job half of `SessionClosure.Interface`, defaulted for fakes that do not exercise it.
 *
 * Every entry dies rather than answering benignly. A default that returned `rejected` or
 * `arm_allowed` would let a suite pass while the code under test never reached real admission
 * authority — the fake, not the coordinator, would be deciding admission. Dying turns an unstubbed
 * call into a loud failure instead of a quiet wrong answer.
 *
 * Spread this first so a test's own overrides win:
 *
 *   SessionClosure.Service.of({ ...unusedJobs, request: ..., acquire: ... })
 */
export const unusedJobs = {
  jobStart: () => Effect.die("unused"),
  jobExtend: () => Effect.die("unused"),
  jobPermit: () => Effect.die("unused"),
  jobRegistered: () => Effect.die("unused"),
  jobBinderFailed: () => Effect.die("unused"),
  jobCancel: () => Effect.die("unused"),
  jobTerminal: () => Effect.die("unused"),
} satisfies Pick<
  SessionClosure.Interface,
  "jobStart" | "jobExtend" | "jobPermit" | "jobRegistered" | "jobBinderFailed" | "jobCancel" | "jobTerminal"
>

/**
 * A fresh grant per bind, claimable exactly once.
 *
 * Core treats a `false` claim as "someone else won" and performs no run effects, so a permit
 * claimable twice would let two invocations arm off one grant. Each execution makes its own Ref, so
 * reusing the value is safe.
 */
const grantOnce = Effect.gen(function* () {
  const claimed = yield* Ref.make(false)
  return {
    type: "arm_allowed" as const,
    permit: Model.id("arm", `arm_fake_${crypto.randomUUID()}`),
    // Ignored by the binder, which uses core's own requested sequence rather than this one.
    sequence: 0n,
    claim: Ref.modify(claimed, (was) => [was === false, true] as const),
  }
})

/**
 * The job half for fakes that do start background jobs, admitting every bind. Spread first, like
 * `unusedJobs`.
 *
 * Reach for this when a fake closure sits under code that really starts a job. `unusedJobs` dies on
 * `jobStart`, and dying is not loud there: the binder catches the whole cause, defects included,
 * because core's `bind` has no error channel and anything escaping would surface as an arm. A
 * fail-loud fake is therefore converted into a silent refusal, the job never arms, and the symptom
 * is a job reporting `cancelled` with no mention of admission anywhere.
 */
export const admittingJobs = {
  ...unusedJobs,
  jobStart: () => grantOnce,
  jobExtend: () => grantOnce,
  jobTerminal: () => Effect.void,
} satisfies Pick<
  SessionClosure.Interface,
  "jobStart" | "jobExtend" | "jobPermit" | "jobRegistered" | "jobBinderFailed" | "jobCancel" | "jobTerminal"
>

/**
 * A fake `SessionClosure` that admits every job bind, for suites that start background jobs without
 * a real coordinator. `BackgroundJob` takes `SessionClosure` from context, so every suite that
 * builds it must supply one.
 *
 * A real `SessionClosure` in a bare test blocks forever rather than failing: `InstanceState.get`
 * withholds a per-directory runtime until that runtime's queue and supervisor are terminally ready,
 * so a `jobStart` issued with no Instance context never returns. Either use this fake, or build a
 * real Instance runtime.
 *
 * It answers `arm_allowed` unconditionally, so it proves registry mechanics and nothing about
 * whether admission authority was consulted or what it decided. Assertions about admission
 * behaviour belong against a real coordinator.
 */
export const admittingClosure = Layer.succeed(
  SessionClosure.Service,
  SessionClosure.Service.of({
    ...admittingJobs,
    request: () => Effect.die("unused"),
    view: Effect.die("unused"),
    identity: Effect.die("unused"),
    acquire: () => Effect.die("unused"),
    bind: () => Effect.die("unused"),
    retire: () => Effect.die("unused"),
    reserveMutation: () => Effect.die("unused"),
    activateMutation: () => Effect.die("unused"),
    retireMutation: () => Effect.die("unused"),
  }),
)

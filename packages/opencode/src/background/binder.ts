import type { BackgroundJob } from "@opencode-ai/core/background-job"
import { Effect, Ref } from "effect"
import type { SessionClosure } from "../session/closure/coordinator"
import * as Model from "../session/closure/model"

/**
 * Bridges core's opaque lifetime token to a comparable model identity. WeakMap identity remains
 * stable for extensions and ABA-safe across reused public ids. Core cannot depend on closure, so
 * this adapter supplies its admission answer.
 */
export namespace BackgroundJobBinder {
  export type Refusal = "no_admission" | "wrong_location" | "refused_by_authority" | "joined_without_permit"

  export const make = Effect.fn("BackgroundJobBinder.make")(function* (closure: SessionClosure.Interface) {
    const lifetimes = new WeakMap<object, Model.LifetimeID>()
    const counter = yield* Ref.make(0n)

    const identify = (token: object) =>
      Effect.gen(function* () {
        const existing = lifetimes.get(token)
        if (existing) return existing
        const next = yield* Ref.modify(counter, (current) => [current, current + 1n])
        const minted = Model.id("lifetime", `lifetime_job_${next}`)
        lifetimes.set(token, minted)
        return minted
      })

    const request = Ref.modify(counter, (current) => [Model.id("request", `request_job_${current}`), current + 1n])

    return {
      bind: (input: BackgroundJob.BindRequest) =>
        Effect.gen(function* () {
          // No admission capability may make a safety guard permissive. An absent admission is
          // "this caller supplied none", and the only fail-closed reading of that is refusal. The
          // id-keyed compatibility surface reaches this same path, so callers outside closure
          // authority are refused here rather than being quietly granted.
          if (!input.admission) return { kind: "rejected" as const, reason: "no_admission" satisfies Refusal }

          const lifetime = yield* identify(input.lifetime.token)
          const job = Model.id("job", `job_${input.lifetime.id}`)
          const lease = Model.id("lease", input.admission.lease)
          const requested = yield* request
          const outcome = yield* (
            input.sequence === 0
              ? closure.jobStart({
                  request: requested,
                  job,
                  lifetime,
                  scope: Model.id("scope", `jobscope_${input.lifetime.id}_${lifetime}`),
                  lease,
                  epoch: input.admission.epoch,
                })
              : closure.jobExtend({ request: requested, job, lifetime, lease, epoch: input.admission.epoch })
          ).pipe(
            // Binding has no error channel, so an unavailable or defective authority must fail closed.
            Effect.catchCause(() => Effect.succeed({ type: "location_error" as const })),
          )

          if (outcome.type === "location_error")
            return { kind: "rejected" as const, reason: "wrong_location" satisfies Refusal }
          if (outcome.type === "cancellation_owned") return { kind: "cancellation_owned" as const }
          if (outcome.type === "rejected")
            return { kind: "rejected" as const, reason: "refused_by_authority" satisfies Refusal }

          // A joined result carries no permit, so this invocation cannot arm.
          if (outcome.type === "joined")
            return { kind: "rejected" as const, reason: "joined_without_permit" satisfies Refusal }

          return {
            kind: "arm_allowed" as const,
            permit: {
              lifetime: input.lifetime,
              sequence: input.sequence,
              claim: outcome.claim,
            },
          }
        }),
      terminal: (input: BackgroundJob.TerminalInput) =>
        Effect.gen(function* () {
          const lifetime = yield* identify(input.lifetime.token)
          yield* closure.jobTerminal({
            job: Model.id("job", `job_${input.lifetime.id}`),
            lifetime,
            winner: input.winner,
          })
        }).pipe(Effect.orDie),
    } satisfies BackgroundJob.Binder
  })
}

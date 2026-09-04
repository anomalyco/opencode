import { BackgroundJob } from "@/background/job"
import { InstanceRef } from "@/effect/instance-ref"
import { RuntimeFlags } from "@/effect/runtime-flags"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceStore } from "@/project/instance-store"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { PtyActivity } from "@opencode-ai/core/pty/activity"
import { Effect, Layer, Schedule } from "effect"

export const SWEEP_INTERVAL = "1 minute"

export interface ActivityServices {
  readonly runners: SessionRunState.Interface
  readonly statuses: SessionStatus.Interface
  readonly background: BackgroundJob.Interface
}

export const canDispose = Effect.fn("InstanceEviction.canDispose")(function* (
  ctx: InstanceContext,
  services: ActivityServices,
) {
  if (PtyActivity.hasRunning(ctx.directory)) return false
  return yield* Effect.gen(function* () {
    if (yield* services.runners.isActive()) return false
    if (Array.from((yield* services.statuses.list()).values()).some((status) => status.type !== "idle")) return false
    if ((yield* services.background.list()).some((job) => job.status === "running")) return false
    return true
  }).pipe(Effect.provideService(InstanceRef, ctx))
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const flags = yield* RuntimeFlags.Service
    if (flags.instanceIdleTimeoutWarning) yield* Effect.logWarning(flags.instanceIdleTimeoutWarning)
    const timeout = flags.instanceIdleTimeoutMs
    if (timeout === undefined) return

    const store = yield* InstanceStore.Service
    const runners = yield* SessionRunState.Service
    const statuses = yield* SessionStatus.Service
    const background = yield* BackgroundJob.Service

    yield* Effect.logInfo("instance idle eviction enabled", { timeout })
    yield* store
      .sweepIdle({
        idleTimeoutMs: timeout,
        canDispose: (ctx) => canDispose(ctx, { runners, statuses, background }),
      })
      .pipe(
        Effect.tap((count) => (count > 0 ? Effect.logInfo("evicted idle instances", { count }) : Effect.void)),
        Effect.catchCause((cause) => Effect.logWarning("instance idle sweep failed", { cause })),
        Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
        Effect.forkScoped,
      )
  }),
)

export * as InstanceEviction from "./instance-eviction"

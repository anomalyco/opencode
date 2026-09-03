import { BackgroundJob } from "@/background/job"
import { HeartbeatStore } from "./store"
import { Cause, Clock, Effect, Scope } from "effect"

export function arm(input: {
  background: BackgroundJob.Interface
  store: HeartbeatStore.Interface
  scope: Scope.Scope
  heartbeat: HeartbeatStore.Info
  deliver: (heartbeat: HeartbeatStore.Info) => Effect.Effect<unknown, unknown>
}) {
  const heartbeat = input.heartbeat
  return Effect.gen(function* () {
    yield* input.background.cancel(heartbeat.jobID)
    return yield* input.background.start({
      id: heartbeat.jobID,
      type: "heartbeat",
      title: heartbeat.task,
      metadata: backgroundMetadata(heartbeat),
      run: Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const remaining = Math.max(0, heartbeat.firesAt - now)
        if (remaining > 0) yield* Effect.sleep(`${remaining} millis`)
        const claimed = yield* input.store.claim(heartbeat.jobID, heartbeat.revision)
        if (!claimed)
          return `Skipped stale heartbeat ${heartbeat.checkNumber}/${heartbeat.maxChecks} for ${heartbeat.task}`

        yield* input.deliver(claimed).pipe(
          Effect.tap(() => input.store.complete(claimed.jobID, claimed.revision)),
          Effect.catchCause((cause) =>
            input.store.fail(claimed.jobID, claimed.revision, Cause.pretty(cause)).pipe(
              Effect.andThen(
                Effect.logError("heartbeat delivery failed", {
                  jobID: claimed.jobID,
                  sessionID: claimed.sessionID,
                  task: claimed.task,
                  cause,
                }),
              ),
            ),
          ),
          Effect.forkIn(input.scope, { startImmediately: true }),
        )

        return `Heartbeat ${claimed.checkNumber}/${claimed.maxChecks} fired for ${claimed.task}`
      }),
    })
  })
}

export function promptText(heartbeat: HeartbeatStore.Info) {
  return [
    `<heartbeat task=${JSON.stringify(heartbeat.task)} check=${JSON.stringify(
      `${heartbeat.checkNumber}/${heartbeat.maxChecks}`,
    )}>`,
    "No-thinking monitoring turn. Inspect only the current state of this same task with the cheapest direct status command.",
    "Do not repeat completed work, re-read unrelated context, or use sleep/blocking polling.",
    "Report only material progress; an unchanged state is expected and is not a blocker.",
    `If it is still running, call heartbeat again with action="schedule" and task=${JSON.stringify(heartbeat.task)}.`,
    `Omit delay_seconds to use the next configured interval (${heartbeat.nextDelaySeconds}s), or set it to choose the exact next delay.`,
    "If the task finished, continue the original request and verify its result.",
    "If it failed or needs user input, diagnose it or report the blocker and do not reschedule blindly.",
    `This check was scheduled at ${new Date(heartbeat.scheduledAt).toISOString()} and fired at approximately ${new Date(
      heartbeat.firesAt,
    ).toISOString()}.`,
    "</heartbeat>",
  ].join("\n")
}

export function backgroundMetadata(heartbeat: HeartbeatStore.Info) {
  return {
    sessionId: heartbeat.sessionID,
    task: heartbeat.task,
    revision: heartbeat.revision,
    checkNumber: heartbeat.checkNumber,
    maxChecks: heartbeat.maxChecks,
    delaySeconds: heartbeat.delaySeconds,
    initialDelaySeconds: heartbeat.initialDelaySeconds,
    intervalSeconds: heartbeat.intervalSeconds,
    backoff: heartbeat.backoff,
    maxIntervalSeconds: heartbeat.maxIntervalSeconds,
    nextDelaySeconds: heartbeat.nextDelaySeconds,
    scheduledAt: heartbeat.scheduledAt,
    firesAt: heartbeat.firesAt,
  }
}

export * as HeartbeatScheduler from "./scheduler"

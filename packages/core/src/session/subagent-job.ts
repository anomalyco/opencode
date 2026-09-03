export * as SubagentJob from "./subagent-job.js"

import { Effect, Scope } from "effect"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { BackgroundNotice } from "./background-notice.js"
import { SubagentOutcome } from "./subagent-outcome.js"
import type { SessionSchema } from "./schema.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

interface Runner {
  start: (recovery: Recovery) => Effect.Effect<Job.Info>
  background: (childID: SessionSchema.ID) => Effect.Effect<void>
  notify: (job: Job.Info) => Effect.Effect<void>
}

export const make: Effect.Effect<Runner, never, Session.Service | Job.Service | Scope.Scope> = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const jobs = yield* Job.Service
  const scope = yield* Scope.Scope
  // One observer per job generation, including continuations of the same child.
  const notifications = new Set<string>()

  const notify = Effect.fn("SubagentJob.notify")(function* (job: Job.Info) {
    const key = `${job.id}:${job.started_at}`
    if (notifications.has(key)) return
    notifications.add(key)
    yield* Effect.gen(function* () {
      const info = (yield* jobs.wait({ id: job.id })).info
      if (info?.recovery && info.status !== "running")
        yield* BackgroundNotice.deliver(sessions, jobs, { ...info, recovery: info.recovery })
    }).pipe(
      Effect.ensuring(Effect.sync(() => notifications.delete(key))),
      Effect.forkIn(scope, { startImmediately: true }),
    )
  })

  return {
    start: (recovery: Recovery) =>
      jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        title: recovery.description,
        metadata: {},
        recovery,
        run: SubagentOutcome.run(sessions, recovery.childSessionID),
      }),
    background: Effect.fn("SubagentJob.background")(function* (childID: SessionSchema.ID) {
      const info = yield* jobs.background(childID)
      if (info) yield* notify(info)
    }),
    notify,
  }
})

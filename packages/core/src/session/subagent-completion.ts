export * as SubagentCompletion from "./subagent-completion.js"

import { Effect, Predicate } from "effect"
import type { Job } from "../job.js"
import type { Session } from "../session.js"
import type { SessionExecution } from "./execution.js"
import type { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"

export const NO_TEXT = "Subagent completed without a text response."

export function text(message: SessionMessage.Info | undefined) {
  if (message?.type !== "assistant") return NO_TEXT
  return (
    message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter((text) => text.length > 0)
      .join("\n\n") || NO_TEXT
  )
}

/**
 * Waits until the child is idle with no background work of its own left. A finished job's
 * notice wakes the child before its marker is cleared, so awaiting idle after the marker clears
 * covers the drain that handles the notice. Markers for jobs this process does not know are ignored.
 */
export const awaitBackground = Effect.fnUntraced(function* (
  jobs: Pick<Job.Interface, "pendingBackground" | "get" | "wait">,
  execution: Pick<SessionExecution.Interface, "awaitIdle">,
  sessionID: SessionSchema.ID,
) {
  const pending = Effect.gen(function* () {
    const owned = (yield* jobs.pendingBackground).filter(
      (background) =>
        (background.recovery.kind === "shell" ? background.recovery.sessionID : background.recovery.parentSessionID) ===
        sessionID,
    )
    return (yield* Effect.forEach(owned, (background) => jobs.get(background.id))).filter(Predicate.isNotUndefined)
  })
  while (true) {
    const known = yield* pending
    if (known.length === 0) {
      yield* execution.awaitIdle(sessionID)
      // The drain that handled the last notice may have started more background work.
      if ((yield* pending).length === 0) return
      continue
    }
    const running = known.filter((info) => info.status === "running")
    // Finished jobs keep their marker until their notice is admitted.
    if (running.length === 0) yield* Effect.sleep("50 millis")
    yield* Effect.forEach(running, (info) => jobs.wait({ id: info.id }), { discard: true })
  }
})

export const deliver = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "synthetic">,
  jobs: Pick<Job.Interface, "completeBackground">,
  input: Pick<Job.Info, "status" | "output" | "error" | "notificationID"> & {
    recovery: Extract<Job.Recovery, { kind: "subagent" }>
    resume?: boolean
  },
) {
  if (input.status === "running") return
  const recovery = input.recovery
  const text =
    input.status === "completed"
      ? (input.output ?? NO_TEXT)
      : input.status === "error"
        ? (input.error ?? "Subagent failed")
        : "Subagent cancelled"
  yield* sessions.synthetic({
    ...(input.notificationID ? { id: input.notificationID } : {}),
    sessionID: recovery.parentSessionID,
    ...(input.resume === false ? { resume: false } : {}),
    description: recovery.description,
    text: `<subagent sessionID="${recovery.childSessionID}" state="${input.status}" description="${recovery.description}">\n${text}\n</subagent>`,
    metadata: { source: "subagent", childID: recovery.childSessionID, agent: recovery.agent, state: input.status },
  })
  if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
})

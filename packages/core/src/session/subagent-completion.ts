export * as SubagentCompletion from "./subagent-completion.js"

import { Effect } from "effect"
import type { Job } from "../job.js"
import type { Session } from "../session.js"
import type { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"

export const NO_TEXT = "Subagent completed without a text response."

export function text(message: SessionMessage.Info | undefined) {
  if (message?.type !== "assistant") return NO_TEXT
  return (
    message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") || NO_TEXT
  )
}

/**
 * Runs the child session to quiescence and returns its final completed response.
 * A child can end a turn while its own shell or nested subagent is still running;
 * that work admits a wake-up notification and resumes the child, so the response
 * is only final once no pending notification will wake it again.
 */
export const finalText = Effect.fnUntraced(function* (input: {
  sessions: Pick<Session.Interface, "resume" | "messages">
  jobs: Pick<Job.Interface, "pendingBackground" | "awaitBackground">
  sessionID: SessionSchema.ID
}) {
  while (true) {
    yield* input.sessions.resume(input.sessionID)
    const pending = (yield* input.jobs.pendingBackground).filter((job) =>
      job.recovery.kind === "shell"
        ? job.recovery.sessionID === input.sessionID
        : job.recovery.parentSessionID === input.sessionID,
    )
    if (pending.length === 0) break
    yield* Effect.forEach(pending, (job) => input.jobs.awaitBackground(job.notificationID), {
      concurrency: "unbounded",
      discard: true,
    })
  }
  const messages = yield* input.sessions.messages({ sessionID: input.sessionID, order: "desc", limit: 20 })
  const assistant = messages.find(
    (message) => message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
  )
  return text(assistant)
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

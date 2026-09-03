export * as SubagentJob from "./subagent-job.js"

import { Effect } from "effect"
import type { Job } from "../job.js"
import type { Session } from "../session.js"

export const noText = "Subagent completed without a text response."

/** The same child execution and result selection for live jobs and restart recovery. */
export const start = (
  sessions: Pick<Session.Interface, "resume" | "messages">,
  jobs: Pick<Job.Interface, "start">,
  recovery: Extract<Job.Recovery, { kind: "subagent" }>,
  options?: Pick<Job.StartInput, "id" | "notificationID">,
) =>
  jobs.start({
    id: options?.id ?? recovery.childSessionID,
    type: "subagent",
    title: recovery.description,
    metadata: {},
    notificationID: options?.notificationID,
    recovery,
    run: Effect.gen(function* () {
      // A failed resume remains a job error, not a successful no-text result.
      yield* sessions.resume(recovery.childSessionID)
      const messages = yield* sessions.messages({ sessionID: recovery.childSessionID, order: "desc", limit: 20 })
      const assistant = messages.find(
        (message) =>
          message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
      )
      if (assistant?.type !== "assistant") return noText
      return (
        assistant.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("") || noText
      )
    }),
  })

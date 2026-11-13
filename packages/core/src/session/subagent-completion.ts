export * as SubagentCompletion from "./subagent-completion.js"

import { Effect } from "effect"
import type { Job } from "../job.js"
import type { SessionBackground } from "./background.js"
import type { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"

export const NO_TEXT = "Subagent completed without a text response."

export type RunningBackgroundItem = SessionBackground.OutstandingItem

/** A Session handle narrow enough for both Session.Service and SessionExecution to deliver a report. */
export interface SyntheticSession<E = never> {
  readonly synthetic: (input: {
    readonly id?: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly text: string
    readonly description?: string
    readonly metadata?: SessionSchema.Metadata
  }) => Effect.Effect<unknown, E>
}

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

const clean = (value: string) => value.replace(/\s+/g, " ").trim()

const STILL_RUNNING = "\n\nBackground work still running:\n"

export function formatBody(
  body: string,
  childSessionID: SessionSchema.ID,
  background?: ReadonlyArray<RunningBackgroundItem>,
): string {
  if (!background || background.length === 0) return body
  const lines = background.map((item) => {
    if (item.kind === "shell")
      return `- shell (${item.shellID}${item.sessionID !== childSessionID ? `, in ${item.sessionID}` : ""}): ${clean(item.command)}`
    if (item.kind === "image")
      return `- image (${item.model}${item.sessionID !== childSessionID ? `, in ${item.sessionID}` : ""}): ${item.path}`
    return `- subagent (${item.agent}, sessionID: ${item.childSessionID}): ${clean(item.description)}`
  })
  return `${body}${STILL_RUNNING}${lines.join("\n")}`
}

export const deliver = Effect.fnUntraced(function* <E>(
  sessions: SyntheticSession<E>,
  jobs: Pick<Job.Interface, "completeBackground">,
  input: Pick<Job.Info, "status" | "output" | "error" | "notificationID"> & {
    recovery: Extract<Job.Recovery, { kind: "subagent" }>
  },
) {
  if (input.status === "running") return
  const recovery = input.recovery
  const body =
    input.status === "completed"
      ? (input.output ?? NO_TEXT)
      : input.status === "error"
        ? (input.error ?? "Subagent failed")
        : (input.output ?? input.error ?? "Subagent cancelled")
  // The body is all a recovered outbox row keeps, so the still-running list is how a replay tells this period apart.
  // Only the model-facing tag says "running": the job and the message metadata keep the period's real status.
  const state = input.status === "completed" && body.includes(STILL_RUNNING) ? "running" : input.status
  yield* sessions.synthetic({
    ...(input.notificationID ? { id: input.notificationID } : {}),
    sessionID: recovery.parentSessionID,
    description: recovery.description,
    text: `<subagent sessionID="${recovery.childSessionID}" state="${state}" description="${recovery.description}">\n${body}\n</subagent>`,
    metadata: { source: "subagent", childID: recovery.childSessionID, agent: recovery.agent, state: input.status },
  })
  if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
})

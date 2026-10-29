export * as SubagentCompletion from "./subagent-completion.js"

import { Effect } from "effect"
import type { Job } from "../job.js"
import type { Session } from "../session.js"
import type { SessionMessage } from "./message.js"

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

/** Formats any assistant text and tool activity recorded so far in the child's active turn. */
export function progress(messagesDesc: ReadonlyArray<SessionMessage.Info>): string | undefined {
  const turn: SessionMessage.Info[] = []
  for (const message of messagesDesc) {
    if (message.type === "idle" || message.type === "user") break
    turn.unshift(message)
  }
  const texts: string[] = []
  const calls: string[] = []
  for (const message of turn) {
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type === "text" && part.text.trim().length > 0) texts.push(part.text)
      if (part.type === "tool" && part.state.status !== "streaming")
        calls.push(`[${part.state.status}] ${part.name}`)
    }
  }
  const sections = [
    ...(texts.length > 0 ? [texts.join("\n\n")] : []),
    ...(texts.length === 0 && calls.length > 0 ? [calls.join("\n")] : []),
  ]
  return sections.length > 0 ? sections.join("\n\n") : undefined
}

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

export * as ForkNotice from "./fork-notice.js"

import { DateTime, Effect } from "effect"
import type { Session } from "@opencode/schema/session"
import type { Job } from "../job.js"
import type { SessionMessage } from "./message.js"

export type Subagent = {
  readonly sessionID: string
  readonly description: string
  readonly state: string
}

const outstanding = "These subagents of the original were still outstanding when this fork was made:"

const closing =
  "Don't wait for these. Their results won't arrive here. Start a new subagent if this fork needs that work."

/**
 * Names the original's work that keeps reporting to the original: background
 * launches in the copied history with no later report, and children that still
 * hold a running subagent job.
 */
export const collect = (input: {
  readonly messages: readonly SessionMessage.Info[]
  readonly children: readonly Session.Info[]
  readonly jobs: Pick<Job.Interface, "get">
}): Effect.Effect<readonly Subagent[]> =>
  Effect.gen(function* () {
    // Map order keeps transcript order for launched entries while deduping by child.
    const subagents = new Map<string, Subagent>()
    input.messages.forEach((message, index) => {
      if (message.type !== "assistant") return
      for (const part of message.content) {
        if (part.type !== "tool" || part.name !== "subagent" || part.state.status === "streaming") continue
        if (part.state.input.background !== true) continue
        const sessionID = part.state.metadata?.sessionID
        if (typeof sessionID !== "string" || subagents.has(sessionID)) continue
        if (input.messages.slice(index + 1).some((later) => mentions(later, report(sessionID)))) continue
        const description = part.state.input.description
        subagents.set(sessionID, {
          sessionID,
          description: typeof description === "string" ? description : "subagent",
          state: "unreported",
        })
      }
    })
    for (const child of input.children) {
      const job = yield* input.jobs.get(child.id)
      // Finished jobs stay in the in-memory map, so only a running job is outstanding.
      if (job?.type !== "subagent" || job.status !== "running") continue
      subagents.set(child.id, {
        sessionID: child.id,
        description: job.title ?? child.title ?? "subagent",
        state: job.status,
      })
    }
    return [...subagents.values()]
  })

/** Includes the closing quote so one child id cannot prefix-match another. */
const report = (sessionID: string) => `<subagent sessionID="${sessionID}"`

const mentions = (message: SessionMessage.Info, needle: string) => {
  if (message.type !== "assistant") return "text" in message && message.text.includes(needle)
  return message.content.some((part) => {
    if (part.type === "text") return part.text.includes(needle)
    if (part.type !== "tool" || part.state.status === "streaming") return false
    if (!("content" in part.state)) return false
    return (part.state.content ?? []).some((content) => content.type === "text" && content.text.includes(needle))
  })
}

export const text = (input: {
  readonly forkOf: Session.ID
  readonly title?: string
  readonly time: number
  readonly subagents: readonly Subagent[]
}) => {
  const title = input.title === undefined ? "untitled" : `"${input.title}"`
  const first =
    `This session is a fork of ${input.forkOf} (${title}), copied through its message at ` +
    `${DateTime.formatIso(DateTime.makeUnsafe(input.time))}; work started before the fork keeps reporting to the original, not here.`
  if (input.subagents.length === 0) return first
  return [
    first,
    "",
    outstanding,
    ...input.subagents.map((subagent) => `- ${subagent.sessionID} "${subagent.description}" (${subagent.state})`),
    "",
    closing,
  ].join("\n")
}

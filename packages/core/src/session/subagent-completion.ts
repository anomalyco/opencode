export * as SubagentCompletion from "./subagent-completion.js"

import { Effect } from "effect"
import { BackgroundResult } from "./background-result.js"
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
  return `${body}${STILL_RUNNING}${background.map((item) => line(item, childSessionID)).join("\n")}`
}

/** One running background item as a list line, naming the session it runs in when that is not `owner`. */
export function line(item: RunningBackgroundItem, owner: SessionSchema.ID) {
  const location = item.sessionID !== owner ? `, in ${item.sessionID}` : ""
  if (item.kind === "codemode") return `- Code Mode script (${item.jobID}${location})`
  if (item.kind === "shell") return `- shell (${item.shellID}${location}): ${clean(item.command)}`
  if (item.kind === "image") return `- image (${item.model}${location}): ${item.path}`
  if (item.kind === "video") return `- video (${item.path}${location})`
  return `- subagent (${item.agent}, sessionID: ${item.childSessionID}): ${clean(item.description)}`
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
  // Older rows lack the snapshot. Replay their recorded job status and preserve the full report body.
  const state = input.status === "completed" && recovery.outstanding?.length ? "running" : input.status
  const formatted = formatBody(body, recovery.childSessionID, recovery.outstanding)
  yield* sessions.synthetic({
    ...(input.notificationID ? { id: input.notificationID } : {}),
    sessionID: recovery.parentSessionID,
    description: recovery.description,
    text: BackgroundResult.render(
      `kind="subagent" sessionID="${recovery.childSessionID}" state="${state}" description="${recovery.description}"`,
      formatted,
    ),
    metadata: { source: "subagent", childID: recovery.childSessionID, agent: recovery.agent, state: input.status },
  })
  if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
})

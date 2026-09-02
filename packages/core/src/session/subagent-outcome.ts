export * as SubagentOutcome from "./subagent-outcome.js"

import { Effect, Schema } from "effect"
import type { Session } from "../session.js"
import type { SessionSchema } from "./schema.js"

const NO_TEXT = "Subagent completed without a text response."
export const stopped = "Subagent stopped by user. Do not restart it unless the user asks."

/**
 * How one child execution ended, as the parent's job saw it. Shutdown never settles here: it
 * interrupts the joining run so the job stays `running` and restart resumes the child.
 */
export const Outcome = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("subagent"),
    status: Schema.Literal("completed"),
    text: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("subagent"),
    status: Schema.Literal("interrupted"),
  }),
])
export type Outcome = typeof Outcome.Type

/** Runs or joins the child's execution and reports how it ended, with its final assistant text. */
export const run = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "resume" | "messages">,
  childID: SessionSchema.ID,
) {
  const terminal = yield* sessions.resume(childID)
  if (terminal.type === "interrupted") return { kind: "subagent", status: "interrupted" } as const
  // Concatenate the child's final completed assistant text. "Completed with no text" is a
  // completion; a failed run is the job's error, not an outcome.
  const messages = yield* sessions.messages({ sessionID: childID, order: "desc", limit: 20 })
  const assistant = messages.find(
    (message) => message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
  )
  const text =
    assistant?.type === "assistant"
      ? assistant.content
          .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join("")
      : ""
  return { kind: "subagent", status: "completed", text: text.length > 0 ? text : NO_TEXT } as const
})

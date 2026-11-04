export * as MessageContext from "./message-context.js"

import { MessageOrigin } from "@opencode/schema/message-origin"
import type { Session } from "@opencode/schema/session"
import { Option, Schema } from "effect"

export const ORIGIN = MessageOrigin.Key

const decodeOrigin = Schema.decodeUnknownOption(MessageOrigin.Info)

/** The stored origin of a user message, or undefined when it has none or it doesn't decode. */
export const origin = (metadata?: Readonly<Record<string, unknown>>) =>
  metadata === undefined ? undefined : Option.getOrUndefined(decodeOrigin(metadata[ORIGIN]))

/** Prompt metadata for a message one session sends another. */
export const fromSession = (sessionID: Session.ID) => ({
  [ORIGIN]: { from: `session:${sessionID}` } satisfies MessageOrigin.Info,
})

/** Prompt metadata for a message a schedule sends when it fires. */
export const fromSchedule = (scheduleID: string) => ({
  [ORIGIN]: { from: `schedule:${scheduleID}` } satisfies MessageOrigin.Info,
})

/** Prompt metadata for a message the server expands from a slash command the person ran. */
export const viaCommand = (name: string) => ({
  [ORIGIN]: { via: `command:${name}` } satisfies MessageOrigin.Info,
})

const escapeAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

// Values are IDs, never titles, so a message's line never changes once admitted and the prompt cache holds.
const originLine = (value: MessageOrigin.Info) =>
  `<message-origin ${[
    value.from === undefined ? `via="${escapeAttribute(value.via)}"` : `from="${escapeAttribute(value.from)}"`,
    ...(value.actor === undefined ? [] : [`actor="${escapeAttribute(value.actor)}"`]),
  ].join(" ")}/>`

// Metadata keys the agent reads. History drops them all when `experimental.message_context` is off, so rendering
// never needs to check the flag.
export const keys = [ORIGIN]

/** The lines the agent reads before a user message's text, or "" when its metadata has none. */
export const format = (metadata?: Readonly<Record<string, unknown>>) => {
  const value = origin(metadata)
  return value === undefined ? "" : originLine(value)
}

/** A user message's text with its context lines before it. */
export const withText = (metadata: Readonly<Record<string, unknown>> | undefined, text: string) =>
  [format(metadata), text].filter(Boolean).join("\n")

/** Whether the person who owns the session sent the message, directly or through another surface. */
export const fromPerson = (metadata?: Readonly<Record<string, unknown>>) => {
  const value = origin(metadata)
  return value === undefined || (value.from === undefined && value.actor === undefined)
}

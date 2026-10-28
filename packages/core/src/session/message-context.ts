export * as MessageContext from "./message-context.js"

import { Session } from "@opencode/schema/session"
import { Option, Schema } from "effect"

/** Who sent a user message, stored under {@link ORIGIN} in its metadata. */
export const ORIGIN = "opencode.origin"

export const SessionOrigin = Schema.Struct({
  kind: Schema.Literal("session"),
  sessionID: Session.ID,
  // The sender's title when the message arrived, set by the server. It never changes afterwards, so the line the
  // agent reads stays the same and the prompt cache holds; clients show the sender's current title instead.
  title: Schema.optional(Schema.String),
})
export type SessionOrigin = typeof SessionOrigin.Type

export const ToolOrigin = Schema.Struct({
  kind: Schema.Literal("tool"),
  name: Schema.String,
})

export const Origin = Schema.Union([SessionOrigin, ToolOrigin])
export type Origin = typeof Origin.Type

export const decodeOrigin = Schema.decodeUnknownOption(Origin)

/** Prompt metadata for a message one session sends another. */
export const fromSession = (sessionID: Session.ID) => ({
  [ORIGIN]: { kind: "session", sessionID } satisfies Origin,
})

type Formatter = (value: unknown) => string | undefined

const MAX_NAME_LENGTH = 100

/** A title or name on one line, trimmed and at most 100 characters, or undefined when nothing is left. */
export const cleanName = (value: string | undefined) => {
  const cleaned = Array.from((value ?? "").replace(/\s+/g, " ").trim())
  if (cleaned.length === 0) return undefined
  return cleaned.slice(0, MAX_NAME_LENGTH).join("").trim()
}

const escapeAttribute = (value: string) =>
  value
    .replace(/[\r\n]+/g, " ")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

const tag = (name: string, attributes: Record<string, string>) =>
  `<${name} ${Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(" ")}/>`

const origin: Formatter = (value) => {
  const decoded = Option.getOrUndefined(decodeOrigin(value))
  if (decoded === undefined) return undefined
  if (decoded.kind === "tool") {
    const name = cleanName(decoded.name)
    return name === undefined ? undefined : tag("message-origin", { tool: name })
  }
  const title = cleanName(decoded.title)
  return tag("message-origin", { session: decoded.sessionID, ...(title === undefined ? {} : { title }) })
}

// Metadata keys the agent reads, each with a pure formatter. History drops them all when
// `experimental.message_context` is off, so a formatter never needs to check the flag.
const formatters: Record<string, Formatter> = {
  [ORIGIN]: origin,
}

export const keys = Object.keys(formatters)

/** The lines the agent reads before a user message's text, or "" when its metadata has none. */
export const format = (metadata?: Readonly<Record<string, unknown>>) =>
  metadata === undefined
    ? ""
    : Object.entries(formatters)
        .flatMap(([key, line]) => line(metadata[key]) ?? [])
        .join("\n")

/** A user message's text with its context lines before it. */
export const withText = (metadata: Readonly<Record<string, unknown>> | undefined, text: string) =>
  [format(metadata), text].filter(Boolean).join("\n")

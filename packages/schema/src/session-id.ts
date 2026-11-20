import { Schema } from "effect"
import { Identifier, descending } from "./identifier.js"
import { statics } from "./schema.js"

export const SessionID = Schema.String.check(Schema.isStartingWith("ses")).pipe(
  Schema.brand("SessionID"),
  Schema.annotate({ identifier: "Session.ID" }),
  statics((schema) => ({
    create: () => schema.make(prefix + descending()),
  })),
)
export type SessionID = typeof SessionID.Type

/** The prefix every session ID carries. */
const prefix = "ses_"

/**
 * Recognizes a search term that names a session rather than a title. A session ID carries the "ses_" prefix, so a term
 * that starts with it is an ID lookup. The check is on the prefix alone, so a partial ID still matches.
 */
export function looksLikeSessionID(value: string) {
  return value.startsWith(prefix)
}

/** The length of a session ID: the prefix and the identifier that follows it. */
export const IDLength = prefix.length + Identifier.length

/** Recognizes a complete session ID. */
export function isSessionID(value: string) {
  return value.length === IDLength && looksLikeSessionID(value)
}

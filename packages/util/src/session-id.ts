export * as SessionID from "./session-id.js"

/**
 * Session IDs carry a fixed prefix, so a search term that starts with it is an ID lookup rather than a title
 * lookup. Without that distinction, a short title query matches the random characters of nearly every ID.
 */
export function looksLikeSessionID(value: string) {
  return value.startsWith("ses_")
}

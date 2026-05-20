/**
 * @-mention parsing for collab suggestions.
 *
 * A token is matched by the regex `(?:^|\s)@([A-Za-z0-9-]{1,39})` —
 * GitHub login charset, 1–39 chars, must be at start-of-string or
 * preceded by whitespace.  Email-style "user@example.com" is NOT
 * matched (no word boundary at the `@`).
 *
 * The router calls broadcastMentions() after every suggestion-creating
 * endpoint (/prompt, /suggest).  For each unique login matched that's
 * also a current participant of the session, we broadcast a
 * collab:mention SSE event the client can use to flash a badge + fire
 * a browser desktop notification.
 */

import type { CollabSession, CollabEvent } from "@opencode-ai/collab"

const MENTION_RE = /(?:^|\s)@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g

/** Extract unique mentioned logins from a free-text string. */
export function extractMentions(text: string): string[] {
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(text)) !== null) {
    const login = m[1]!.toLowerCase()
    seen.add(login)
  }
  return [...seen]
}

/**
 * Filter the extracted mentions to those who are actual participants
 * of the session (case-insensitive match against participant logins).
 * Returns the resolved Participant logins in their canonical case.
 */
export function resolveMentionsToParticipants(
  text: string,
  collabSession: CollabSession,
): string[] {
  const candidates = new Set(extractMentions(text))
  if (candidates.size === 0) return []
  const out: string[] = []
  for (const p of collabSession.participants) {
    if (candidates.has(p.githubLogin.toLowerCase())) out.push(p.githubLogin)
  }
  return out
}

/**
 * Build a short excerpt of the mention's surrounding context.  Centered on
 * the first `@login` occurrence, padded to ~120 chars, with leading/trailing
 * ellipsis when truncated.  Safe to send over the wire — no HTML, no markup
 * besides what was in the original text.
 */
export function buildExcerpt(text: string, mentionedLogin: string, maxLen = 120): string {
  const lower = text.toLowerCase()
  const target = "@" + mentionedLogin.toLowerCase()
  let idx = lower.indexOf(target)
  if (idx === -1) idx = 0
  const half = Math.floor(maxLen / 2)
  let start = Math.max(0, idx - half)
  let end = Math.min(text.length, idx + half)
  let excerpt = text.slice(start, end).replace(/\s+/g, " ").trim()
  if (start > 0) excerpt = "…" + excerpt
  if (end < text.length) excerpt = excerpt + "…"
  return excerpt
}

/**
 * Compose the SSE events for one piece of mention-bearing text — one
 * `collab:mention` event per resolved, non-self participant.  Caller
 * broadcasts each.  The context discriminates between a prompt
 * suggestion (the original site) and a team note (the v2 carrier).
 */
export function mentionsToEvents(input: {
  text: string
  collabSession: CollabSession
  authorLogin: string
  context: { kind: "suggestion"; suggestionId: string } | { kind: "note"; noteId: string }
}): CollabEvent[] {
  const logins = resolveMentionsToParticipants(input.text, input.collabSession)
  return logins
    // Don't notify the author of their own mention.
    .filter((l) => l !== input.authorLogin)
    .map((login): CollabEvent => ({
      type: "collab:mention",
      mentionedLogin: login,
      authorLogin: input.authorLogin,
      context:
        input.context.kind === "suggestion"
          ? {
              kind: "suggestion",
              suggestionId: input.context.suggestionId,
              excerpt: buildExcerpt(input.text, login),
            }
          : {
              kind: "note",
              noteId: input.context.noteId,
              excerpt: buildExcerpt(input.text, login),
            },
    }))
}

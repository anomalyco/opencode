export * as SessionRevert from "./session-revert.js"

// A transcript is in the order the server gave it: by sequence, oldest first. Message IDs do not sort in that order. A
// prompt gets its ID when it is sent and its place when it is delivered, and a caller may choose any ID: scheduled
// prompts (`msg_sch_…`), automations (`msg_aut_…`) and watch notices (`msg_watch_…`) sort after every other message.

/**
 * The messages a revert at `boundary` leaves: those before it in the transcript.
 *
 * `more` says whether the session has older messages that are not loaded. A boundary that is not loaded is then older
 * than every loaded message, and leaves none of them. With the whole transcript loaded, the session no longer has that
 * message (a read already applied the revert, or the server kept the boundary of a revert it committed), so nothing is
 * reverted.
 */
export function beforeRevert<Message extends { readonly id: string }>(
  messages: Message[],
  boundary: string | undefined,
  more: boolean,
): Message[]
export function beforeRevert<Message extends { readonly id: string }>(
  messages: readonly Message[],
  boundary: string | undefined,
  more: boolean,
): readonly Message[]
export function beforeRevert<Message extends { readonly id: string }>(
  messages: readonly Message[],
  boundary: string | undefined,
  more: boolean,
) {
  if (!boundary) return messages
  const index = messages.findIndex((message) => message.id === boundary)
  if (index !== -1) return messages.slice(0, index)
  return more ? [] : messages
}

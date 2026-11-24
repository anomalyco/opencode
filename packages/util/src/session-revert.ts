export * as SessionRevert from "./session-revert.js"

// A transcript is in the order the server gave it: by sequence, oldest first. Message IDs do not sort in that order. A
// prompt gets its ID when it is sent and its place when it is delivered, and a caller may choose any ID: scheduled
// prompts (`msg_sch_…`), automations (`msg_aut_…`) and watch notices (`msg_watch_…`) sort after every other message.

/**
 * The messages a revert at `boundary` leaves: those before it in the transcript. A boundary that is not loaded is older
 * than every loaded message, so it leaves none of them.
 */
export function beforeRevert<Message extends { readonly id: string }>(
  messages: Message[],
  boundary: string | undefined,
): Message[]
export function beforeRevert<Message extends { readonly id: string }>(
  messages: readonly Message[],
  boundary: string | undefined,
): readonly Message[]
export function beforeRevert<Message extends { readonly id: string }>(
  messages: readonly Message[],
  boundary: string | undefined,
) {
  if (!boundary) return messages
  const index = messages.findIndex((message) => message.id === boundary)
  return index === -1 ? [] : messages.slice(0, index)
}

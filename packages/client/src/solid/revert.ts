/** A revert boundary: the message it starts at and, from servers that record it, that message's `seq`. */
export type RevertBoundary = { readonly messageID: string; readonly seq?: number }

/**
 * The messages before a revert boundary. The server reverts by transcript position, so this hides by `seq` too and
 * never compares IDs, which don't follow the transcript: automation and scheduled prompts (`msg_aut_…`,
 * `msg_sch_…`) sort after every other ID, forked copies end in an unpadded `_<seq>`, and a steered or queued prompt
 * keeps the ID it was sent with but joins the transcript after replies with newer IDs.
 *
 * Messages without a `seq` (inputs still in the inbox, or anything from an older server) keep their loaded order
 * around the boundary. Without any `seq` for the boundary, one that isn't loaded is older than every loaded message,
 * since loaded messages are always the newest part of the transcript, so it hides them all.
 */
export function messagesBeforeRevert<T extends { readonly id: string; readonly seq?: number }>(
  messages: readonly T[],
  revert: RevertBoundary,
) {
  const index = messages.findIndex((message) => message.id === revert.messageID)
  const seq = revert.seq ?? messages[index]?.seq

  if (seq === undefined) return index === -1 ? [] : messages.slice(0, index)

  return messages.filter((message, at) => (message.seq === undefined ? index !== -1 && at < index : message.seq < seq))
}

/**
 * The messages before a revert boundary. The server reverts by transcript position, so the boundary message and
 * everything after it are hidden by position too: message IDs are not in transcript order. Automation and scheduled
 * prompts (`msg_aut_…`, `msg_sch_…`) sort after every other ID, and a steered or queued prompt keeps the ID it was
 * sent with but joins the transcript after replies that have newer IDs.
 */
export function messagesBeforeRevert<T extends { readonly id: string }>(messages: readonly T[], boundary: string) {
  const index = messages.findIndex((message) => message.id === boundary)

  // Without the boundary loaded its position is unknown, so comparing IDs is the best guess left.
  if (index === -1) return messages.filter((message) => message.id < boundary)

  return messages.slice(0, index)
}

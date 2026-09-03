export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

/**
 * Returns the first user message after `messageID` by array position.
 * Message ids carry a wrapping time prefix, so the caller's list must be
 * ordered chronologically.
 */
export function nextUserMessageAfter<T extends { id: string; role: string }>(
  messages: readonly T[],
  messageID: string,
): T | undefined {
  const index = messages.findIndex((message) => message.id === messageID)
  if (index < 0) return undefined
  return messages.slice(index + 1).find((message) => message.role === "user")
}

/**
 * Orders sessions by `time.updated` (falling back to `time.created`), newest
 * first, ties by id.
 * Session ids carry a wrapping time prefix, so time is the stable ordering.
 */
export function compareSessionsByTime<T extends { id: string; time: { created: number; updated?: number } }>(
  a: T,
  b: T,
) {
  const aTime = a.time.updated ?? a.time.created
  const bTime = b.time.updated ?? b.time.created
  if (aTime !== bTime) return bTime - aTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

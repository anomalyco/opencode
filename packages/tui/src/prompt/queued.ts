/**
 * User messages submitted while a turn is still running. The server holds them until the
 * turn finishes, so they are only queued while an assistant message is still incomplete.
 */
export function queuedMessages<
  Message extends { id: string; role: string; time: { created: number; completed?: number } },
>(messages: Message[]) {
  const completed = messages.findLast((message) => message.role === "assistant" && message.time.completed)?.id
  const pending = messages.findLast(
    (message) => message.role === "assistant" && !message.time.completed && (!completed || message.id > completed),
  )?.id
  if (!pending) return []
  return messages.filter((message) => message.role === "user" && message.id > pending)
}

export function excludeSideChatHistory<T extends { id: string }>(
  messages: T[],
  initialMessageIDs: ReadonlySet<string> | undefined,
) {
  if (!initialMessageIDs?.size) return messages
  return messages.filter((message) => !initialMessageIDs.has(message.id))
}

import type { AssistantMessage, Message as MessageType } from "@opencode-ai/sdk/v2/client"

/**
 * Find assistant messages that are replies to a given user message.
 *
 * Scans forward from the user message index first, then falls back to scanning
 * backward. The backward scan handles clock skew where assistant messages
 * (generated server-side) sort before the user message (generated client-side
 * with an ahead clock) in the ID-sorted array.
 */
export function findAssistantMessages(
  messages: MessageType[],
  userIndex: number,
  userID: string,
): AssistantMessage[] {
  if (userIndex < 0 || userIndex >= messages.length) return []

  const result: AssistantMessage[] = []

  // Scan forward from user message
  for (let i = userIndex + 1; i < messages.length; i++) {
    const item = messages[i]
    if (!item) continue
    if (item.role === "user") break
    if (item.role === "assistant" && item.parentID === userID) result.push(item as AssistantMessage)
  }

  // Scan backward to find assistant messages that sort before the user
  // message due to clock skew between client and server
  if (result.length === 0) {
    for (let i = userIndex - 1; i >= 0; i--) {
      const item = messages[i]
      if (!item) continue
      if (item.role === "user") break
      if (item.role === "assistant" && item.parentID === userID) result.push(item as AssistantMessage)
    }
  }

  return result
}

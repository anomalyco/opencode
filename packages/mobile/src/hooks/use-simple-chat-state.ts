/**
 * Simplified Chat State Hook - Only handles basic data without streaming
 * Prevents main component re-renders during streaming
 */

import { useCallback } from "react"
import { useLocalSessionQuery } from "@/services/api/local/sessions"
import { useChatService } from "@/services/chat-service"

export interface SimpleChatState {
  // Data
  session: any

  // Actions
  sendMessage: (content: string) => Promise<void>
  refreshMessages: () => Promise<void>
}

export const useSimpleChatState = (sessionId: string): SimpleChatState => {
  // Only get session data - no messages or streaming state
  const { data: session } = useLocalSessionQuery(sessionId)

  // Services
  const chatService = useChatService()

  // Send message handler - no state updates here
  const sendMessage = useCallback(
    async (content: string) => {
      try {
        await chatService.sendMessage(sessionId, content)
      } catch (err) {
        throw err
      }
    },
    [sessionId, chatService],
  )

  // Refresh messages handler - delegates to message list
  const refreshMessages = useCallback(async () => {
    // This will be handled by the message list component
  }, [])

  return {
    // Data
    session,

    // Actions
    sendMessage,
    refreshMessages,
  }
}

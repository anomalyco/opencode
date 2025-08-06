/**
 * Simplified Chat State Hook - Only handles basic data without streaming
 * Prevents main component re-renders during streaming
 */

import { useCallback } from "react"
import { useLocalSessionQuery } from "@/services/api/local/sessions"
import { useChatService } from "@/services/chat-service"
import { useSessionModelSelection } from "@/hooks/use-model-selection"
import type { Session } from "@/db/types"

export interface SimpleChatState {
  // Data
  session: Session | null | undefined

  // Actions
  sendMessage: (content: string, mode?: string) => Promise<void>
  refreshMessages: () => Promise<void>
}

export const useSimpleChatState = (sessionId: string): SimpleChatState => {
  // Only get session data - no messages or streaming state
  const { data: session } = useLocalSessionQuery(sessionId)

  // Get model selection with fallback chain
  const modelSelection = useSessionModelSelection(session)

  // Services
  const chatService = useChatService()

  // Send message handler using model selection hook
  const sendMessage = useCallback(
    async (content: string, mode?: string) => {
      try {
        await chatService.sendMessage(sessionId, content, mode, modelSelection.providerId, modelSelection.modelId)
      } catch (err) {
        throw err
      }
    },
    [sessionId, chatService, modelSelection.providerId, modelSelection.modelId],
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

/**
 * Chat State Hook - Combines local messages, streaming state, and remote sync
 * Single hook to replace multiple useEffects in chat page
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useLocalMessagesWithPartsQuery,
  useUpsertLocalMessageMutation,
  useUpsertLocalMessagePartMutation,
} from "@/services/api/local/messages"
import { useRemoteMessagesQuery } from "@/services/api/remote/messages"
import { useLocalSessionQuery } from "@/services/api/local/sessions"
import { useChatService } from "@/services/chat-service"
import { useSSEService } from "@/services/sse-service"
import type { SSEEvent } from "@/types/opencode-types"
import { queryKeys } from "@/services/api/keys"

export interface ChatState {
  // Data
  messages: any[]
  session: any

  // Loading states
  isLoading: boolean
  isStreaming: boolean
  isSyncing: boolean

  // Error states
  error: string | null

  // Actions
  sendMessage: (content: string, mode?: string) => Promise<void>
  refreshMessages: () => Promise<void>

  // Metrics
  metrics: {
    totalMessages: number
    totalCost: number
    isActive: boolean
  }
}

export const useChatState = (sessionId: string): ChatState => {
  const queryClient = useQueryClient()

  // Local state
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSyncedRemote, setHasSyncedRemote] = useState(false)

  // Refs for cleanup and throttling
  const streamingTimeoutRef = useRef<number | null>(null)
  const sseUnsubscribeRef = useRef<(() => void) | null>(null)
  const updateThrottleRef = useRef<number | null>(null)

  // Data queries
  const { data: messages, isLoading, refetch: refetchMessages } = useLocalMessagesWithPartsQuery(sessionId)
  const { data: session } = useLocalSessionQuery(sessionId)
  const { data: remoteMessages } = useRemoteMessagesQuery(sessionId)

  // Mutations for direct database updates
  const upsertMessageMutation = useUpsertLocalMessageMutation()
  const upsertPartMutation = useUpsertLocalMessagePartMutation()

  // Services
  const chatService = useChatService()
  const sseService = useSSEService()
  // Track last synced count to detect new messages
  const lastSyncedCountRef = useRef(0)

  // Handle direct SSE message updates
  const handleMessageUpdated = useCallback(
    async (properties: any) => {
      const messageInfo = properties?.info
      if (!messageInfo || messageInfo.sessionID !== sessionId) return

      try {
        // Transform message info to local format
        const localMessage = {
          id: messageInfo.id,
          sessionId: messageInfo.sessionID,
          role: messageInfo.role,
          timeCreated: new Date(messageInfo.time?.created || Date.now()),
          timeCompleted: messageInfo.time?.completed ? new Date(messageInfo.time.completed) : null,
          providerId: messageInfo.providerID || null,
          modelId: messageInfo.modelID || null,
          mode: messageInfo.mode || null,
          pathCwd: messageInfo.path?.cwd || null,
          pathRoot: messageInfo.path?.root || null,
          isSummary: false,
          cost: messageInfo.cost || 0,
          tokensInput: messageInfo.tokens?.input || 0,
          tokensOutput: messageInfo.tokens?.output || 0,
          tokensReasoning: messageInfo.tokens?.reasoning || 0,
          tokensCacheRead: messageInfo.tokens?.cache?.read || 0,
          tokensCacheWrite: messageInfo.tokens?.cache?.write || 0,
          errorName: null,
          errorMessage: null,
          errorData: null,
          systemPrompts: null,
          isSynced: true,
          lastSyncTimestamp: new Date(),
        }
        // Upsert message directly to database
        await upsertMessageMutation.mutateAsync(localMessage)
        // Use setQueryData instead of invalidateQueries for better performance
        queryClient.setQueryData(queryKeys.local.messages.listWithParts(sessionId), (oldData: any) => {
          if (!oldData) return oldData
          const existingIndex = oldData.findIndex((msg: any) => msg.id === localMessage.id)
          if (existingIndex >= 0) {
            const newData = [...oldData]
            newData[existingIndex] = localMessage
            return newData
          }
          return [...oldData, localMessage]
        })
      } catch (error) {}
    },
    [sessionId, chatService, queryClient],
  )

  // Handle direct SSE part updates
  const handlePartUpdated = useCallback(
    async (properties: any) => {
      const partInfo = properties?.part
      if (!partInfo || partInfo.sessionID !== sessionId) return

      try {
        // Transform part info to local format
        const localPart = {
          id: partInfo.id,
          messageId: partInfo.messageID,
          sessionId: partInfo.sessionID,
          type: partInfo.type,
          textContent: partInfo.text || null,
          isSynthetic: false,
          timeStart: partInfo.time?.start ? new Date(partInfo.time.start) : null,
          timeEnd: partInfo.time?.end ? new Date(partInfo.time.end) : null,
          // File fields
          fileMime: null,
          fileFilename: null,
          fileUrl: null,
          fileSourceType: null,
          fileSourcePath: null,
          fileSourceTextValue: null,
          fileSourceTextStart: null,
          fileSourceTextEnd: null,
          fileSourceName: null,
          fileSourceKind: null,
          fileSourceRange: null,
          // Tool fields
          toolCallId: partInfo.callID || null,
          toolName: partInfo.tool || null,
          toolStatus: partInfo.state?.status || null,
          toolInput: partInfo.state?.input ? JSON.stringify(partInfo.state.input) : null,
          toolOutput: partInfo.state?.output || null,
          toolTitle: partInfo.state?.title || null,
          toolMetadata: partInfo.state?.metadata ? JSON.stringify(partInfo.state.metadata) : null,
          toolError: partInfo.state?.error || null,
          toolTimeStart: partInfo.state?.time?.start ? new Date(partInfo.state.time.start) : null,
          toolTimeEnd: partInfo.state?.time?.end ? new Date(partInfo.state.time.end) : null,
          // Step fields
          stepCost: partInfo.cost || null,
          stepTokensInput: partInfo.tokens?.input || null,
          stepTokensOutput: partInfo.tokens?.output || null,
          stepTokensReasoning: partInfo.tokens?.reasoning || null,
          stepTokensCacheRead: partInfo.tokens?.cache?.read || null,
          stepTokensCacheWrite: partInfo.tokens?.cache?.write || null,
          // Snapshot fields
          snapshotId: null,
          // Patch fields
          patchHash: null,
          patchFiles: null,
          // Local metadata
          isSynced: true,
          lastSyncTimestamp: new Date(),
        }
        // Upsert part directly to database
        await upsertPartMutation.mutateAsync(localPart)

        // Immediately invalidate the query after database update
        queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.sessionParts(sessionId) })

        // Also throttle additional updates to prevent too many refreshes
        if (updateThrottleRef.current) {
          clearTimeout(updateThrottleRef.current)
        }
        updateThrottleRef.current = window.setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.sessionParts(sessionId) })
        }, 100) // Backup update every 100ms
      } catch (error) {}
    },
    [sessionId, chatService, queryClient],
  )

  // Sync remote messages when count changes
  useEffect(() => {
    const currentCount = remoteMessages?.length || 0
    const lastSyncedCount = lastSyncedCountRef.current

    // Sync if we have new messages (count increased) or haven't synced yet
    if (remoteMessages && currentCount > 0 && (currentCount > lastSyncedCount || !hasSyncedRemote)) {
      chatService
        .syncRemoteMessages(sessionId, remoteMessages)
        .then(() => {
          lastSyncedCountRef.current = currentCount
          setHasSyncedRemote(true)
          refetchMessages()
        })
        .catch(() => {
          setError("Failed to sync messages")
        })
    }
  }, [remoteMessages, hasSyncedRemote, sessionId, chatService, refetchMessages])

  // Handle SSE events for real-time updates
  useEffect(() => {
    const handleSSEEvent = (event: SSEEvent) => {
      switch (event.type) {
        case "session.idle":
          setIsStreaming(false)
          if (streamingTimeoutRef.current) {
            window.clearTimeout(streamingTimeoutRef.current)
            streamingTimeoutRef.current = null
          }
          // Final update when streaming completes
          queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.sessionParts(sessionId) })
          break

        case "message.updated":
          setIsStreaming(true)
          // Reset streaming timeout
          if (streamingTimeoutRef.current) {
            window.clearTimeout(streamingTimeoutRef.current)
          }
          streamingTimeoutRef.current = window.setTimeout(() => {
            setIsStreaming(false)
          }, 30000) // 30 second timeout

          // Immediately invalidate query for real-time updates
          queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.sessionParts(sessionId) })

          // Handle message update directly from SSE data
          handleMessageUpdated(event.properties)
          break

        case "message.part.updated":
          setIsStreaming(true)
          // Reset streaming timeout
          if (streamingTimeoutRef.current) {
            window.clearTimeout(streamingTimeoutRef.current)
          }
          streamingTimeoutRef.current = window.setTimeout(() => {
            setIsStreaming(false)
          }, 30000) // 30 second timeout

          // Immediately invalidate query for real-time updates
          queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.sessionParts(sessionId) })

          // Handle part update directly from SSE data
          handlePartUpdated(event.properties)
          break
        case "session.error":
          setIsStreaming(false)
          setError((event as any).properties?.error?.message || "Session error")
          break
      }
    }

    // Subscribe to session-specific events
    sseUnsubscribeRef.current = sseService.subscribeToSession(sessionId, handleSSEEvent)

    return () => {
      if (sseUnsubscribeRef.current) {
        sseUnsubscribeRef.current()
      }
      if (streamingTimeoutRef.current) {
        window.clearTimeout(streamingTimeoutRef.current)
      }
      if (updateThrottleRef.current) {
        window.clearTimeout(updateThrottleRef.current)
      }
    }
  }, [sessionId, sseService, refetchMessages])

  // Send message handler
  const sendMessage = useCallback(
    async (content: string, mode?: string) => {
      try {
        setError(null)
        setIsStreaming(true)

        // Set streaming timeout
        if (streamingTimeoutRef.current) {
          window.clearTimeout(streamingTimeoutRef.current)
        }
        streamingTimeoutRef.current = window.setTimeout(() => {
          setIsStreaming(false)
        }, 30000)

        await chatService.sendMessage(sessionId, content, mode)
      } catch (err) {
        setIsStreaming(false)
        setError(err instanceof Error ? err.message : "Failed to send message")
        throw err
      }
    },
    [sessionId, chatService],
  )

  // Refresh messages handler
  const refreshMessages = useCallback(async () => {
    try {
      setError(null)
      await refetchMessages()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh messages")
      throw err
    }
  }, [refetchMessages])

  // Calculate metrics
  const metrics = {
    totalMessages: messages?.length || 0,
    totalCost: chatService.calculateMetrics(messages || []).totalCost,
    isActive: sseService.isSessionActive(sessionId),
  }

  // Check if sync is in progress
  const isSyncing = chatService.isSyncInProgress(sessionId)

  return {
    // Data
    messages: messages || [],
    session,

    // Loading states
    isLoading,
    isStreaming,
    isSyncing,

    // Error states
    error,

    // Actions
    sendMessage,
    refreshMessages,

    // Metrics
    metrics,
  }
}

/**
 * Hook for remote messages with single fetch strategy
 * Replaces multiple useEffects with one-time fetch
 */
export const useRemoteMessages = (sessionId: string) => {
  const [hasFetched, setHasFetched] = useState(false)

  const query = useRemoteMessagesQuery(sessionId)

  // Mark as fetched when data is received
  useEffect(() => {
    if (query.data && !hasFetched) {
      setHasFetched(true)
    }
  }, [query.data, hasFetched])

  return {
    ...query,
    hasFetched,
  }
}

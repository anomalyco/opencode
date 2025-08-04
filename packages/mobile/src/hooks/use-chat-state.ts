/**
 * Chat State Hook - Combines local messages, streaming state, and remote sync
 * Single hook to replace multiple useEffects in chat page
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useLocalMessagesQuery,
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
  sendMessage: (content: string) => Promise<void>
  refreshMessages: () => Promise<void>

  // Metrics
  metrics: {
    totalMessages: number
    totalCost: number
    isActive: boolean
  }
}

export const useChatState = (sessionId: string): ChatState => {
  console.log(`[useChatState] Hook called for session: ${sessionId}`)

  const queryClient = useQueryClient()

  // Local state
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSyncedRemote, setHasSyncedRemote] = useState(false)

  // Refs for cleanup
  const streamingTimeoutRef = useRef<number | null>(null)
  const sseUnsubscribeRef = useRef<(() => void) | null>(null)

  // Data queries
  const { data: messages, isLoading, refetch: refetchMessages } = useLocalMessagesQuery(sessionId)
  const { data: session } = useLocalSessionQuery(sessionId)
  const { data: remoteMessages, error: remoteError } = useRemoteMessagesQuery(sessionId)

  // Mutations for direct database updates
  const upsertMessageMutation = useUpsertLocalMessageMutation()
  const upsertPartMutation = useUpsertLocalMessagePartMutation()

  // Debug remote messages
  console.log(`[useChatState] Remote query result:`, {
    remoteMessages: remoteMessages?.length || 0,
    remoteError,
    firstMessage: remoteMessages?.[0]
      ? {
          hasInfo: !!remoteMessages[0].info,
          hasParts: !!remoteMessages[0].parts,
          partsCount: remoteMessages[0].parts?.length || 0,
          infoId: remoteMessages[0].info?.id,
          firstPartType: remoteMessages[0].parts?.[0]?.type,
        }
      : null,
  })

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

      console.log("[useChatState] Handling message.updated directly:", messageInfo.id)

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
        // Invalidate local messages query to trigger re-render
        queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.list(sessionId) })
      } catch (error) {
        console.error("[useChatState] Error handling message.updated:", error)
      }
    },
    [sessionId, chatService, queryClient],
  )

  // Handle direct SSE part updates
  const handlePartUpdated = useCallback(
    async (properties: any) => {
      const partInfo = properties?.part
      if (!partInfo || partInfo.sessionID !== sessionId) return

      console.log("[useChatState] Handling message.part.updated directly:", partInfo.id)

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
        // Invalidate local messages query to trigger re-render
        queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.list(sessionId) })
      } catch (error) {
        console.error("[useChatState] Error handling message.part.updated:", error)
      }
    },
    [sessionId, chatService, queryClient],
  )

  // Sync remote messages when count changes
  useEffect(() => {
    const currentCount = remoteMessages?.length || 0
    const lastSyncedCount = lastSyncedCountRef.current

    console.log(
      `[useChatState] Remote messages:`,
      currentCount,
      "lastSynced:",
      lastSyncedCount,
      "hasSyncedRemote:",
      hasSyncedRemote,
    )

    // Sync if we have new messages (count increased) or haven't synced yet
    if (remoteMessages && currentCount > 0 && (currentCount > lastSyncedCount || !hasSyncedRemote)) {
      console.log(
        `[useChatState] Starting sync for ${currentCount} remote messages (${currentCount - lastSyncedCount} new)`,
      )

      chatService
        .syncRemoteMessages(sessionId, remoteMessages)
        .then(() => {
          console.log(`[useChatState] Sync completed, refetching local messages`)
          lastSyncedCountRef.current = currentCount
          setHasSyncedRemote(true)
          refetchMessages()
        })
        .catch((err) => {
          console.error("Failed to sync remote messages:", err)
          setError("Failed to sync messages")
        })
    }
  }, [remoteMessages, hasSyncedRemote, sessionId, chatService, refetchMessages])

  // Handle SSE events for real-time updates
  useEffect(() => {
    const handleSSEEvent = (event: SSEEvent) => {
      // Filter system prompts from logs
      const logProps = { ...event.properties }
      if ((logProps as any)?.info?.system) {
        ;(logProps as any).info.system = "[SYSTEM_PROMPT_HIDDEN]"
      }
      console.log("[useChatState] SSE Event received:", event.type, logProps)

      switch (event.type) {
        case "session.idle":
          setIsStreaming(false)
          if (streamingTimeoutRef.current) {
            window.clearTimeout(streamingTimeoutRef.current)
            streamingTimeoutRef.current = null
          }
          // Refetch local messages when streaming completes
          refetchMessages()
          break

        case "message.updated":
          console.log("[useChatState] Processing message.updated event")
          setIsStreaming(true)
          // Reset streaming timeout
          if (streamingTimeoutRef.current) {
            window.clearTimeout(streamingTimeoutRef.current)
          }
          streamingTimeoutRef.current = window.setTimeout(() => {
            setIsStreaming(false)
          }, 30000) // 30 second timeout

          // Handle message update directly from SSE data
          handleMessageUpdated(event.properties)
          break

        case "message.part.updated":
          console.log("[useChatState] Processing message.part.updated event")
          setIsStreaming(true)
          // Reset streaming timeout
          if (streamingTimeoutRef.current) {
            window.clearTimeout(streamingTimeoutRef.current)
          }
          streamingTimeoutRef.current = window.setTimeout(() => {
            setIsStreaming(false)
          }, 30000) // 30 second timeout

          // Handle part update directly from SSE data
          handlePartUpdated(event.properties)
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

          // Directly sync streaming part using ChatService transformation
          const streamingPartInfo = (event.properties as any)?.part
          if (streamingPartInfo) {
            console.log("[useChatState] Upserting streaming part:", streamingPartInfo.id, streamingPartInfo.type)
            const fakeRemoteMessage = {
              info: {
                id: streamingPartInfo.messageID,
                sessionID: streamingPartInfo.sessionID,
                role: "assistant",
                time: { created: Date.now() / 1000 },
              },
              parts: [streamingPartInfo],
            }
            chatService.syncRemoteMessages(sessionId, [fakeRemoteMessage]).catch(console.error)
          }
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

          // Sync the streaming part data immediately
          const partInfo = (event.properties as any)?.part
          if (partInfo) {
            console.log("[useChatState] Syncing streaming part:", partInfo.id, partInfo.type)
            // Create a fake remote message structure with just this part
            const fakeRemoteMessage = {
              info: {
                id: partInfo.messageID,
                sessionID: partInfo.sessionID,
                role: "assistant", // Parts are typically from assistant
                time: { created: Date.now() / 1000 },
              },
              parts: [partInfo],
            }
            chatService
              .syncRemoteMessages(sessionId, [fakeRemoteMessage])
              .then(() => refetchMessages())
              .catch(console.error)
          }
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
    }
  }, [sessionId, sseService, refetchMessages])

  // Send message handler
  const sendMessage = useCallback(
    async (content: string) => {
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

        await chatService.sendMessage(sessionId, content)
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

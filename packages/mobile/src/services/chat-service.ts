/**
 * Chat Service - Handles all message operations and syncing
 * Moves complex logic out of UI components
 */

import type { MessageWithParts, SendMessageRequest, ChatMetrics } from "@/types/opencode-types"
import { useUpsertLocalMessageMutation, useUpsertLocalMessagePartMutation } from "@/services/api/local/messages"
import { useSendRemoteMessageMutation } from "@/services/api/remote/messages"
import { useLocalUserSettingsQuery } from "@/services/api/local/config"

export interface ChatServiceConfig {
  defaultProviderId?: string
  defaultModelId?: string
  autoSync?: boolean
  retryAttempts?: number
}

export class ChatService {
  private config: ChatServiceConfig
  private syncInProgress = new Set<string>()
  private messageCache = new Map<string, MessageWithParts[]>()

  constructor(config: ChatServiceConfig = {}) {
    this.config = {
      defaultProviderId: "anthropic",
      defaultModelId: "claude-sonnet-4-20250514",
      autoSync: true,
      retryAttempts: 3,
      ...config,
    }
  }

  /**
   * Sync remote messages to local database
   * Only syncs once per session to avoid memory issues
   */
  async syncRemoteMessages(
    sessionId: string,
    remoteMessages: any[],
    upsertLocalMessage: any,
    upsertLocalMessagePart: any,
  ): Promise<void> {
    if (this.syncInProgress.has(sessionId)) {
      return
    }

    this.syncInProgress.add(sessionId)

    try {
      for (const remoteMessage of remoteMessages) {
        await this.syncSingleMessage(remoteMessage, upsertLocalMessage, upsertLocalMessagePart)
      }
    } catch (error) {
      // Handle specific error types gracefully
      if (this.isRecoverableError(error)) {
        return
      }

      throw error
    } finally {
      this.syncInProgress.delete(sessionId)
    }
  }

  /**
   * Sync a single remote message to local database
   */
  private async syncSingleMessage(
    remoteMessage: any,
    upsertLocalMessage: any,
    upsertLocalMessagePart: any,
  ): Promise<void> {
    const localMessage = this.transformRemoteToLocalMessage(remoteMessage)

    try {
      await upsertLocalMessage.mutateAsync(localMessage)

      // Sync message parts if they exist - use batching for large messages
      if (remoteMessage.parts && Array.isArray(remoteMessage.parts)) {
        const partsCount = remoteMessage.parts.length

        if (partsCount > 50) {
          // Batch process large messages to prevent UI blocking
          await this.syncMessagePartsBatched(remoteMessage.parts, upsertLocalMessagePart)
        } else {
          // Process smaller messages normally
          await this.syncMessagePartsSequential(remoteMessage.parts, upsertLocalMessagePart)
        }
      }
    } catch (error) {
      // Handle specific error types
      if (this.isRecoverableError(error)) {
        return
      }

      throw error
    }
  }

  /**
   * Transform remote message format to local database format
   */
  private transformRemoteToLocalMessage(remoteMessage: any): any {
    // Use remote timestamp for proper ordering
    const remoteCreatedTime = remoteMessage.info?.time?.created
    // Check if timestamp is already in milliseconds (> year 2000 in seconds)
    const isMilliseconds = remoteCreatedTime && remoteCreatedTime > 946684800000
    const createdAt = remoteCreatedTime
      ? new Date(isMilliseconds ? remoteCreatedTime : remoteCreatedTime * 1000)
      : new Date()

    return {
      id: remoteMessage.info?.id,
      sessionId: remoteMessage.info?.sessionID,
      role: remoteMessage.info?.role,
      timeCreated: createdAt,
      timeCompleted: remoteMessage.info?.time?.completed
        ? new Date(
            remoteMessage.info.time.completed > 946684800000
              ? remoteMessage.info.time.completed
              : remoteMessage.info.time.completed * 1000,
          )
        : null,
      providerId: remoteMessage.info?.providerID || null,
      modelId: remoteMessage.info?.modelID || null,
      mode: remoteMessage.info?.mode || null,
      pathCwd: remoteMessage.info?.path?.cwd || null,
      pathRoot: remoteMessage.info?.path?.root || null,
      isSummary: Boolean(remoteMessage.info?.summary),
      cost: Number(remoteMessage.info?.cost || 0),
      tokensInput: Number(remoteMessage.info?.tokens?.input || 0),
      tokensOutput: Number(remoteMessage.info?.tokens?.output || 0),
      tokensReasoning: Number(remoteMessage.info?.tokens?.reasoning || 0),
      tokensCacheRead: Number(remoteMessage.info?.tokens?.cache?.read || 0),
      tokensCacheWrite: Number(remoteMessage.info?.tokens?.cache?.write || 0),
      errorName: remoteMessage.info?.error?.name || null,
      errorMessage: remoteMessage.info?.error?.message || null,
      errorData: remoteMessage.info?.error?.data ? JSON.stringify(remoteMessage.info.error.data) : null,
      systemPrompts: remoteMessage.info?.system ? JSON.stringify(remoteMessage.info.system) : null,
      isSynced: true,
      lastSyncTimestamp: new Date(),
    }
  }

  /**
   * Transform remote part format to local database format
   */
  private transformRemoteToLocalPart(remotePart: any, orderIndex?: number): any {
    // Use order index to preserve sequence - add seconds to ensure proper ordering
    const startTime = remotePart.time?.start
    const isMilliseconds = startTime && startTime > 946684800000
    const baseTime = startTime ? new Date(isMilliseconds ? startTime : startTime * 1000) : new Date()

    // Add seconds (not milliseconds) to preserve order while keeping timestamps readable
    const orderedTime = orderIndex !== undefined ? new Date(baseTime.getTime() + orderIndex * 1000) : baseTime

    return {
      id: remotePart.id,
      messageId: remotePart.messageID,
      sessionId: remotePart.sessionID,
      type: remotePart.type,

      // Text content
      textContent: remotePart.text || null,
      isSynthetic: Boolean(remotePart.synthetic),

      // File content
      fileFilename: remotePart.filename || null,
      fileMime: remotePart.mime || null,
      fileUrl: remotePart.url || null,

      // Tool content
      toolName: remotePart.tool || null,
      toolCallId: remotePart.callID || null,
      toolStatus: remotePart.state?.status || null,
      toolInput: remotePart.state?.input ? JSON.stringify(remotePart.state.input) : null,
      toolOutput: remotePart.state?.output || null,
      toolMetadata: remotePart.state?.metadata ? JSON.stringify(remotePart.state.metadata) : null,
      toolError: remotePart.state?.error || null,

      // Timing
      timeStart: orderedTime,
      timeEnd: remotePart.time?.end
        ? new Date(remotePart.time.end > 946684800000 ? remotePart.time.end : remotePart.time.end * 1000)
        : null,

      // Sync metadata
      isSynced: true,
      lastSyncTimestamp: new Date(),
    }
  }

  /**
   * Send a message to the remote server
   */
  async sendMessage(sessionId: string, content: string, sendMessageMutation: any, userSettings?: any): Promise<void> {
    const providerID = userSettings?.defaultProviderId || this.config.defaultProviderId
    const modelID = userSettings?.defaultModelId || this.config.defaultModelId

    const request: SendMessageRequest = {
      providerID: providerID!,
      modelID: modelID!,
      parts: [
        {
          type: "text",
          text: content,
        },
      ],
    }

    try {
      await sendMessageMutation.mutateAsync({
        sessionId,
        data: request,
      })
    } catch (error) {
      throw error
    }
  }

  /**
   * Calculate chat metrics for a session
   */
  calculateMetrics(messages: any[]): ChatMetrics {
    return messages.reduce(
      (metrics, message) => ({
        totalMessages: metrics.totalMessages + 1,
        totalCost: metrics.totalCost + (message.cost || 0),
        totalTokens: {
          input: metrics.totalTokens.input + (message.tokensInput || 0),
          output: metrics.totalTokens.output + (message.tokensOutput || 0),
          reasoning: metrics.totalTokens.reasoning + (message.tokensReasoning || 0),
          cacheRead: metrics.totalTokens.cacheRead + (message.tokensCacheRead || 0),
          cacheWrite: metrics.totalTokens.cacheWrite + (message.tokensCacheWrite || 0),
        },
      }),
      {
        totalMessages: 0,
        totalCost: 0,
        totalTokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
    )
  }

  /**
   * Clear cache for a session
   */
  clearSessionCache(sessionId: string): void {
    this.messageCache.delete(sessionId)
    this.syncInProgress.delete(sessionId)
  }

  /**
   * Get sync status for a session
   */
  isSyncInProgress(sessionId: string): boolean {
    return this.syncInProgress.has(sessionId)
  }

  /**
   * Process message parts sequentially for smaller messages
   */
  private async syncMessagePartsSequential(parts: any[], upsertLocalMessagePart: any): Promise<void> {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const localPart = this.transformRemoteToLocalPart(part, i)
      await upsertLocalMessagePart.mutateAsync(localPart)
    }
  }

  /**
   * Process message parts in batches to prevent UI blocking
   */
  private async syncMessagePartsBatched(parts: any[], upsertLocalMessagePart: any): Promise<void> {
    const BATCH_SIZE = 10
    const BATCH_DELAY = 50 // ms delay between batches

    for (let i = 0; i < parts.length; i += BATCH_SIZE) {
      const batch = parts.slice(i, i + BATCH_SIZE)

      // Process batch in parallel
      const batchPromises = batch.map(async (part, batchIndex) => {
        const globalIndex = i + batchIndex
        const localPart = this.transformRemoteToLocalPart(part, globalIndex)

        try {
          await upsertLocalMessagePart.mutateAsync(localPart)
        } catch (error) {
          if (this.isRecoverableError(error)) {
            return
          }
          throw error
        }
      })

      await Promise.all(batchPromises)

      // Small delay to prevent UI blocking
      if (i + BATCH_SIZE < parts.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY))
      }
    }
  }

  /**
   * Check if an error is recoverable (shouldn't crash the app)
   */
  private isRecoverableError(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || ""
    const errorName = error?.name?.toLowerCase() || ""

    // Common recoverable errors
    const recoverableErrors = [
      "request was aborted",
      "token exceeded",
      "network error",
      "timeout",
      "connection refused",
      "fetch failed",
      "aborted",
      "cancelled",
      "constraint",
      "unique constraint",
    ]

    return recoverableErrors.some(
      (recoverable) => errorMessage.includes(recoverable) || errorName.includes(recoverable),
    )
  }
}

// Singleton instance
export const chatService = new ChatService()

/**
 * Hook to use the chat service with React Query mutations
 */
export const useChatService = () => {
  const upsertLocalMessage = useUpsertLocalMessageMutation()
  const upsertLocalMessagePart = useUpsertLocalMessagePartMutation()
  const sendMessage = useSendRemoteMessageMutation()
  const { data: userSettings } = useLocalUserSettingsQuery()

  return {
    syncRemoteMessages: (sessionId: string, remoteMessages: any[]) =>
      chatService.syncRemoteMessages(sessionId, remoteMessages, upsertLocalMessage, upsertLocalMessagePart),

    sendMessage: (sessionId: string, content: string) =>
      chatService.sendMessage(sessionId, content, sendMessage, userSettings),

    calculateMetrics: (messages: any[]) => chatService.calculateMetrics(messages),

    clearSessionCache: (sessionId: string) => chatService.clearSessionCache(sessionId),

    isSyncInProgress: (sessionId: string) => chatService.isSyncInProgress(sessionId),
  }
}

/**
 * Chat Service - Handles all message operations and syncing
 * Moves complex logic out of UI components
 */

import type { MessageWithParts, ChatMetrics } from "@/types/opencode-types"
import { useUpsertLocalMessageMutation, useUpsertLocalMessagePartMutation } from "@/services/api/local/messages"
import { useSendRemoteMessageMutation, type SendMessageRequest } from "@/services/api/remote/messages"
// User settings functionality temporarily removed - will be re-implemented later

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
      defaultModelId: "claude-3-5-sonnet-20241022", // Use a more standard model ID
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
      console.log(`Sync already in progress for session ${sessionId}`)
      return
    }

    console.log(`Starting sync for session ${sessionId} with ${remoteMessages.length} messages`)
    this.syncInProgress.add(sessionId)

    try {
      let syncedMessages = 0
      let syncedParts = 0

      for (const remoteMessage of remoteMessages) {
        await this.syncSingleMessage(remoteMessage, upsertLocalMessage, upsertLocalMessagePart)
        syncedMessages++
        syncedParts += remoteMessage.parts?.length || 0
      }

      console.log(`Sync completed for session ${sessionId}: ${syncedMessages} messages, ${syncedParts} parts`)
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
    const messageId = remoteMessage.info?.id
    console.log(`Syncing message ${messageId} (${remoteMessage.info?.role})`)

    const localMessage = this.transformRemoteToLocalMessage(remoteMessage)

    // Skip if transformation returned null (invalid message)
    if (!localMessage) {
      console.log(`Skipping invalid message ${messageId}`)
      return
    }

    try {
      await upsertLocalMessage.mutateAsync(localMessage)
      console.log(`Message ${messageId} synced successfully`)

      // Sync message parts if they exist - use batching for large messages
      if (remoteMessage.parts && Array.isArray(remoteMessage.parts)) {
        const partsCount = remoteMessage.parts.length
        console.log(`Syncing ${partsCount} parts for message ${messageId}`)

        if (partsCount > 50) {
          // Batch process large messages to prevent UI blocking
          await this.syncMessagePartsBatched(remoteMessage.parts, upsertLocalMessagePart)
        } else {
          // Process smaller messages normally
          await this.syncMessagePartsSequential(remoteMessage.parts, upsertLocalMessagePart)
        }

        console.log(`All ${partsCount} parts synced for message ${messageId}`)
      } else {
        console.log(`No parts to sync for message ${messageId}`)
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
  public transformRemoteToLocalMessage(remoteMessage: any): any | null {
    // Log the complete message data we're now receiving
    // console.log("Complete message data received:", JSON.stringify(remoteMessage, null, 2))

    // Log what enhanced data we're now capturing
    const enhancedFields = []
    if (remoteMessage.info?.error) enhancedFields.push("error")
    if (remoteMessage.info?.system) enhancedFields.push("system")
    if (remoteMessage.info?.modelID) enhancedFields.push("modelID")
    if (remoteMessage.info?.providerID) enhancedFields.push("providerID")
    if (remoteMessage.info?.mode) enhancedFields.push("mode")
    if (remoteMessage.info?.path) enhancedFields.push("path")
    if (remoteMessage.info?.cost) enhancedFields.push("cost")
    if (remoteMessage.info?.tokens) enhancedFields.push("tokens")

    if (enhancedFields.length > 0) {
      console.log(`Enhanced message data captured: ${enhancedFields.join(", ")}`)
    }

    // Validate required fields - log warnings but don't crash
    if (!remoteMessage?.info?.id) {
      console.log("Warning: Message missing info.id, using fallback")
      // Generate a fallback ID to prevent crashes
      remoteMessage = {
        ...remoteMessage,
        info: {
          ...remoteMessage?.info,
          id: `fallback-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        },
      }
    }

    if (!remoteMessage?.info?.sessionID) {
      console.log("Warning: Message missing info.sessionID, skipping sync")
      return null // Return null to skip this message
    }

    if (!remoteMessage?.info?.role) {
      console.log("Warning: Message missing info.role, defaulting to 'assistant'")
      remoteMessage = {
        ...remoteMessage,
        info: {
          ...remoteMessage?.info,
          role: "assistant",
        },
      }
    }
    // Use remote timestamp for proper ordering
    const remoteCreatedTime = remoteMessage.info?.time?.created
    const isMilliseconds = remoteCreatedTime && remoteCreatedTime > 946684800000

    let createdAt: Date
    if (remoteCreatedTime) {
      createdAt = new Date(isMilliseconds ? remoteCreatedTime : remoteCreatedTime * 1000)
    } else {
      // If no timestamp provided, use current time
      // For streaming assistant messages, this ensures they appear after user messages
      createdAt = new Date()
      console.log("⚠️ No timestamp provided for message, using current time:", createdAt.toISOString())
    }

    // Log message details for debugging
    const firstTextPart = remoteMessage.parts?.find((p: any) => p.type === "text")
    const textPreview = firstTextPart?.text ? firstTextPart.text.substring(0, 50) + "..." : "No text"
    console.log(
      `📝 Message sync: ID=${remoteMessage.info?.id}, Role=${remoteMessage.info?.role}, Time=${createdAt.toISOString()}, Text="${textPreview}"`,
    )

    return {
      id: remoteMessage.info?.id,
      sessionId: remoteMessage.info?.sessionID,
      role: remoteMessage.info?.role,
      timeCreated: createdAt.getTime(), // Store as milliseconds for precise ordering
      timeCompleted: remoteMessage.info?.time?.completed
        ? remoteMessage.info.time.completed > 946684800000
          ? remoteMessage.info.time.completed
          : remoteMessage.info.time.completed * 1000
        : null,
      providerId: remoteMessage.info?.providerID || null,
      modelId: remoteMessage.info?.modelID || null,
      mode: remoteMessage.info?.mode || null,
      pathCwd: remoteMessage.info?.path?.cwd || null,
      pathRoot: remoteMessage.info?.path?.root || null,
      isSummary: Boolean(remoteMessage.info?.summary),
      cost: this.safeNumber(remoteMessage.info?.cost),
      tokensInput: this.safeNumber(remoteMessage.info?.tokens?.input),
      tokensOutput: this.safeNumber(remoteMessage.info?.tokens?.output),
      tokensReasoning: this.safeNumber(remoteMessage.info?.tokens?.reasoning),
      tokensCacheRead: this.safeNumber(remoteMessage.info?.tokens?.cache?.read),
      tokensCacheWrite: this.safeNumber(remoteMessage.info?.tokens?.cache?.write),
      errorName: remoteMessage.info?.error?.name || null,
      errorMessage: remoteMessage.info?.error?.message || null,
      errorData: this.safeJsonStringify(remoteMessage.info?.error?.data),
      systemPrompts: this.safeJsonStringify(remoteMessage.info?.system),
      isSynced: true,
      lastSyncTimestamp: new Date(),
    }
  }

  /**
   * Transform remote part format to local database format
   */
  public transformRemoteToLocalPart(remotePart: any, orderIndex?: number): any | null {
    console.log("Complete part data received:", JSON.stringify(remotePart, null, 2))

    // Validate required fields - log warnings but don't crash
    if (!remotePart?.id) {
      console.log("Warning: Part missing id, using fallback")
      remotePart = {
        ...remotePart,
        id: `fallback-part-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      }
    }

    if (!remotePart?.messageID) {
      console.log("Warning: Part missing messageID, skipping sync")
      return null // Return null to skip this part
    }

    if (!remotePart?.sessionID) {
      console.log("Warning: Part missing sessionID, skipping sync")
      return null // Return null to skip this part
    }

    if (!remotePart?.type) {
      console.log("Warning: Part missing type, defaulting to 'text'")
      remotePart = {
        ...remotePart,
        type: "text",
      }
    }
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
      fileSourceType: remotePart.source?.type || null,
      fileSourcePath: remotePart.source?.path || null,
      fileSourceTextValue: remotePart.source?.text?.value || null,
      fileSourceTextStart: remotePart.source?.text?.start || null,
      fileSourceTextEnd: remotePart.source?.text?.end || null,
      fileSourceName: remotePart.source?.name || null, // for symbol sources
      fileSourceKind: remotePart.source?.kind || null, // for symbol sources
      fileSourceRange: this.safeJsonStringify(remotePart.source?.range),

      // Tool content
      toolName: remotePart.tool || null,
      toolCallId: remotePart.callID || null,
      toolStatus: remotePart.state?.status || null,
      toolInput: this.safeJsonStringify(remotePart.state?.input),
      toolOutput: remotePart.state?.output || null,
      toolTitle: remotePart.state?.title || null,
      toolMetadata: this.safeJsonStringify(remotePart.state?.metadata),
      toolError: remotePart.state?.error || null,
      toolTimeStart: remotePart.state?.time?.start
        ? new Date(
            remotePart.state.time.start > 946684800000
              ? remotePart.state.time.start
              : remotePart.state.time.start * 1000,
          )
        : null,
      toolTimeEnd: remotePart.state?.time?.end
        ? new Date(
            remotePart.state.time.end > 946684800000 ? remotePart.state.time.end : remotePart.state.time.end * 1000,
          )
        : null,

      // Step finish part fields
      stepCost: remotePart.cost ? this.safeNumber(remotePart.cost) : null,
      stepTokensInput: remotePart.tokens?.input ? this.safeNumber(remotePart.tokens.input) : null,
      stepTokensOutput: remotePart.tokens?.output ? this.safeNumber(remotePart.tokens.output) : null,
      stepTokensReasoning: remotePart.tokens?.reasoning ? this.safeNumber(remotePart.tokens.reasoning) : null,
      stepTokensCacheRead: remotePart.tokens?.cache?.read ? this.safeNumber(remotePart.tokens.cache.read) : null,
      stepTokensCacheWrite: remotePart.tokens?.cache?.write ? this.safeNumber(remotePart.tokens.cache.write) : null,

      // Snapshot part fields
      snapshotId: remotePart.snapshot || null,

      // Patch part fields
      patchHash: remotePart.hash || null,
      patchFiles: this.safeJsonStringify(remotePart.files),

      // Timing
      timeStart: orderedTime,
      timeEnd: remotePart.time?.end
        ? new Date(remotePart.time.end > 946684800000 ? remotePart.time.end : remotePart.time.end * 1000)
        : null,

      // Sync metadata
      isSynced: true,
      lastSyncTimestamp: new Date(),

      // Sequence for proper ordering
      sequence: orderIndex ?? 0,
    }
  }

  /**
   * Send a message to the remote server
   */
  async sendMessage(
    sessionId: string,
    content: string,
    sendMessageMutation: any,
    userSettings?: any,
    mode?: string,
  ): Promise<void> {
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
      ...(mode && { mode }), // Include mode if provided
    }

    try {
      await sendMessageMutation.mutateAsync({
        sessionId,
        data: request,
      })
    } catch (error) {
      // Ignore HTTP errors since messages are processed via SSE
      console.log("Message send HTTP error (message may still process via SSE):", error)
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

      // Skip if transformation returned null (invalid part)
      if (localPart) {
        await upsertLocalMessagePart.mutateAsync(localPart)
      }
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

        // Skip if transformation returned null (invalid part)
        if (!localPart) {
          return
        }

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
   * Safely stringify JSON data with error handling
   */
  private safeJsonStringify(data: any): string | null {
    if (data === null || data === undefined) {
      return null
    }

    try {
      return JSON.stringify(data)
    } catch (error) {
      console.error("Failed to stringify JSON data:", error, data)
      return null
    }
  }

  /**
   * Safely parse numeric values with fallback
   */
  private safeNumber(value: any, fallback: number = 0): number {
    if (value === null || value === undefined) {
      return fallback
    }

    const parsed = Number(value)
    return isNaN(parsed) ? fallback : parsed
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
  // User settings temporarily removed
  const userSettings = null

  return {
    syncRemoteMessages: (sessionId: string, remoteMessages: any[]) =>
      chatService.syncRemoteMessages(sessionId, remoteMessages, upsertLocalMessage, upsertLocalMessagePart),

    sendMessage: (sessionId: string, content: string, mode?: string) =>
      chatService.sendMessage(sessionId, content, sendMessage, userSettings, mode),

    calculateMetrics: (messages: any[]) => chatService.calculateMetrics(messages),

    clearSessionCache: (sessionId: string) => chatService.clearSessionCache(sessionId),

    isSyncInProgress: (sessionId: string) => chatService.isSyncInProgress(sessionId),

    // Expose transformation methods for streaming
    transformRemoteToLocalMessage: (remoteMessage: any) => chatService.transformRemoteToLocalMessage(remoteMessage),
    transformRemoteToLocalPart: (remotePart: any, orderIndex?: number) =>
      chatService.transformRemoteToLocalPart(remotePart, orderIndex),
  }
}

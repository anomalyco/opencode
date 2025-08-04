/**
 * Batched SQLite Writer - High-performance batch operations
 * Reduces SQLite contention during streaming by batching writes
 */

import { eq } from "drizzle-orm"
import db from "@/db"
import { messages, messageParts, sessions } from "@/db/schema"
import type { Message, MessagePart } from "@/db/types"

interface BatchUpdate {
  type: "message" | "messagePart" | "session"
  data: any
}

export class BatchWriter {
  private static instance: BatchWriter
  private pendingUpdates = new Map<string, BatchUpdate>()
  private flushTimer: number | null = null
  private readonly FLUSH_DELAY = 50 // ms - faster for real-time updates
  private readonly MAX_BATCH_SIZE = 10 // smaller batches for faster updates

  private constructor() {}

  static getInstance(): BatchWriter {
    if (!BatchWriter.instance) {
      BatchWriter.instance = new BatchWriter()
    }
    return BatchWriter.instance
  }

  /**
   * Add message update to batch
   */
  addMessage(message: Omit<Message, "createdAt" | "updatedAt">): void {
    this.pendingUpdates.set(`message:${message.id}`, {
      type: "message",
      data: message,
    })
    this.scheduleFlush()
  }

  /**
   * Add message part update to batch
   */
  addMessagePart(part: Omit<MessagePart, "createdAt" | "updatedAt">): void {
    this.pendingUpdates.set(`part:${part.id}`, {
      type: "messagePart",
      data: part,
    })
    this.scheduleFlush()
  }

  /**
   * Add session timestamp update to batch
   */
  addSessionUpdate(sessionId: string): void {
    this.pendingUpdates.set(`session:${sessionId}`, {
      type: "session",
      data: { id: sessionId, updatedAt: new Date() },
    })
    this.scheduleFlush()
  }

  /**
   * Schedule flush or flush immediately if batch is full
   */
  private scheduleFlush(): void {
    if (this.pendingUpdates.size >= this.MAX_BATCH_SIZE) {
      this.flush()
      return
    }

    if (this.flushTimer) return

    this.flushTimer = window.setTimeout(() => {
      this.flush()
    }, this.FLUSH_DELAY)
  }

  /**
   * Flush all pending updates in a single transaction with retry logic
   */
  private async flush(): Promise<void> {
    if (this.pendingUpdates.size === 0) return

    // Clear timer
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    // Get updates and clear pending
    const updates = Array.from(this.pendingUpdates.values())
    this.pendingUpdates.clear()

    let retryCount = 0
    const maxRetries = 3

    while (retryCount <= maxRetries) {
      try {
        await db.transaction(async (tx) => {
          // Group updates by type for efficient processing
          const messageUpdates: any[] = []
          const partUpdates: any[] = []
          const sessionUpdates: any[] = []

          for (const update of updates) {
            switch (update.type) {
              case "message":
                messageUpdates.push({
                  ...update.data,
                  createdAt: update.data.timeCreated || new Date(),
                  updatedAt: new Date(),
                })
                break
              case "messagePart":
                partUpdates.push({
                  ...update.data,
                  createdAt: update.data.timeStart || new Date(),
                  updatedAt: new Date(),
                })
                break
              case "session":
                sessionUpdates.push(update.data)
                break
            }
          }

          // Batch upsert messages
          for (const message of messageUpdates) {
            await tx
              .insert(messages)
              .values(message)
              .onConflictDoUpdate({
                target: messages.id,
                set: {
                  role: message.role,
                  timeCreated: message.timeCreated,
                  timeCompleted: message.timeCompleted,
                  providerId: message.providerId,
                  modelId: message.modelId,
                  mode: message.mode,
                  isSynced: message.isSynced,
                  lastSyncTimestamp: message.lastSyncTimestamp,
                  updatedAt: new Date(),
                },
              })
          }

          // Batch upsert message parts
          for (const part of partUpdates) {
            await tx
              .insert(messageParts)
              .values(part)
              .onConflictDoUpdate({
                target: messageParts.id,
                set: {
                  sessionId: part.sessionId,
                  messageId: part.messageId,
                  type: part.type,
                  textContent: part.textContent,
                  isSynthetic: part.isSynthetic,
                  timeStart: part.timeStart,
                  timeEnd: part.timeEnd,
                  isSynced: part.isSynced,
                  lastSyncTimestamp: part.lastSyncTimestamp,
                  fileMime: part.fileMime,
                  fileFilename: part.fileFilename,
                  fileUrl: part.fileUrl,
                  fileSourceType: part.fileSourceType,
                  fileSourcePath: part.fileSourcePath,
                  fileSourceTextValue: part.fileSourceTextValue,
                  fileSourceTextStart: part.fileSourceTextStart,
                  fileSourceTextEnd: part.fileSourceTextEnd,
                  fileSourceName: part.fileSourceName,
                  fileSourceKind: part.fileSourceKind,
                  fileSourceRange: part.fileSourceRange,
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  toolStatus: part.toolStatus,
                  toolInput: part.toolInput,
                  toolOutput: part.toolOutput,
                  toolTitle: part.toolTitle,
                  toolMetadata: part.toolMetadata,
                  toolError: part.toolError,
                  toolTimeStart: part.toolTimeStart,
                  toolTimeEnd: part.toolTimeEnd,
                  stepCost: part.stepCost,
                  stepTokensInput: part.stepTokensInput,
                  stepTokensOutput: part.stepTokensOutput,
                  stepTokensReasoning: part.stepTokensReasoning,
                  stepTokensCacheRead: part.stepTokensCacheRead,
                  stepTokensCacheWrite: part.stepTokensCacheWrite,
                  snapshotId: part.snapshotId,
                  patchHash: part.patchHash,
                  patchFiles: part.patchFiles,
                  updatedAt: new Date(),
                },
              })
          }

          // Batch update session timestamps
          for (const sessionUpdate of sessionUpdates) {
            await tx
              .update(sessions)
              .set({ updatedAt: sessionUpdate.updatedAt })
              .where(eq(sessions.id, sessionUpdate.id))
          }
        })
        return // Success, exit retry loop
      } catch (error) {
        retryCount++
        console.error(`Batch write failed (attempt ${retryCount}/${maxRetries + 1}):`, error)

        if (retryCount > maxRetries) {
          // Final failure - re-add updates for later retry
          console.error("Batch write failed after all retries, re-queuing updates")
          for (const update of updates) {
            if (update.type === "message") {
              this.pendingUpdates.set(`message:${update.data.id}`, update)
            } else if (update.type === "messagePart") {
              this.pendingUpdates.set(`part:${update.data.id}`, update)
            } else if (update.type === "session") {
              this.pendingUpdates.set(`session:${update.data.id}`, update)
            }
          }
          // Schedule retry with exponential backoff
          setTimeout(() => this.scheduleFlush(), Math.min(1000 * Math.pow(2, retryCount), 10000))
          return
        }

        // Wait before retry with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, retryCount)))
      }
    }
  }

  /**
   * Force flush all pending updates immediately
   */
  async forceFlush(): Promise<void> {
    await this.flush()
  }

  /**
   * Get pending update count for debugging
   */
  getPendingCount(): number {
    return this.pendingUpdates.size
  }
}

export const batchWriter = BatchWriter.getInstance()

/**
 * ============================================================================
 * @ai-context/compressor - Storage Interface
 * ============================================================================
 *
 * Abstract storage interface for persisting messages.
 */

import type { Message } from '../core/types.js'

/**
 * Storage interface for message persistence
 *
 * Implementations can store messages in memory, files, databases, etc.
 */
export interface StorageInterface {
  /**
   * Get all messages for a session
   *
   * @param sessionId - Session identifier
   * @returns Array of messages (empty if not found)
   */
  getMessages(sessionId: string): Promise<Message[]>

  /**
   * Add a message to a session
   *
   * @param sessionId - Session identifier
   * @param message - Message to add
   */
  addMessage(sessionId: string, message: Message): Promise<void>

  /**
   * Update an existing message
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   * @param message - Updated message
   */
  updateMessage(sessionId: string, messageId: string, message: Message): Promise<void>

  /**
   * Delete a message
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   */
  deleteMessage(sessionId: string, messageId: string): Promise<void>

  /**
   * Clear all messages in a session
   *
   * @param sessionId - Session identifier
   */
  clear(sessionId: string): Promise<void>

  /**
   * List all session IDs
   *
   * @returns Array of session IDs
   */
  listSessions(): Promise<string[]>

  /**
   * Check if a session exists
   *
   * @param sessionId - Session identifier
   * @returns True if session exists
   */
  hasSession(sessionId: string): Promise<boolean>
}

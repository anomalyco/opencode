/**
 * ============================================================================
 * @ai-context/compressor - Memory Storage
 * ============================================================================
 *
 * In-memory storage implementation.
 */

import type { Message } from '../core/types.js'
import type { StorageInterface } from './interface.js'

/**
 * In-memory message storage
 *
 * Stores messages in a Map. Useful for single-process applications
 * and testing.
 */
export class MemoryStorage implements StorageInterface {
  #sessions = new Map<string, Message[]>()

  async getMessages(sessionId: string): Promise<Message[]> {
    return (this.#sessions.get(sessionId) ?? []).slice() // Return copy
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    let messages = this.#sessions.get(sessionId)
    if (!messages) {
      messages = []
      this.#sessions.set(sessionId, messages)
    }
    messages.push(message)
  }

  async updateMessage(sessionId: string, messageId: string, message: Message): Promise<void> {
    const messages = this.#sessions.get(sessionId)
    if (!messages) return

    const index = messages.findIndex((m) => m.id === messageId)
    if (index === -1) return

    messages[index] = message
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const messages = this.#sessions.get(sessionId)
    if (!messages) return

    const index = messages.findIndex((m) => m.id === messageId)
    if (index === -1) return

    messages.splice(index, 1)
  }

  async clear(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId)
  }

  async listSessions(): Promise<string[]> {
    return Array.from(this.#sessions.keys())
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return this.#sessions.has(sessionId)
  }

  /**
   * Get total messages across all sessions
   */
  getTotalMessages(): number {
    let total = 0
    for (const messages of this.#sessions.values()) {
      total += messages.length
    }
    return total
  }

  /**
   * Clear all sessions
   */
  clearAll(): void {
    this.#sessions.clear()
  }
}

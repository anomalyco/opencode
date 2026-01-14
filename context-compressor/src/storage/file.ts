/**
 * ============================================================================
 * @ai-context/compressor - File Storage
 * ============================================================================
 *
 * File-based persistent storage implementation.
 */

import type { Message } from '../core/types.js'
import type { StorageInterface } from './interface.js'

/**
 * File-based message storage
 *
 * Stores messages as JSON files in a directory structure.
 * Each session is stored as a separate JSON file.
 */
export class FileStorage implements StorageInterface {
  #sessions = new Map<string, Message[]>()
  #dirty = new Set<string>()

  constructor(
    /** Base directory for storage */
    private readonly baseDir: string = '.context-compressor'
  ) {}

  async #loadSession(sessionId: string): Promise<void> {
    if (this.#sessions.has(sessionId)) return

    try {
      const path = this.#getPath(sessionId)
      // Use Bun if available, otherwise fallback
      const hasBun = typeof (globalThis as any).Bun !== 'undefined'
      if (hasBun) {
        const Bun = (globalThis as any).Bun as any
        const file = Bun.file(path)
        const exists = await file.exists()
        if (exists) {
          const text = await file.text()
          const messages = JSON.parse(text) as Message[]
          this.#sessions.set(sessionId, messages)
        } else {
          this.#sessions.set(sessionId, [])
        }
      } else {
        // Node.js fallback
        const fs = await import('fs/promises')
        try {
          const text = await fs.readFile(path, 'utf-8')
          const messages = JSON.parse(text) as Message[]
          this.#sessions.set(sessionId, messages)
        } catch {
          this.#sessions.set(sessionId, [])
        }
      }
    } catch {
      this.#sessions.set(sessionId, [])
    }
  }

  async #saveSession(sessionId: string): Promise<void> {
    if (!this.#dirty.has(sessionId)) return

    const messages = this.#sessions.get(sessionId)
    if (!messages) return

    const path = this.#getPath(sessionId)
    const text = JSON.stringify(messages, null, 2)

    // Ensure directory exists
    const hasBun = typeof (globalThis as any).Bun !== 'undefined'
    if (hasBun) {
      // Bun
      const Bun = (globalThis as any).Bun as any
      await Bun.write(path, text)
    } else {
      // Node.js
      const fs = await import('fs/promises')
      const pathModule = await import('path')
      const dir = pathModule.dirname(path)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path, text, 'utf-8')
    }

    this.#dirty.delete(sessionId)
  }

  #getPath(sessionId: string): string {
    // Sanitize session ID for filename
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return `${this.baseDir}/${safeId}.json`
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    await this.#loadSession(sessionId)
    return (this.#sessions.get(sessionId) ?? []).slice()
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    await this.#loadSession(sessionId)
    const messages = this.#sessions.get(sessionId)!
    messages.push(message)
    this.#dirty.add(sessionId)
    await this.#saveSession(sessionId)
  }

  async updateMessage(sessionId: string, messageId: string, message: Message): Promise<void> {
    await this.#loadSession(sessionId)
    const messages = this.#sessions.get(sessionId)
    if (!messages) return

    const index = messages.findIndex((m) => m.id === messageId)
    if (index === -1) return

    messages[index] = message
    this.#dirty.add(sessionId)
    await this.#saveSession(sessionId)
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    await this.#loadSession(sessionId)
    const messages = this.#sessions.get(sessionId)
    if (!messages) return

    const index = messages.findIndex((m) => m.id === messageId)
    if (index === -1) return

    messages.splice(index, 1)
    this.#dirty.add(sessionId)
    await this.#saveSession(sessionId)
  }

  async clear(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId)
    this.#dirty.delete(sessionId)

    // Delete file
    const path = this.#getPath(sessionId)
    try {
      const hasBun = typeof (globalThis as any).Bun !== 'undefined'
      if (hasBun) {
        const Bun = (globalThis as any).Bun as any
        const file = Bun.file(path)
        const exists = await file.exists()
        if (exists) {
          await Bun.write(path, '')
        }
      } else {
        const fs = await import('fs/promises')
        await fs.unlink(path).catch(() => {})
      }
    } catch {
      // Ignore
    }
  }

  async listSessions(): Promise<string[]> {
    // List JSON files in base directory
    const sessions: string[] = []

    try {
      const hasBun = typeof (globalThis as any).Bun !== 'undefined'
      if (hasBun) {
        const Bun = (globalThis as any).Bun as any
        const glob = new Bun.Glob('*.json')
        for await (const file of glob.scan({ cwd: this.baseDir })) {
          sessions.push(file.replace('.json', ''))
        }
      } else {
        const fs = await import('fs/promises')
        const files = await fs.readdir(this.baseDir)
        for (const file of files) {
          if (file.endsWith('.json')) {
            sessions.push(file.replace('.json', ''))
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return sessions
  }

  async hasSession(sessionId: string): Promise<boolean> {
    await this.#loadSession(sessionId)
    return this.#sessions.has(sessionId)
  }

  /**
   * Save all pending changes
   */
  async flush(): Promise<void> {
    const promises = Array.from(this.#dirty).map((id) => this.#saveSession(id))
    await Promise.all(promises)
  }
}

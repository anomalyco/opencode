/**
 * Session Pool
 *
 * Manages a pool of OpenCode sessions, enabling concurrent task execution.
 * The orchestrator borrows sessions from this pool and returns them when done,
 * similar to a database connection pool.
 *
 * Pool strategy:
 * - Sessions are pre-warmed by role (build, explore, plan)
 * - Idle sessions are reused to avoid startup overhead
 * - Sessions that have been idle too long are recycled
 * - Max concurrent sessions per role is configurable
 */

import type { OpenCodeAdapter, SessionRole, SessionHandle } from "./adapter.ts"

export interface PoolConfig {
  /** Max sessions per role */
  maxPerRole?: number
  /** Idle timeout in ms before recycling a session */
  idleTimeoutMs?: number
}

interface PoolEntry {
  handle: SessionHandle
  inUse: boolean
  queuedResolvers: Array<(handle: SessionHandle) => void>
}

const DEFAULT_MAX_PER_ROLE = 3
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Session pool that manages lifecycle of OpenCode sessions per role.
 * Allows the orchestrator to run multiple coding tasks concurrently.
 */
export class SessionPool {
  private pool = new Map<string, PoolEntry[]>()
  private config: Required<PoolConfig>
  private recycleTimer: ReturnType<typeof setInterval>

  constructor(
    private adapter: OpenCodeAdapter,
    config: PoolConfig = {},
  ) {
    this.config = {
      maxPerRole: config.maxPerRole ?? DEFAULT_MAX_PER_ROLE,
      idleTimeoutMs: config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    }

    // Periodically recycle idle sessions
    this.recycleTimer = setInterval(() => this.recycleIdle(), 60_000)
  }

  /**
   * Acquire a session for a given role. If no idle sessions exist and the
   * pool is not full, a new session is created. Otherwise waits for one.
   */
  async acquire(role: SessionRole, title?: string): Promise<SessionHandle> {
    let entries = this.pool.get(role)
    if (!entries) {
      entries = []
      this.pool.set(role, entries)
    }

    // Find an idle session
    const idle = entries.find((e) => !e.inUse)
    if (idle) {
      idle.inUse = true
      idle.handle.lastUsedAt = new Date()
      return idle.handle
    }

    // If under the limit, create a new session
    if (entries.length < this.config.maxPerRole) {
      const handle = await this.adapter.createSession(role, title)
      const entry: PoolEntry = { handle, inUse: true, queuedResolvers: [] }
      entries.push(entry)
      return handle
    }

    // Wait for a session to be released
    return new Promise<SessionHandle>((resolve) => {
      // Find entry with shortest queue
      const entry = entries!.reduce((min, e) => (e.queuedResolvers.length < min.queuedResolvers.length ? e : min))
      entry.queuedResolvers.push(resolve)
    })
  }

  /**
   * Release a session back to the pool so it can be used by another task.
   */
  release(sessionId: string) {
    for (const entries of this.pool.values()) {
      const entry = entries.find((e) => e.handle.id === sessionId)
      if (!entry) continue

      // If there are waiters, hand the session to the next one
      const next = entry.queuedResolvers.shift()
      if (next) {
        entry.handle.lastUsedAt = new Date()
        next(entry.handle)
        return
      }

      entry.inUse = false
      return
    }
  }

  /**
   * Use a session for a scoped operation and automatically release it.
   */
  async use<T>(role: SessionRole, fn: (sessionId: string) => Promise<T>, title?: string): Promise<T> {
    const handle = await this.acquire(role, title)
    try {
      return await fn(handle.id)
    } finally {
      this.release(handle.id)
    }
  }

  /**
   * Get current pool stats (useful for monitoring)
   */
  stats() {
    const result: Record<string, { total: number; inUse: number; waiting: number }> = {}
    for (const [role, entries] of this.pool) {
      const inUse = entries.filter((e) => e.inUse).length
      const waiting = entries.reduce((sum, e) => sum + e.queuedResolvers.length, 0)
      result[role] = { total: entries.length, inUse, waiting }
    }
    return result
  }

  private async recycleIdle() {
    const now = Date.now()
    for (const [role, entries] of this.pool) {
      const toRecycle = entries.filter(
        (e) => !e.inUse && now - e.handle.lastUsedAt.getTime() > this.config.idleTimeoutMs,
      )
      for (const entry of toRecycle) {
        await this.adapter.deleteSession(entry.handle.id).catch(() => {})
        const idx = entries.indexOf(entry)
        if (idx !== -1) entries.splice(idx, 1)
      }
      if (entries.length === 0) this.pool.delete(role)
    }
  }

  destroy() {
    clearInterval(this.recycleTimer)
  }
}

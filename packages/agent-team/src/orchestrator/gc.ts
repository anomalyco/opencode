import path from "path"
import fs from "fs"
import type { AgentID } from "../protocol/messages.js"
import { AuditLogger } from "./audit.js"

export class GC {
  private dir: string
  private audit: AuditLogger
  private cleanupTimeoutMs: number
  private gcIntervalMs: number
  private deadLetterRetentionDays: number
  private interval: ReturnType<typeof setInterval> | null = null

  constructor(
    dir: string,
    audit: AuditLogger,
    config?: { cleanupTimeoutMs?: number; gcIntervalMs?: number; deadLetterRetentionDays?: number },
  ) {
    this.dir = dir
    this.audit = audit
    this.cleanupTimeoutMs = config?.cleanupTimeoutMs ?? 259200000
    this.gcIntervalMs = config?.gcIntervalMs ?? 3600000
    this.deadLetterRetentionDays = config?.deadLetterRetentionDays ?? 7
  }

  async tick(agentWorktrees: Map<AgentID, string[]>): Promise<{ cleaned: string[] }> {
    const cleaned: string[] = []
    const now = Date.now()
    for (const [agentId, worktrees] of agentWorktrees) {
      for (const wt of worktrees) {
        try {
          const stat = await fs.promises.stat(wt)
          if (now - stat.mtimeMs > this.cleanupTimeoutMs) {
            await this.cleanupWorktree(agentId, wt)
            cleaned.push(wt)
          }
        } catch {}
      }
    }
    await this.cleanDeadLetters()
    return { cleaned }
  }

  async cleanupWorktree(agentId: AgentID, worktreePath: string): Promise<void> {
    await this.audit.append({
      agent: agentId,
      action: "gc.worktree.cleanup",
      target: worktreePath,
      details: { reason: "inactive" },
    })
    try {
      await fs.promises.rm(worktreePath, { recursive: true, force: true })
    } catch {}
  }

  async checkDiskQuota(agentId: AgentID, workspacePath: string, quotaMb: number): Promise<boolean> {
    const bytes = await this.calculateDiskUsage(workspacePath)
    const mb = bytes / (1024 * 1024)
    return mb <= quotaMb
  }

  async cleanDeadLetters(): Promise<number> {
    const deadDir = path.join(this.dir, "dead-letter")
    let removed = 0
    try {
      const files = await fs.promises.readdir(deadDir)
      const cutoff = Date.now() - this.deadLetterRetentionDays * 86400000
      for (const file of files) {
        const filePath = path.join(deadDir, file)
        const stat = await fs.promises.stat(filePath)
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(filePath)
          removed++
        }
      }
    } catch {}
    return removed
  }

  async calculateDiskUsage(dir: string): Promise<number> {
    let total = 0
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          total += await this.calculateDiskUsage(fullPath)
        } else {
          const stat = await fs.promises.stat(fullPath)
          total += stat.size
        }
      }
    } catch {}
    return total
  }

  start(): void {
    this.stop()
    this.interval = setInterval(() => {}, this.gcIntervalMs)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }
}

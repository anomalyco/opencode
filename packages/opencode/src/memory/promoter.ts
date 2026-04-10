import { Log } from "@/util/log"
import { MemoryStore } from "./store"
import type { Memory } from "./types"

const log = Log.create({ service: "memory.promoter" })

const AUTO_PROMOTE_THRESHOLD = 5

export namespace MemoryPromoter {
  /**
   * Promote a specific memory entry to a wider scope.
   */
  export async function promote(id: string, targetScope: Memory.Scope): Promise<void> {
    const result = await MemoryStore.runPromise((svc) => svc.promote(id, targetScope))
    if (result) {
      log.info("memory promoted", { id, to: targetScope })
    }
  }

  /**
   * Detect personal entries that should be promoted to project scope.
   * Criteria: accessCount > threshold (accessed across multiple sessions).
   */
  export async function detectCandidates(projectPath: string): Promise<Memory.Info[]> {
    const personal = await MemoryStore.runPromise((svc) => svc.listByScope(projectPath, "personal"))
    return personal.filter((entry) => entry.accessCount > AUTO_PROMOTE_THRESHOLD)
  }

  /**
   * Auto-promote eligible personal entries to project scope.
   * Called during background consolidation.
   */
  export async function autoPromote(projectPath: string): Promise<number> {
    const candidates = await detectCandidates(projectPath)
    let promoted = 0

    for (const entry of candidates) {
      try {
        await MemoryStore.runPromise((svc) => svc.promote(entry.id, "project"))
        promoted++
        log.info("auto-promoted memory", { id: entry.id, name: entry.name, accessCount: entry.accessCount })
      } catch (err) {
        log.warn("failed to auto-promote memory", { error: err, id: entry.id })
      }
    }

    if (promoted > 0) {
      log.info("auto-promotion complete", { projectPath, promoted, candidates: candidates.length })
    }
    return promoted
  }
}

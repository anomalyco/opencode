import path from "path"
import { Log } from "@/util/log"
import { MemoryStore } from "./store"
import { MemoryFile } from "./file"
import { MemoryPromoter } from "./promoter"
import type { Memory } from "./types"

const log = Log.create({ service: "memory.maintenance" })

// Relevance decays by 5% per week of inactivity
const DECAY_RATE = 0.95
const DECAY_PERIOD_DAYS = 7
const STALE_THRESHOLD = 0.1
export namespace MemoryMaintenance {
  /**
   * Run the full maintenance cycle. Non-blocking, called at session start.
   */
  export async function run(projectPath: string): Promise<void> {
    try {
      const merged = await mergeDuplicates(projectPath)
      const decayed = await decayRelevance(projectPath)
      const removed = await removeStale(projectPath)
      const verified = await verifyReferences(projectPath)
      const promoted = await MemoryPromoter.autoPromote(projectPath)
      await reindex(projectPath)

      if (merged + decayed + removed + verified + promoted > 0) {
        log.info("maintenance complete", { projectPath, merged, decayed, removed, verified, promoted })
      }
    } catch (err) {
      log.warn("maintenance failed", { error: err, projectPath })
    }
  }

  /**
   * Merge entries with identical names (keep highest access count).
   */
  export async function mergeDuplicates(projectPath: string): Promise<number> {
    const entries = await MemoryStore.runPromise((svc) => svc.list(projectPath))
    const byName = new Map<string, Memory.Info[]>()

    for (const entry of entries) {
      const key = entry.name.toLowerCase().trim()
      const group = byName.get(key) ?? []
      group.push(entry)
      byName.set(key, group)
    }

    let merged = 0
    for (const [, group] of byName) {
      if (group.length <= 1) continue

      // Keep the entry with highest access count
      group.sort((a, b) => b.accessCount - a.accessCount)
      const keeper = group[0]

      // Merge content from duplicates into keeper
      const mergedContent = group.map((e) => e.content).join("\n\n")
      if (mergedContent !== keeper.content) {
        await MemoryStore.runPromise((svc) =>
          svc.update({ id: keeper.id, content: mergedContent }),
        )
      }

      // Remove duplicates
      for (let i = 1; i < group.length; i++) {
        await MemoryStore.runPromise((svc) => svc.remove(group[i].id))
        merged++
      }
    }

    return merged
  }

  /**
   * Decay relevance scores for entries not accessed recently.
   */
  export async function decayRelevance(projectPath: string): Promise<number> {
    const entries = await MemoryStore.runPromise((svc) => svc.list(projectPath))
    let decayed = 0

    for (const entry of entries) {
      const daysSinceUpdate = (Date.now() - entry.timeUpdated) / (1000 * 60 * 60 * 24)
      const periods = Math.floor(daysSinceUpdate / DECAY_PERIOD_DAYS)
      if (periods <= 0) continue

      const newScore = entry.relevanceScore * Math.pow(DECAY_RATE, periods)
      if (Math.abs(newScore - entry.relevanceScore) < 0.001) continue

      await MemoryStore.runPromise((svc) => svc.updateRelevance(entry.id, newScore))
      decayed++
    }

    return decayed
  }

  /**
   * Remove entries with relevance score below threshold.
   */
  export async function removeStale(projectPath: string): Promise<number> {
    const entries = await MemoryStore.runPromise((svc) => svc.list(projectPath))
    let removed = 0

    for (const entry of entries) {
      if (entry.relevanceScore < STALE_THRESHOLD) {
        await MemoryStore.runPromise((svc) => svc.remove(entry.id))

        // Also remove the corresponding file
        const filename = entry.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) + ".md"
        await MemoryFile.removeEntry(filename).catch(() => {})

        removed++
        log.info("removed stale memory", { id: entry.id, name: entry.name, score: entry.relevanceScore })
      }
    }

    return removed
  }

  /**
   * Check if file paths referenced in memory content still exist.
   * Reduces relevance for entries referencing deleted files.
   */
  export async function verifyReferences(projectPath: string): Promise<number> {
    const entries = await MemoryStore.runPromise((svc) => svc.list(projectPath))
    let verified = 0

    for (const entry of entries) {
      const paths = extractFilePaths(entry.content)
      if (paths.length === 0) continue

      let missingCount = 0
      for (const filePath of paths) {
        const resolved = path.resolve(projectPath, filePath)
        // Skip paths that escape the project directory
        if (!resolved.startsWith(projectPath + path.sep) && resolved !== projectPath) {
          continue
        }
        const exists = await Bun.file(resolved).exists().catch(() => false)
        if (!exists) missingCount++
      }

      if (missingCount > 0) {
        const penaltyFactor = 1.0 - (missingCount / paths.length) * 0.5
        const newScore = entry.relevanceScore * penaltyFactor
        await MemoryStore.runPromise((svc) =>
          svc.update({
            id: entry.id,
            relevanceScore: newScore,
            timeLastVerified: Date.now(),
          }),
        )
        verified++
      } else {
        // Mark as verified without penalty
        await MemoryStore.runPromise((svc) =>
          svc.update({ id: entry.id, timeLastVerified: Date.now() }),
        )
      }
    }

    return verified
  }

  /**
   * Regenerate MEMORY.md index from DB entries sorted by relevance.
   */
  export async function reindex(projectPath: string): Promise<void> {
    const entries = await MemoryStore.runPromise((svc) => svc.list(projectPath))
    if (entries.length === 0) return

    entries.sort((a, b) => b.relevanceScore - a.relevanceScore)

    const grouped = {
      project: entries.filter((e) => e.type === "project"),
      user: entries.filter((e) => e.type === "user"),
      feedback: entries.filter((e) => e.type === "feedback"),
      reference: entries.filter((e) => e.type === "reference"),
    }

    const lines: string[] = [
      "# Memory Index",
      `<!-- Auto-generated. Last updated: ${new Date().toISOString().split("T")[0]} -->`,
      `<!-- Entries: ${entries.length} -->`,
      "",
    ]

    for (const [title, group] of [
      ["Project Knowledge", grouped.project],
      ["User Preferences", grouped.user],
      ["Feedback & Patterns", grouped.feedback],
      ["Reference", grouped.reference],
    ] as const) {
      if (group.length === 0) continue
      lines.push(`## ${title}`, "")
      for (const entry of group) {
        const slug = entry.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80)
        const desc = entry.description ? ` -- ${entry.description}` : ""
        lines.push(`- [${entry.name}](${slug}.md)${desc}`)
      }
      lines.push("")
    }

    await MemoryFile.writeIndex(lines.join("\n"))
  }

  function extractFilePaths(content: string): string[] {
    const regex = /(?:^|\s)(\.\/[^\s]+|\/[^\s]+|src\/[^\s]+|packages\/[^\s]+)/gm
    return [...content.matchAll(regex)].map((m) => m[1].trim())
  }
}

import { lint, type LintReport } from "./lint"
import type { Subtask, SubtaskID } from "./schema"
import { SubtaskID as SubtaskIDSchema } from "./schema"

/** Hotspot files that should be isolated in a wiring subtask */
const HOTSPOT_PATTERNS = [
  /src\/cli\/cmd\/[^/]+\/index\.ts$/,
  /src\/cli\/registry\.ts$/,
  /src\/index\.ts$/,
  /src\/parallel\/orchestrator\.ts$/,
]

function isHotspot(file: string): boolean {
  return HOTSPOT_PATTERNS.some((pattern) => pattern.test(file))
}

export type RewriteMode = "off" | "warn" | "auto" | "strict"

export interface RewrittenPlan {
  originalSubtasks: Subtask[]
  rewrittenSubtasks: Subtask[]
  addedWiringSubtask: boolean
  wiringSubtaskId?: SubtaskID
  waves: { index: number; type: "parallel" | "serial"; subtasks: SubtaskID[] }[]
}

/**
 * Collect all hotspot files from subtasks.
 */
function collectHotspotFiles(subtasks: Subtask[]): Set<string> {
  const files = new Set<string>()
  for (const st of subtasks) {
    for (const file of st.fileScope) {
      if (isHotspot(file)) {
        files.add(file)
      }
    }
  }
  return files
}

/**
 * Collect all overlapping files between subtasks.
 */
function collectOverlappingFiles(subtasks: Subtask[]): Set<string> {
  const overlaps = new Set<string>()
  const normalize = (p: string) => p.replace(/^\.\//, "").replace(/\/$/, "")

  for (let i = 0; i < subtasks.length; i++) {
    for (let j = i + 1; j < subtasks.length; j++) {
      const a = subtasks[i]
      const b = subtasks[j]

      for (const fa of a.fileScope) {
        for (const fb of b.fileScope) {
          const na = normalize(fa)
          const nb = normalize(fb)
          if (na === nb || na.startsWith(nb + "/") || nb.startsWith(na + "/")) {
            overlaps.add(fa)
            overlaps.add(fb)
          }
        }
      }
    }
  }

  return overlaps
}

/**
 * Build waves from subtasks using overlap graph.
 */
export function buildWaves(
  subtasks: Subtask[],
): { index: number; type: "parallel" | "serial"; subtasks: SubtaskID[] }[] {
  const overlapGraph = new Map<SubtaskID, Set<SubtaskID>>()

  for (const st of subtasks) {
    overlapGraph.set(st.id, new Set())
  }

  // Build overlap graph
  for (let i = 0; i < subtasks.length; i++) {
    for (let j = i + 1; j < subtasks.length; j++) {
      const a = subtasks[i]
      const b = subtasks[j]

      for (const fa of a.fileScope) {
        for (const fb of b.fileScope) {
          const na = fa.replace(/^\.\//, "").replace(/\/$/, "")
          const nb = fb.replace(/^\.\//, "").replace(/\/$/, "")
          if (na === nb || na.startsWith(nb + "/") || nb.startsWith(na + "/")) {
            overlapGraph.get(a.id)?.add(b.id)
            overlapGraph.get(b.id)?.add(a.id)
          }
        }
      }
    }
  }

  const assigned = new Set<SubtaskID>()
  const waves: { index: number; type: "parallel" | "serial"; subtasks: SubtaskID[] }[] = []

  while (assigned.size < subtasks.length) {
    const candidates: SubtaskID[] = []
    for (const st of subtasks) {
      if (assigned.has(st.id)) continue
      const depsSatisfied = st.dependencies.every((dep) => assigned.has(dep))
      if (depsSatisfied) candidates.push(st.id)
    }

    if (candidates.length === 0) break

    const parallelizable: SubtaskID[] = []
    const overlapping: SubtaskID[] = []

    for (const id of candidates) {
      const hasOverlap = candidates.some((otherId) => id !== otherId && (overlapGraph.get(id)?.has(otherId) ?? false))
      if (hasOverlap) {
        overlapping.push(id)
      } else {
        parallelizable.push(id)
      }
    }

    if (parallelizable.length > 0) {
      waves.push({
        index: waves.length,
        type: "parallel",
        subtasks: [...parallelizable].sort(),
      })
      for (const id of parallelizable) assigned.add(id)
    }

    for (const id of overlapping) {
      waves.push({
        index: waves.length,
        type: "serial",
        subtasks: [id],
      })
      assigned.add(id)
    }
  }

  return waves
}

/**
 * Rewrite a plan to isolate shared files into a wiring subtask.
 */
export function rewrite(subtasks: Subtask[], lintReport: LintReport): RewrittenPlan {
  // If no errors, return original plan
  if (lintReport.valid && lintReport.issues.length === 0) {
    return {
      originalSubtasks: subtasks,
      rewrittenSubtasks: subtasks,
      addedWiringSubtask: false,
      waves: buildWaves(subtasks),
    }
  }

  const hotspotFiles = collectHotspotFiles(subtasks)
  const overlappingFiles = collectOverlappingFiles(subtasks)
  const sharedFiles = new Set([...hotspotFiles, ...overlappingFiles])

  // If no shared files, just restructure by overlaps
  if (sharedFiles.size === 0) {
    return {
      originalSubtasks: subtasks,
      rewrittenSubtasks: subtasks,
      addedWiringSubtask: false,
      waves: buildWaves(subtasks),
    }
  }

  // Create wiring subtask with shared files
  const wiringId = SubtaskIDSchema.make(`wiring-${Date.now()}`)
  const sharedFilesSorted = [...sharedFiles].sort()

  // Filter shared files from original subtasks
  const filteredSubtasks: Subtask[] = subtasks.map((st) => ({
    ...st,
    fileScope: st.fileScope.filter((f) => !sharedFiles.has(f)),
  }))

  // Collect all subtask IDs that originally touched shared files
  const touchedShared = new Set<SubtaskID>()
  for (const st of subtasks) {
    for (const f of st.fileScope) {
      if (sharedFiles.has(f)) {
        touchedShared.add(st.id)
      }
    }
  }

  // Wiring subtask depends on all subtasks that touched shared files
  const wiringDeps = [...touchedShared].sort()

  const wiringSubtask: Subtask = {
    id: wiringId,
    title: "Final wiring (shared files)",
    description:
      "Apply edits to shared registry and wiring files. This subtask runs after all parallel work completes.",
    fileScope: sharedFilesSorted,
    dependencies: wiringDeps,
  }

  const rewrittenSubtasks = [...filteredSubtasks, wiringSubtask]

  // Build waves for rewritten plan
  const waves = buildWaves(rewrittenSubtasks)

  return {
    originalSubtasks: subtasks,
    rewrittenSubtasks,
    addedWiringSubtask: true,
    wiringSubtaskId: wiringId,
    waves,
  }
}

/**
 * Validate that a plan can be executed safely.
 */
export function validate(subtasks: Subtask[], mode: RewriteMode): { valid: boolean; error?: string } {
  if (mode === "off") {
    return { valid: true }
  }

  const report = lint(subtasks)

  if (mode === "strict" && !report.valid) {
    const errors = report.issues
      .filter((i) => i.severity === "error")
      .map((i) => `[${i.code}] ${i.message}`)
      .join("; ")
    return { valid: false, error: `Plan validation failed: ${errors}` }
  }

  return { valid: true }
}

export namespace Rewriter {
  export type RewriteMode = import("./rewrite").RewriteMode
  export type RewrittenPlan = import("./rewrite").RewrittenPlan
}

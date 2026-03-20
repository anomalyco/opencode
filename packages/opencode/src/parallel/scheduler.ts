import type { Subtask, SubtaskID } from "./schema"

export type WaveType = "parallel" | "serial"

export interface Wave {
  index: number
  type: WaveType
  subtasks: SubtaskID[]
}

export interface OverlapAnalysis {
  subtaskA: SubtaskID
  subtaskB: SubtaskID
  overlappingFiles: string[]
}

export interface ConflictAnalysis {
  waves: Wave[]
  overlaps: OverlapAnalysis[]
  totalSubtasks: number
  parallelizableCount: number
  serialCount: number
}

/**
 * Check if two file paths overlap.
 * Overlap occurs if paths are equal or one is a parent of the other.
 */
function pathsOverlap(a: string, b: string): boolean {
  const normalize = (p: string) => p.replace(/^\.\//, "").replace(/\/$/, "")
  const na = normalize(a)
  const nb = normalize(b)

  if (na === nb) return true
  if (na.startsWith(nb + "/")) return true
  if (nb.startsWith(na + "/")) return true

  return false
}

/**
 * Check if two subtasks have overlapping file scopes.
 */
function subtasksOverlap(a: Subtask, b: Subtask): string[] {
  const overlapping: string[] = []

  for (const fileA of a.fileScope) {
    for (const fileB of b.fileScope) {
      if (pathsOverlap(fileA, fileB)) {
        overlapping.push(fileA, fileB)
      }
    }
  }

  return [...new Set(overlapping)]
}

/**
 * Build a complete overlap graph for all subtasks.
 * Returns pairs of subtasks that have overlapping file scopes.
 */
export function analyzeOverlaps(subtasks: Subtask[]): OverlapAnalysis[] {
  const overlaps: OverlapAnalysis[] = []

  for (let i = 0; i < subtasks.length; i++) {
    for (let j = i + 1; j < subtasks.length; j++) {
      const a = subtasks[i]
      const b = subtasks[j]
      const overlappingFiles = subtasksOverlap(a, b)

      if (overlappingFiles.length > 0) {
        overlaps.push({
          subtaskA: a.id,
          subtaskB: b.id,
          overlappingFiles,
        })
      }
    }
  }

  return overlaps
}

/**
 * Build execution waves from subtasks and their overlaps.
 * Each wave contains subtasks that can safely run together (no file scope overlaps).
 *
 * Algorithm:
 * 1. Process subtasks in dependency order
 * 2. For each step, find all subtasks with satisfied dependencies
 * 3. Separate into: parallelizable (no overlaps with each other) and overlapping
 * 4. Put parallelizable subtasks into a parallel wave
 * 5. Put each overlapping subtask into its own serial wave
 */
export function buildWaves(subtasks: Subtask[]): ConflictAnalysis {
  const overlaps = analyzeOverlaps(subtasks)
  const overlapGraph = new Map<SubtaskID, Set<SubtaskID>>()

  // Build overlap adjacency graph
  for (const st of subtasks) {
    overlapGraph.set(st.id, new Set())
  }

  for (const o of overlaps) {
    overlapGraph.get(o.subtaskA)?.add(o.subtaskB)
    overlapGraph.get(o.subtaskB)?.add(o.subtaskA)
  }

  const assigned = new Set<SubtaskID>()
  const waves: Wave[] = []

  while (assigned.size < subtasks.length) {
    // Find all subtasks with satisfied dependencies that aren't assigned yet
    const candidates: SubtaskID[] = []
    for (const st of subtasks) {
      if (assigned.has(st.id)) continue
      const depsSatisfied = st.dependencies.every((dep) => assigned.has(dep))
      if (depsSatisfied) candidates.push(st.id)
    }

    if (candidates.length === 0) {
      // Should not happen with valid dependency graph
      break
    }

    // Separate into parallelizable and overlapping groups
    // A subtask is parallelizable if it doesn't overlap with any other candidate
    const parallelizable: SubtaskID[] = []
    const overlapping: SubtaskID[] = []

    for (const id of candidates) {
      const hasOverlapWithOtherCandidate = candidates.some(
        (otherId) => id !== otherId && (overlapGraph.get(id)?.has(otherId) ?? false),
      )
      if (hasOverlapWithOtherCandidate) {
        overlapping.push(id)
      } else {
        parallelizable.push(id)
      }
    }

    // Create parallel wave for parallelizable subtasks
    if (parallelizable.length > 0) {
      waves.push({
        index: waves.length,
        type: "parallel",
        subtasks: parallelizable,
      })
      for (const id of parallelizable) {
        assigned.add(id)
      }
    }

    // Create serial waves for overlapping subtasks (one per wave)
    for (const id of overlapping) {
      waves.push({
        index: waves.length,
        type: "serial",
        subtasks: [id],
      })
      assigned.add(id)
    }
  }

  const parallelizableCount = waves.filter((w) => w.type === "parallel").reduce((sum, w) => sum + w.subtasks.length, 0)

  const serialCount = waves.filter((w) => w.type === "serial").reduce((sum, w) => sum + w.subtasks.length, 0)

  return {
    waves,
    overlaps,
    totalSubtasks: subtasks.length,
    parallelizableCount,
    serialCount,
  }
}

/**
 * Check if a plan can be safely executed in parallel based on scheduler mode.
 */
export function validatePlan(
  subtasks: Subtask[],
  mode: "auto" | "strict" | "off",
): { valid: boolean; analysis: ConflictAnalysis; error?: string } {
  const analysis = buildWaves(subtasks)

  if (mode === "off") {
    return { valid: true, analysis }
  }

  if (mode === "strict" && analysis.overlaps.length > 0) {
    const overlapDesc = analysis.overlaps
      .map((o) => `${String(o.subtaskA)} ↔ ${String(o.subtaskB)} (${o.overlappingFiles.join(", ")})`)
      .join("; ")

    return {
      valid: false,
      analysis,
      error: `File scope overlaps detected in strict mode: ${overlapDesc}. Use auto mode to allow wave scheduling or fix overlaps.`,
    }
  }

  return { valid: true, analysis }
}

export namespace Scheduler {
  export type Wave = import("./scheduler").Wave
  export type WaveType = import("./scheduler").WaveType
  export type OverlapAnalysis = import("./scheduler").OverlapAnalysis
  export type ConflictAnalysis = import("./scheduler").ConflictAnalysis
}

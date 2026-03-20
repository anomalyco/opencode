import type { Subtask, SubtaskID } from "./schema"

export type Severity = "info" | "warn" | "error"

export interface LintIssue {
  severity: Severity
  code: string
  message: string
  subtasks: SubtaskID[]
  files: string[]
  recommendation: string
}

export interface LintReport {
  valid: boolean
  issues: LintIssue[]
  summary: {
    error: number
    warn: number
    info: number
  }
}

/** Hotspot files that should be isolated in a wiring subtask */
const HOTSPOT_PATTERNS = [
  /src\/cli\/cmd\/[^/]+\/index\.ts$/,
  /src\/cli\/registry\.ts$/,
  /src\/index\.ts$/,
  /src\/parallel\/orchestrator\.ts$/,
]

/**
 * Check if a file is a hotspot (shared wiring/registry file).
 */
function isHotspot(file: string): boolean {
  return HOTSPOT_PATTERNS.some((pattern) => pattern.test(file))
}

/**
 * Check if two file paths overlap (equality or parent/child).
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
 * Find overlapping files between two subtasks.
 */
function findOverlaps(a: Subtask, b: Subtask): string[] {
  const overlapping: string[] = []
  for (const fa of a.fileScope) {
    for (const fb of b.fileScope) {
      if (pathsOverlap(fa, fb)) {
        overlapping.push(fa, fb)
      }
    }
  }
  return [...new Set(overlapping)]
}

/**
 * Lint subtasks for file scope issues.
 * Produces deterministic, ordered output.
 */
export function lint(subtasks: Subtask[]): LintReport {
  const issues: LintIssue[] = []
  const fileToSubtasks = new Map<string, SubtaskID[]>()

  // Build file ownership map
  for (const st of subtasks) {
    for (const file of st.fileScope) {
      const owners = fileToSubtasks.get(file) ?? []
      owners.push(st.id)
      fileToSubtasks.set(file, owners)
    }
  }

  // Check for duplicate file ownership
  for (const [file, owners] of [...fileToSubtasks.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (owners.length > 1) {
      issues.push({
        severity: "error",
        code: "duplicate_file_ownership",
        message: `File "${file}" is claimed by ${owners.length} subtasks`,
        subtasks: [...owners].sort(),
        files: [file],
        recommendation: "Consolidate edits to this file into a single subtask",
      })
    }
  }

  // Check for overlaps between subtasks
  for (let i = 0; i < subtasks.length; i++) {
    for (let j = i + 1; j < subtasks.length; j++) {
      const a = subtasks[i]
      const b = subtasks[j]
      const overlaps = findOverlaps(a, b)

      if (overlaps.length > 0) {
        const sortedIds = [a.id, b.id].sort()
        issues.push({
          severity: "warn",
          code: "file_scope_overlap",
          message: `Subtasks ${String(sortedIds[0])} and ${String(sortedIds[1])} have overlapping file scopes`,
          subtasks: sortedIds,
          files: [...overlaps].sort(),
          recommendation: "Consider isolating shared files into a dedicated wiring subtask",
        })
      }
    }
  }

  // Check for hotspots
  const hotspotFiles = new Map<string, SubtaskID[]>()
  for (const st of subtasks) {
    for (const file of st.fileScope) {
      if (isHotspot(file)) {
        const owners = hotspotFiles.get(file) ?? []
        owners.push(st.id)
        hotspotFiles.set(file, owners)
      }
    }
  }

  for (const [file, owners] of [...hotspotFiles.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sortedIds = [...owners].sort()
    issues.push({
      severity: sortedIds.length > 1 ? "error" : "info",
      code: "hotspot_file",
      message: `Hotspot file "${file}" ${sortedIds.length > 1 ? "claimed by multiple subtasks" : "detected"}`,
      subtasks: sortedIds,
      files: [file],
      recommendation: "Isolate wiring/registry files into a final serial subtask",
    })
  }

  // Sort issues deterministically: severity desc, code asc, message asc
  const severityOrder = { error: 0, warn: 1, info: 2 }
  issues.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity]
    if (sevDiff !== 0) return sevDiff
    const codeDiff = a.code.localeCompare(b.code)
    if (codeDiff !== 0) return codeDiff
    return a.message.localeCompare(b.message)
  })

  const summary = {
    error: issues.filter((i) => i.severity === "error").length,
    warn: issues.filter((i) => i.severity === "warn").length,
    info: issues.filter((i) => i.severity === "info").length,
  }

  return {
    valid: summary.error === 0,
    issues,
    summary,
  }
}

export { isHotspot }

export namespace Linter {
  export type Severity = import("./lint").Severity
  export type LintIssue = import("./lint").LintIssue
  export type LintReport = import("./lint").LintReport
}

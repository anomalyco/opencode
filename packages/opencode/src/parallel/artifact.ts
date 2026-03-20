import type { Subtask, SubtaskID } from "./schema"

export type ArtifactMode = "off" | "warn" | "auto" | "strict"

export interface ArtifactEdge {
  producer: SubtaskID
  consumer: SubtaskID
  artifact: string
  type: "import" | "reference" | "build_output"
}

export interface ArtifactAnalysis {
  valid: boolean
  edges: ArtifactEdge[]
  cycles: SubtaskID[][]
  missingDeps: Map<SubtaskID, SubtaskID[]>
  safeWaves: SubtaskID[][]
}

export interface ArtifactDiagnostic {
  code: string
  message: string
  severity: "error" | "warn" | "info"
  subtasks: SubtaskID[]
  artifacts: string[]
  recommendation: string
}

export interface ArtifactReport {
  valid: boolean
  diagnostics: ArtifactDiagnostic[]
  edges: ArtifactEdge[]
  missingDependencies: Map<SubtaskID, SubtaskID[]>
  summary: {
    error: number
    warn: number
    info: number
  }
}

/**
 * Infer produced artifacts from a subtask's fileScope.
 * Artifacts are typically output files that other subtasks might consume.
 */
function inferArtifacts(fileScope: string[]): string[] {
  const artifacts: string[] = []

  for (const file of fileScope) {
    // Skip test files - they're not typically build artifacts
    if (file.includes(".test.") || file.includes(".spec.")) continue

    // Skip config files - they're inputs, not outputs
    if (file.includes("config") || file.endsWith(".config.ts")) continue

    // Add as potential artifact
    artifacts.push(file)
  }

  return artifacts
}

function escape(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function mentioned(text: string, artifact: string): boolean {
  const full = artifact.toLowerCase()
  const name = full.split("/").pop() || ""
  const base = name.replace(/\.[^.]+$/, "")
  const keys = [full, name, base].filter((x) => x.length > 1)
  for (const key of keys) {
    const re = new RegExp(`\\b${escape(key)}\\b`, "i")
    if (re.test(text)) return true
  }
  return false
}

/**
 * Detect imports or references to artifacts in subtask description.
 * This is a heuristic to find implicit dependencies.
 */
function detectArtifactReferences(subtask: Subtask, allArtifacts: Map<string, SubtaskID>): ArtifactEdge[] {
  const edges: ArtifactEdge[] = []
  const searchText = `${subtask.title} ${subtask.description}`.toLowerCase()

  for (const [artifact, producer] of allArtifacts) {
    if (producer === subtask.id) continue // Skip self-references

    if (mentioned(searchText, artifact)) {
      const importLike = /\b(import|from|require|uses?|depends on)\b/i.test(searchText)
      edges.push({
        producer,
        consumer: subtask.id,
        artifact,
        type: importLike ? "import" : "reference",
      })
    }
  }

  return edges
}

/**
 * Build artifact dependency graph from subtasks.
 */
function buildArtifactGraph(subtasks: Subtask[]): Map<string, SubtaskID> {
  const artifacts = new Map<string, SubtaskID>()

  for (const subtask of subtasks) {
    const produced = inferArtifacts(subtask.fileScope)
    for (const artifact of produced) {
      artifacts.set(artifact, subtask.id)
    }
  }

  return artifacts
}

/**
 * Detect cycles in the artifact dependency graph.
 */
function detectCycles(edges: ArtifactEdge[], subtasks: Subtask[]): SubtaskID[][] {
  const graph = new Map<SubtaskID, Set<SubtaskID>>()

  // Initialize graph
  for (const st of subtasks) {
    graph.set(st.id, new Set())
  }

  // Add edges
  for (const edge of edges) {
    graph.get(edge.consumer)?.add(edge.producer)
  }

  const cycles: SubtaskID[][] = []
  const visited = new Set<SubtaskID>()
  const recStack = new Set<SubtaskID>()
  const path: SubtaskID[] = []

  function dfs(node: SubtaskID): boolean {
    visited.add(node)
    recStack.add(node)
    path.push(node)

    const neighbors = graph.get(node) || new Set()
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true
      } else if (recStack.has(neighbor)) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor)
        cycles.push(path.slice(cycleStart))
        return true
      }
    }

    path.pop()
    recStack.delete(node)
    return false
  }

  for (const st of subtasks) {
    if (!visited.has(st.id)) {
      dfs(st.id)
    }
  }

  return cycles
}

/**
 * Find missing dependency edges not declared in subtask.dependencies.
 */
function findMissingDependencies(edges: ArtifactEdge[], subtasks: Subtask[]): Map<SubtaskID, SubtaskID[]> {
  const missing = new Map<SubtaskID, SubtaskID[]>()

  // Build dependency map
  const declaredDeps = new Map<SubtaskID, Set<SubtaskID>>()
  for (const st of subtasks) {
    declaredDeps.set(st.id, new Set(st.dependencies))
  }

  // Check each edge
  for (const edge of edges) {
    const declared = declaredDeps.get(edge.consumer)
    if (!declared?.has(edge.producer)) {
      const current = missing.get(edge.consumer) || []
      if (!current.includes(edge.producer)) {
        missing.set(edge.consumer, [...current, edge.producer])
      }
    }
  }

  return missing
}

/**
 * Build safe execution waves considering artifact dependencies.
 */
function buildSafeWaves(
  subtasks: Subtask[],
  edges: ArtifactEdge[],
  missingDeps: Map<SubtaskID, SubtaskID[]>,
): SubtaskID[][] {
  // Build complete dependency graph including implicit deps
  const graph = new Map<SubtaskID, Set<SubtaskID>>()

  for (const st of subtasks) {
    const deps = new Set(st.dependencies)
    const implicit = missingDeps.get(st.id) || []
    for (const dep of implicit) {
      deps.add(dep)
    }
    graph.set(st.id, deps)
  }

  const waves: SubtaskID[][] = []
  const assigned = new Set<SubtaskID>()

  while (assigned.size < subtasks.length) {
    const wave: SubtaskID[] = []

    for (const st of subtasks) {
      if (assigned.has(st.id)) continue

      const deps = graph.get(st.id) || new Set()
      const allDepsSatisfied = [...deps].every((dep) => assigned.has(dep))

      if (allDepsSatisfied) {
        wave.push(st.id)
      }
    }

    if (wave.length === 0) {
      // Deadlock - should not happen if no cycles
      break
    }

    waves.push(wave.sort())
    for (const id of wave) {
      assigned.add(id)
    }
  }

  return waves
}

/**
 * Analyze subtasks for implicit artifact dependencies.
 * Produces deterministic, ordered output.
 */
export function analyze(subtasks: Subtask[]): ArtifactReport {
  if (subtasks.length === 0) {
    return {
      valid: true,
      diagnostics: [],
      edges: [],
      missingDependencies: new Map(),
      summary: { error: 0, warn: 0, info: 0 },
    }
  }

  // Build artifact graph
  const artifacts = buildArtifactGraph(subtasks)

  // Detect implicit dependencies
  const edges: ArtifactEdge[] = []
  for (const subtask of subtasks) {
    const refs = detectArtifactReferences(subtask, artifacts)
    edges.push(...refs)
  }

  // Deduplicate edges
  const uniqueEdges: ArtifactEdge[] = []
  const seen = new Set<string>()
  for (const edge of edges) {
    const key = `${edge.producer}→${edge.consumer}@${edge.artifact}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueEdges.push(edge)
    }
  }

  // Sort edges deterministically
  uniqueEdges.sort((a, b) => {
    const cmp = String(a.producer).localeCompare(String(b.producer))
    if (cmp !== 0) return cmp
    return String(a.consumer).localeCompare(String(b.consumer))
  })

  // Detect cycles
  const cycles = detectCycles(uniqueEdges, subtasks)

  // Find missing dependencies
  const missingDeps = findMissingDependencies(uniqueEdges, subtasks)

  // Build diagnostics
  const diagnostics: ArtifactDiagnostic[] = []

  // Cycle errors
  for (const cycle of cycles) {
    diagnostics.push({
      code: "artifact_cycle",
      message: `Circular artifact dependency detected: ${cycle.map(String).join(" → ")}`,
      severity: "error",
      subtasks: [...cycle].sort(),
      artifacts: [],
      recommendation: "Break the cycle by restructuring subtasks or adding explicit dependencies",
    })
  }

  // Missing dependency warnings
  for (const [consumer, producers] of [...missingDeps.entries()].sort((a, b) =>
    String(a[0]).localeCompare(String(b[0])),
  )) {
    const producerList = producers.map(String).sort().join(", ")
    const artifactsForEdge = uniqueEdges
      .filter((e) => e.consumer === consumer && producers.includes(e.producer))
      .map((e) => e.artifact)

    diagnostics.push({
      code: "implicit_dependency",
      message: `Subtask "${consumer}" implicitly depends on: ${producerList}`,
      severity: "warn",
      subtasks: [consumer, ...producers].sort(),
      artifacts: [...new Set(artifactsForEdge)].sort(),
      recommendation: "Add explicit dependencies or enable auto mode to add them automatically",
    })
  }

  // Sort diagnostics
  const severityOrder = { error: 0, warn: 1, info: 2 }
  diagnostics.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity]
    if (sevDiff !== 0) return sevDiff
    return a.code.localeCompare(b.code)
  })

  const summary = {
    error: diagnostics.filter((d) => d.severity === "error").length,
    warn: diagnostics.filter((d) => d.severity === "warn").length,
    info: diagnostics.filter((d) => d.severity === "info").length,
  }

  return {
    valid: summary.error === 0 && missingDeps.size === 0,
    diagnostics,
    edges: uniqueEdges,
    missingDependencies: missingDeps,
    summary,
  }
}

/**
 * Validate subtasks against artifact dependencies based on mode.
 */
export function validate(subtasks: Subtask[], mode: ArtifactMode): { valid: boolean; error?: string } {
  if (mode === "off") {
    return { valid: true }
  }

  const report = analyze(subtasks)

  if (mode === "strict" && !report.valid) {
    const errors = report.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `[${d.code}] ${d.message}`)
      .join("; ")

    const warnings = report.diagnostics
      .filter((d) => d.severity === "warn")
      .map((d) => `[${d.code}] ${d.message}`)
      .join("; ")

    let message = "Artifact dependency validation failed"
    if (errors) message += `: ${errors}`
    if (warnings) message += `; implicit dependencies: ${warnings}`

    return { valid: false, error: message }
  }

  return { valid: true }
}

/**
 * Rewrite subtasks to add missing implicit dependencies.
 */
export function rewrite(subtasks: Subtask[], report: ArtifactReport): { rewritten: Subtask[]; addedDeps: number } {
  if (report.missingDependencies.size === 0) {
    return { rewritten: subtasks, addedDeps: 0 }
  }

  let addedCount = 0
  const rewritten: Subtask[] = []

  for (const st of subtasks) {
    const implicit = report.missingDependencies.get(st.id)
    if (implicit && implicit.length > 0) {
      const newDeps = [...new Set([...st.dependencies, ...implicit])].sort()
      addedCount += implicit.length
      rewritten.push({
        ...st,
        dependencies: newDeps,
      })
    } else {
      rewritten.push(st)
    }
  }

  return { rewritten, addedDeps: addedCount }
}

export namespace ArtifactAnalyzer {
  export type ArtifactMode = import("./artifact").ArtifactMode
  export type ArtifactEdge = import("./artifact").ArtifactEdge
  export type ArtifactReport = import("./artifact").ArtifactReport
  export type ArtifactDiagnostic = import("./artifact").ArtifactDiagnostic
}

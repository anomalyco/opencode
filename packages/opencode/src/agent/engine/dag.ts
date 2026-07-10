export interface DAGNode {
  node_id: string
  capability_id: string
  inputs: Record<string, unknown>
  dependencies: string[]
  risk_level: number
  estimated_tokens: number
  estimated_duration_ms: number
  status: "pending" | "running" | "completed" | "failed" | "blocked"
  output?: unknown
}

export interface DAG {
  version: number
  nodes: DAGNode[]
  edges: [string, string][]
  metadata?: {
    goal: string
    strategy: string
    replan_count: number
    created_at: number
  }
}

export interface DAGValidationResult {
  valid: boolean
  executionOrder?: string[]
  error?: string
  cycleNodes?: string[]
  orphanNodes?: string[]
}

export function validateDAG(dag: DAG): DAGValidationResult {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  const nodeIds = new Set(dag.nodes.map((n) => n.node_id))

  for (const node of dag.nodes) {
    inDegree.set(node.node_id, 0)
    adj.set(node.node_id, [])
  }

  for (const [from, to] of dag.edges) {
    if (!nodeIds.has(from)) {
      return { valid: false, error: `UNKNOWN_SOURCE_NODE: ${from}` }
    }
    if (!nodeIds.has(to)) {
      return { valid: false, error: `UNKNOWN_TARGET_NODE: ${to}` }
    }
    adj.get(from)!.push(to)
    inDegree.set(to, (inDegree.get(to) || 0) + 1)
  }

  const queue: string[] = []
  for (const node of dag.nodes) {
    if ((inDegree.get(node.node_id) || 0) === 0) {
      queue.push(node.node_id)
    }
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(current)
    for (const neighbor of adj.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) queue.push(neighbor)
    }
  }

  if (sorted.length !== dag.nodes.length) {
    const visited = new Set(sorted)
    const cycleNodes = dag.nodes.filter((n) => !visited.has(n.node_id)).map((n) => n.node_id)

    const orphanNodes = dag.nodes
      .filter((n) => visited.has(n.node_id) && n.dependencies.length === 0 && !dag.edges.some(([f]) => f === n.node_id))
      .map((n) => n.node_id)

    return {
      valid: false,
      error: "CYCLE_DETECTED",
      cycleNodes,
      orphanNodes: orphanNodes.length > 0 ? orphanNodes : undefined,
    }
  }

  for (const node of dag.nodes) {
    for (const dep of node.dependencies) {
      if (!nodeIds.has(dep)) {
        return { valid: false, error: `UNKNOWN_DEPENDENCY: node=${node.node_id}, dep=${dep}` }
      }
    }
  }

  return { valid: true, executionOrder: sorted }
}

export function getReadyNodes(dag: DAG): DAGNode[] {
  return dag.nodes.filter((n) => {
    if (n.status !== "pending") return false
    return n.dependencies.every((depId) => {
      const dep = dag.nodes.find((x) => x.node_id === depId)
      return dep && dep.status === "completed"
    })
  })
}

export function markNodeFailed(dag: DAG, nodeId: string): DAG {
  const updated = structuredClone(dag)
  const node = updated.nodes.find((n) => n.node_id === nodeId)
  if (node) {
    node.status = "failed"
    const blockers = new Set<string>()
    for (const [from, to] of updated.edges) {
      if (from === nodeId) blockers.add(to)
    }
    for (const n of updated.nodes) {
      if (n.status === "pending" && blockers.has(n.node_id)) {
        n.status = "blocked"
      }
    }
  }
  return updated
}

export function getTransitiveDependents(dag: DAG, nodeId: string): Set<string> {
  const dependents = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const [from, to] of dag.edges) {
      if (from === current && !dependents.has(to)) {
        dependents.add(to)
        queue.push(to)
      }
    }
  }
  return dependents
}

export function estimateDAGCost(dag: DAG): { total_tokens: number; total_duration_ms: number } {
  return dag.nodes.reduce(
    (acc, n) => ({
      total_tokens: acc.total_tokens + n.estimated_tokens,
      total_duration_ms: acc.total_duration_ms + n.estimated_duration_ms,
    }),
    { total_tokens: 0, total_duration_ms: 0 },
  )
}

export function isComplete(dag: DAG): boolean {
  if (dag.nodes.length === 0) return false
  return dag.nodes.every((n) => n.status === "completed" || n.status === "failed" || n.status === "blocked")
}

export function allSucceeded(dag: DAG): boolean {
  if (dag.nodes.length === 0) return false
  return dag.nodes.every((n) => n.status === "completed" || n.status === "blocked")
}

export * as DAG from "./dag"

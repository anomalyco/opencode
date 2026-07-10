import { validateDAG, type DAG, type DAGNode, type DAGValidationResult } from "./dag"

export interface Capability {
  capability_id: string
  name: string
  description: string
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
  tags: string[]
  risk_level: 0 | 1 | 2 | 3
  total_calls: number
  success_rate: number
  avg_duration_ms: number
  avg_token_cost: number
  handler?: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export enum ExecutionStrategy {
  SINGLE_SHOT = "SINGLE_SHOT",
  STAGED = "STAGED",
  MULTI_VALIDATE = "MULTI_VALIDATE",
  K_PARALLEL = "K_PARALLEL",
}

export class CapabilityRegistry {
  private capabilities = new Map<string, Capability>()

  register(capability: Capability): void {
    this.capabilities.set(capability.capability_id, capability)
  }

  unregister(capabilityId: string): void {
    this.capabilities.delete(capabilityId)
  }

  get(capabilityId: string): Capability | undefined {
    return this.capabilities.get(capabilityId)
  }

  searchByTags(tags: string[]): Capability[] {
    return Array.from(this.capabilities.values()).filter((c) =>
      tags.some((t) => c.tags.includes(t)),
    )
  }

  getByRiskLevel(maxRisk: number): Capability[] {
    return Array.from(this.capabilities.values()).filter((c) => c.risk_level <= maxRisk)
  }

  getAll(): Capability[] {
    return Array.from(this.capabilities.values())
  }

  recordExecution(capabilityId: string, success: boolean, durationMs: number, tokenCost: number): void {
    const cap = this.capabilities.get(capabilityId)
    if (!cap) return
    cap.total_calls++
    const oldSuccessTotal = cap.success_rate * (cap.total_calls - 1)
    cap.success_rate = (oldSuccessTotal + (success ? 1 : 0)) / cap.total_calls
    cap.avg_duration_ms = (cap.avg_duration_ms * (cap.total_calls - 1) + durationMs) / cap.total_calls
    cap.avg_token_cost = (cap.avg_token_cost * (cap.total_calls - 1) + tokenCost) / cap.total_calls
  }
}

export class DAGPlanner {
  constructor(private registry: CapabilityRegistry) {}

  selectStrategy(
    goal: string,
    capabilities: Capability[],
    consecutiveFailures: number,
    tokenBudgetPercent: number,
  ): ExecutionStrategy {
    const keywords = goal.toLowerCase()

    if (consecutiveFailures >= 3) return ExecutionStrategy.SINGLE_SHOT

    if (keywords.includes("refactor") || keywords.includes("migrate") || keywords.includes("delete")) {
      const maxRisk = Math.max(...capabilities.map((c) => c.risk_level), 0)
      if (maxRisk >= 2) return ExecutionStrategy.MULTI_VALIDATE
      return ExecutionStrategy.STAGED
    }

    if (keywords.includes("compare") || keywords.includes("alternatives")) {
      if (tokenBudgetPercent <= 0.8) return ExecutionStrategy.K_PARALLEL
      return ExecutionStrategy.STAGED
    }

    if (goal.length < 100 && !keywords.includes("file") && !keywords.includes("code")) {
      return ExecutionStrategy.SINGLE_SHOT
    }

    return ExecutionStrategy.STAGED
  }

  buildDAGPlan(
    goal: string,
    capabilities: Capability[],
    strategy: ExecutionStrategy,
    dagPrompt: string,
  ): { dag: DAG; validation: DAGValidationResult } {
    let dag: DAG

    if (strategy === ExecutionStrategy.SINGLE_SHOT) {
      dag = {
        version: 1,
        nodes: [
          {
            node_id: "n1",
            capability_id: capabilities[0]?.capability_id ?? "default",
            inputs: { goal },
            dependencies: [],
            risk_level: capabilities[0]?.risk_level ?? 0,
            estimated_tokens: 100,
            estimated_duration_ms: 5000,
            status: "pending",
          },
        ],
        edges: [],
        metadata: { goal, strategy: "SINGLE_SHOT", replan_count: 0, created_at: Date.now() },
      }
    } else {
      // Build a sequential pipeline DAG from available capabilities
      // Sorted by risk_level ascending (safe first)
      const sorted = [...capabilities].sort((a, b) => a.risk_level - b.risk_level)
      const nodes: DAGNode[] = sorted.slice(0, 5).map((cap, i) => ({
        node_id: `n${i + 1}`,
        capability_id: cap.capability_id,
        inputs: { goal },
        dependencies: i > 0 ? [`n${i}`] : [],
        risk_level: cap.risk_level,
        estimated_tokens: cap.avg_token_cost || 100,
        estimated_duration_ms: cap.avg_duration_ms || 5000,
        status: "pending" as const,
      }))
      const edges: [string, string][] = nodes.slice(1).map((_, i) => [nodes[i].node_id, nodes[i + 1].node_id])
      dag = {
        version: 1,
        nodes,
        edges,
        metadata: { goal, strategy, replan_count: 0, created_at: Date.now() },
      }
    }

    const validation = validateDAG(dag)
    return { dag, validation }
  }

  replanDAG(
    originalDAG: DAG,
    failedNodeId: string,
    errorContext: string,
    replanCount: number,
  ): { dag: DAG; validation: DAGValidationResult } {
    const updatedNodes = originalDAG.nodes.map((n) => {
      if (n.node_id === failedNodeId) return { ...n, status: "failed" as const }
      return n
    })

    const dag: DAG = {
      version: originalDAG.version + 1,
      nodes: updatedNodes,
      edges: originalDAG.edges.filter(([from]) => from !== failedNodeId),
      metadata: {
        ...originalDAG.metadata,
        goal: originalDAG.metadata?.goal ?? "",
        strategy: originalDAG.metadata?.strategy ?? "STAGED",
        replan_count: replanCount,
        created_at: Date.now(),
      },
    }

    const validation = validateDAG(dag)
    return { dag, validation }
  }
}

export * as Planner from "./planner"

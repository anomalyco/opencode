import type { DAG, DAGNode } from "../dag"
import type { Capability } from "../planner"

export const DAG_PROMPT_TEMPLATE = `You are a task planner. Given the user goal and available capabilities, generate a DAG.

Goal: {{goal}}

Available capabilities:
{{capabilities}}

Rules:
1. Every node must reference a capability_id from the list above
2. Dependencies must form a DAG (no cycles)
3. Include estimated tokens and duration for each node
4. Mark risk_level per node (0=read-only, 1=local-modify, 2=global-impact, 3=destructive)
5. Only include nodes that directly contribute to the goal

Output ONLY valid JSON, no explanation:
{
  "nodes": [
    {
      "node_id": "n1",
      "capability_id": "read_file",
      "inputs": {"path": "src/index.ts"},
      "dependencies": [],
      "risk_level": 0,
      "estimated_tokens": 100,
      "estimated_duration_ms": 5000
    }
  ],
  "edges": [["n1", "n2"]]
}`

export interface DAGGeneratorConfig {
  model?: string
  temperature?: number
  maxTokens?: number
}

export class DAGGenerator {
  private config: DAGGeneratorConfig
  private llmCaller: ((prompt: string) => Promise<string>) | null = null

  constructor(config?: DAGGeneratorConfig) {
    this.config = {
      model: config?.model ?? "claude-sonnet-4-20250514",
      temperature: config?.temperature ?? 0.3,
      maxTokens: config?.maxTokens ?? 8000,
    }
  }

  setLLMCaller(caller: (prompt: string) => Promise<string>): void {
    this.llmCaller = caller
  }

  buildPrompt(goal: string, capabilities: Capability[]): string {
    const capList = capabilities
      .map((c) => `- ${c.name} (id=${c.capability_id}, risk=${c.risk_level}, tags=[${c.tags.join(",")}], success_rate=${(c.success_rate * 100).toFixed(0)}%)`)
      .join("\n")

    return DAG_PROMPT_TEMPLATE
      .replace("{{goal}}", goal)
      .replace("{{capabilities}}", capList)
  }

  async generateDAG(goal: string, capabilities: Capability[]): Promise<DAG> {
    const prompt = this.buildPrompt(goal, capabilities)

    if (!this.llmCaller) {
      return this.generateFallbackDAG(goal, capabilities)
    }

    try {
      const response = await this.llmCaller(prompt)
      const jsonStr = this.extractJSON(response)
      const parsed = JSON.parse(jsonStr)

      const nodes: DAGNode[] = (parsed.nodes || []).map((n: Record<string, unknown>, i: number) => ({
        node_id: (n.node_id as string) || `n${i + 1}`,
        capability_id: (n.capability_id as string) || "unknown",
        inputs: (n.inputs as Record<string, unknown>) || {},
        dependencies: Array.isArray(n.dependencies) ? (n.dependencies as string[]) : [],
        risk_level: (n.risk_level as number) ?? 0,
        estimated_tokens: (n.estimated_tokens as number) || 100,
        estimated_duration_ms: (n.estimated_duration_ms as number) || 5000,
        status: "pending" as const,
      }))

      const edges: [string, string][] = Array.isArray(parsed.edges)
        ? parsed.edges.filter((e: unknown) => Array.isArray(e) && e.length === 2).map((e: [string, string]) => [e[0], e[1]])
        : []

      return {
        version: 1,
        nodes,
        edges,
        metadata: { goal, strategy: "STAGED", replan_count: 0, created_at: Date.now() },
      }
    } catch {
      return this.generateFallbackDAG(goal, capabilities)
    }
  }

  async generateReplanDAG(goal: string, capabilities: Capability[], errorContext: string, completedNodes: string[], failedNodeId: string): Promise<DAG> {
    const replanPrompt = `${this.buildPrompt(goal, capabilities)}

ERROR CONTEXT: Node "${failedNodeId}" failed. Error: ${errorContext}

COMPLETED NODES: ${completedNodes.join(", ") || "none"}

Generate an updated DAG that preserves completed node outputs and retries or replaces the failed node. Output JSON only.`

    if (!this.llmCaller) {
      return this.generateFallbackDAG(goal, capabilities)
    }

    try {
      const response = await this.llmCaller(replanPrompt)
      const jsonStr = this.extractJSON(response)
      const parsed = JSON.parse(jsonStr)

      return {
        version: 2,
        nodes: (parsed.nodes || []).map((n: Record<string, unknown>, i: number) => ({
          node_id: (n.node_id as string) || `n${i + 1}`,
          capability_id: (n.capability_id as string) || "unknown",
          inputs: (n.inputs as Record<string, unknown>) || {},
          dependencies: Array.isArray(n.dependencies) ? (n.dependencies as string[]) : [],
          risk_level: (n.risk_level as number) ?? 0,
          estimated_tokens: (n.estimated_tokens as number) || 100,
          estimated_duration_ms: (n.estimated_duration_ms as number) || 5000,
          status: "pending" as const,
        })),
        edges: Array.isArray(parsed.edges) ? parsed.edges.filter((e: unknown) => Array.isArray(e) && e.length === 2).map((e: [string, string]) => [e[0], e[1]]) : [],
        metadata: { goal, strategy: "STAGED", replan_count: 1, created_at: Date.now() },
      }
    } catch {
      return this.generateFallbackDAG(goal, capabilities)
    }
  }

  protected generateFallbackDAG(goal: string, capabilities: Capability[]): DAG {
    const sorted = [...capabilities].sort((a, b) => a.risk_level - b.risk_level)
    const nodes: DAGNode[] = sorted.slice(0, 5).map((cap, i) => ({
      node_id: `n${i + 1}`,
      capability_id: cap.capability_id,
      inputs: { goal },
      dependencies: i > 0 ? [`n${i}`] : [],
      risk_level: cap.risk_level,
      estimated_tokens: 100,
      estimated_duration_ms: 5000,
      status: "pending" as const,
    }))

    const edges: [string, string][] = nodes.slice(1).map((n, i) => [`n${i}`, n.node_id])

    return {
      version: 1,
      nodes,
      edges,
      metadata: { goal, strategy: "STAGED", replan_count: 0, created_at: Date.now() },
    }
  }

  private extractJSON(text: string): string {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) return jsonMatch[0]

    const lines = text.split("\n")
    const jsonLines: string[] = []
    let started = false
    for (const line of lines) {
      if (line.trim().startsWith("{")) started = true
      if (started) jsonLines.push(line)
      if (started && line.trim().endsWith("}")) break
    }
    if (jsonLines.length > 0) return jsonLines.join("\n")

    return text
  }
}

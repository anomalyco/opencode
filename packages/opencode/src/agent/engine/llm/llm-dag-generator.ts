// Real LLM DAG Generation — wires DAGGenerator to AI SDK provider
// Use with the existing LLM infrastructure in packages/fengru

import { DAGGenerator, DAG_PROMPT_TEMPLATE, type DAGGeneratorConfig } from "./dag-generator"
import type { DAG } from "../dag"
import type { Capability } from "../planner"

export interface ProviderAdapter {
  chat: (params: { messages: Array<{ role: string; content: string }> }) => Promise<{ content: string }>
}

export class LLMDAGGenerator extends DAGGenerator {
  private provider: ProviderAdapter | null = null

  constructor(config?: DAGGeneratorConfig) {
    super(config)
  }

  setProvider(provider: ProviderAdapter): void {
    this.provider = provider
    this.setLLMCaller(async (prompt: string) => {
      const response = await provider.chat({
        messages: [
          { role: "system", content: "You are a task planning assistant. Output valid JSON only. No explanation." },
          { role: "user", content: prompt },
        ],
      })
      return response.content
    })
  }

  override async generateDAG(goal: string, capabilities: Capability[]): Promise<DAG> {
    if (this.provider) {
      return super.generateDAG(goal, capabilities)
    }
    // Fallback: use simple heuristic planning
    return this.generateFallbackDAG(goal, capabilities)
  }

  // Batch planning: generate multiple DAG variants for K-Parallel strategy
  async generateKParallelDAGs(goal: string, capabilities: Capability[], k: number = 3): Promise<DAG[]> {
    const dags: DAG[] = []
    for (let i = 0; i < k; i++) {
      const prompt = `${this.buildPrompt(goal, capabilities)}\n\nGenerate variant #${i + 1}. Focus on a different approach.`
      if (this.provider) {
        try {
          const response = await this.provider.chat({
            messages: [
              { role: "system", content: "You are a task planning assistant. Output valid JSON only." },
              { role: "user", content: prompt },
            ],
          })
          const jsonStr = this["extractJSON"](response.content)
          const parsed = JSON.parse(jsonStr)
          dags.push({
            version: 1,
            nodes: (parsed.nodes || []).map((n: Record<string, unknown>, j: number) => ({
              node_id: `k${i}_n${j}`,
              capability_id: (n.capability_id as string) || "unknown",
              inputs: (n.inputs as Record<string, unknown>) || {},
              dependencies: Array.isArray(n.dependencies) ? (n.dependencies as string[]) : [],
              risk_level: (n.risk_level as number) ?? 0,
              estimated_tokens: (n.estimated_tokens as number) || 100,
              estimated_duration_ms: (n.estimated_duration_ms as number) || 5000,
              status: "pending" as const,
            })),
            edges: Array.isArray(parsed.edges) ? parsed.edges.filter((e: unknown) => Array.isArray(e) && e.length === 2) : [],
            metadata: { goal, strategy: "K_PARALLEL", replan_count: 0, created_at: Date.now() },
          })
        } catch {
          dags.push(this.generateFallbackDAG(goal, capabilities))
        }
      } else {
        dags.push(this.generateFallbackDAG(goal, capabilities))
      }
    }
    return dags
  }
}

// Factory for integration with existing AI SDK provider
export function createLLMDAGGenerator(
  provider?: ProviderAdapter,
  config?: DAGGeneratorConfig,
): LLMDAGGenerator {
  const gen = new LLMDAGGenerator(config)
  if (provider) gen.setProvider(provider)
  return gen
}

export * as LLMDAG from "./llm-dag-generator"

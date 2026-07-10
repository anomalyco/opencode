import type { Session } from "@/session/session"
import type { MessageV2 } from "@/session/message-v2"
import type { ToolRegistry } from "@/tool/registry"
import type { Tool } from "@/tool/tool"
import type { EventBusPersistFn } from "../agent/engine/event-bus"
import { Effect } from "effect"
import {
  AgentEngine,
  type EngineConfig,
  type Capability,
  type DAGNode,
} from "../agent/engine"

export interface ToolAdapter {
  name: string
  description: string
  risk_level: 0 | 1 | 2 | 3
  tags: string[]
  execute: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export const DEFAULT_RISK_MAP: Record<string, number> = {
  read: 0, glob: 0, grep: 0, webfetch: 0, websearch: 0, lsp: 0,
  question: 1, skill: 1, todowrite: 1, task: 1,
  write: 1, edit: 1, apply_patch: 1,
  bash: 2,
}

export const DEFAULT_TAGS: Record<string, string[]> = {
  read: ["file_operation", "read_only"],
  write: ["file_operation", "write"],
  edit: ["file_operation", "write"],
  bash: ["shell", "execution"],
  glob: ["file_operation", "read_only", "search"],
  grep: ["file_operation", "read_only", "search"],
  webfetch: ["network", "read_only"],
  websearch: ["network", "read_only", "search"],
  task: ["agent", "subtask"],
  question: ["interaction"],
  todowrite: ["planning"],
  lsp: ["ide", "analysis"],
  skill: ["meta", "extension"],
  apply_patch: ["file_operation", "write"],
}

export class EngineAdapter {
  private engine: AgentEngine | null = null
  private toolAdapters = new Map<string, ToolAdapter>()

  createEngine(config?: Partial<EngineConfig>, persistFn?: EventBusPersistFn): AgentEngine {
    this.engine = new AgentEngine(config, persistFn)
    return this.engine
  }

  getEngine(): AgentEngine | null {
    return this.engine
  }

  registerTool(adapter: ToolAdapter): void {
    this.toolAdapters.set(adapter.name, adapter)

    if (!this.engine) return

    const cap: Capability = {
      capability_id: adapter.name,
      name: adapter.name,
      description: adapter.description,
      input_schema: { inputs: "object" },
      output_schema: { result: "object" },
      tags: adapter.tags,
      risk_level: adapter.risk_level,
      total_calls: 0,
      success_rate: 1.0,
      avg_duration_ms: 0,
      avg_token_cost: 0,
      handler: async (inputs: Record<string, unknown>) => {
        return adapter.execute(inputs)
      },
    }

    this.engine.registry.register(cap)
  }

  registerTools(adapters: ToolAdapter[]): void {
    for (const adapter of adapters) {
      this.registerTool(adapter)
    }
  }

  createNodeFromToolCall(toolName: string, inputs: Record<string, unknown>): DAGNode {
    return {
      node_id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      capability_id: toolName,
      inputs,
      dependencies: [],
      risk_level: this.toolAdapters.get(toolName)?.risk_level ?? 0,
      estimated_tokens: 100,
      estimated_duration_ms: 5000,
      status: "pending",
    }
  }

  async runWithEngine(
    sessionId: string,
    goal: string,
    workspaceHash: string,
  ): Promise<{
    completed: boolean
    allSucceeded: boolean
    stepCount: number
    tokenUsage: number
  }> {
    if (!this.engine) {
      throw new Error("Engine not initialized. Call createEngine() first.")
    }

    await this.engine.initialize(sessionId, goal, workspaceHash)

    const caps = this.engine.registry.getAll()
    await this.engine.plan(goal, caps)

    let completed = false
    let allSucceeded = false
    const maxSteps = this.engine.maxSteps
    const terminalStates = new Set(["ERROR", "FAILED", "SHUTTING_DOWN", "COMPLETED"])

    for (let i = 0; i < maxSteps && !completed; i++) {
      if (terminalStates.has(this.engine.stateMachine.state)) break
      await this.engine.createCheckpoint()
      const result = await this.engine.executeStep()
      completed = result.completed
      allSucceeded = result.allSucceeded
    }

    const snap = this.engine.getSnapshot()
    return {
      completed,
      allSucceeded,
      stepCount: snap.stepCount,
      tokenUsage: snap.tokenUsage,
    }
  }

  async buildToolAdaptersFromRegistry(
    registry: ToolRegistry.Interface,
    riskMap?: Record<string, number>,
  ): Promise<ToolAdapter[]> {
    const mergedRiskMap = { ...DEFAULT_RISK_MAP, ...riskMap }

    try {
      const toolDefs = await Effect.runPromise(registry.all())
      return toolDefs.map((def) => {
        const adapter: ToolAdapter = {
          name: def.id,
          description: def.description,
          risk_level: (mergedRiskMap[def.id] ?? 0) as 0 | 1 | 2 | 3,
          tags: DEFAULT_TAGS[def.id] ?? ["general"],
          execute: async (inputs: Record<string, unknown>) => {
            try {
              const result = await Effect.runPromise(
                def.execute(inputs as any, {
                  sessionID: "engine" as any,
                  messageID: "engine" as any,
                  agent: "primary",
                  abort: new AbortController().signal,
                  messages: [],
                  metadata: () => Effect.void,
                  ask: () => Effect.void,
                } as any),
              )
              return { output: result.output, metadata: result.metadata } as unknown as Record<string, unknown>
            } catch (error) {
              return {
                error: `Tool execution failed: ${String(error)}`,
                tool: def.id,
                inputs,
              }
            }
          },
        }
        return adapter
      })
    } catch {
      // Fallback: registry.all() failed (e.g., no Effect runtime)
      return this.buildToolAdaptersFromDefs([], riskMap)
    }
  }

  buildToolAdaptersFromDefs(
    toolDefs: Array<{ id: string; description: string; execute?: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>> }>,
    riskMap?: Record<string, number>,
  ): ToolAdapter[] {
    const mergedRiskMap = { ...DEFAULT_RISK_MAP, ...riskMap }
    const adapters: ToolAdapter[] = []

    for (const def of toolDefs) {
      const riskLevel = (mergedRiskMap[def.id] ?? 0) as 0 | 1 | 2 | 3

      adapters.push({
        name: def.id,
        description: def.description ?? `Tool: ${def.id}`,
        risk_level: riskLevel,
        tags: DEFAULT_TAGS[def.id] ?? ["general"],
        execute: def.execute ?? (async (inputs: Record<string, unknown>) => {
          return { executed: true, tool: def.id, inputs }
        }),
      })
    }

    return adapters
  }
}

export function createEngineAdapter(config?: Partial<EngineConfig>, persistFn?: EventBusPersistFn): EngineAdapter {
  const adapter = new EngineAdapter()
  adapter.createEngine(config, persistFn)
  return adapter
}

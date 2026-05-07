/**
 * YunPat Agent 工厂
 *
 * 简化 YunPat Agent 的初始化过程，提供共享的基础设施实例
 */

import { loadYunPatModule } from "./yunpat-loader.js"
import type { PatentPluginContext } from "../types.js"

/**
 * Agent 基础设施
 */
export interface AgentInfrastructure {
  eventBus: any
  memory: any
  tools: any
}

let infraCache: AgentInfrastructure | null = null

/**
 * 获取共享的 Agent 基础设施
 */
export async function getAgentInfrastructure(): Promise<AgentInfrastructure | null> {
  if (infraCache) return infraCache

  const core = await loadYunPatModule("core")
  if (!core) {
    console.warn("[YunPat] Core module not available, infrastructure limited")
    return null
  }

  try {
    infraCache = {
      eventBus: new (core.InMemoryEventBus || core.EventBus)(),
      memory: new (core.InMemoryMemoryStore || core.MemoryStore)(),
      tools: new (core.ToolRegistry)(),
    }
    return infraCache
  } catch (error) {
    console.warn("[YunPat] Failed to initialize infrastructure:", error)
    return null
  }
}

/**
 * 创建 ProfessionalAgent 配置
 */
export async function createAgentConfig(context: PatentPluginContext) {
  const infra = await getAgentInfrastructure()

  if (!infra) {
    // 降级：仅返回 LLM 配置
    return {
      llm: context.llm,
      maxIterations: 10,
      timeout: 300000,
    }
  }

  return {
    llm: context.llm,
    eventBus: infra.eventBus,
    memory: infra.memory,
    tools: infra.tools,
    maxIterations: 10,
    timeout: 300000,
  }
}

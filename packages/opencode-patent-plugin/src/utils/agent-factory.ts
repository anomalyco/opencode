/**
 * YunPat Agent 工厂
 *
 * 简化 YunPat Agent 的初始化过程，提供共享的基础设施实例
 */

import { EventBus, InMemoryEventBus } from "@yunpat/core"
import { InMemoryMemoryStore } from "@yunpat/core"
import { ToolRegistry } from "@yunpat/core"
import type { PatentPluginContext } from "../types.js"

/**
 * Agent 基础设施
 */
export interface AgentInfrastructure {
  eventBus: EventBus
  memory: InMemoryMemoryStore
  tools: ToolRegistry
}

let infraCache: AgentInfrastructure | null = null

/**
 * 获取共享的 Agent 基础设施
 */
export function getAgentInfrastructure(): AgentInfrastructure {
  if (infraCache) return infraCache

  infraCache = {
    eventBus: new InMemoryEventBus(),
    memory: new InMemoryMemoryStore(),
    tools: new ToolRegistry(),
  }

  return infraCache
}

/**
 * 创建 ProfessionalAgent 配置
 */
export function createAgentConfig(context: PatentPluginContext) {
  const infra = getAgentInfrastructure()

  return {
    llm: context.llm,
    eventBus: infra.eventBus,
    memory: infra.memory,
    tools: infra.tools,
    maxIterations: 10,
    timeout: 300000, // 5 minutes
  }
}

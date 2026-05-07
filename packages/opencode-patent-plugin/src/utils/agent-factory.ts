/**
 * YunPat Agent 工厂
 *
 * 简化 YunPat Agent 的初始化过程，提供共享的基础设施实例。
 * 所有 Tool 共用同一套 EventBus/Memory/Tools 基础设施，避免重复创建。
 */

import { loadYunPatModule } from "./yunpat-loader.js"
import type { PatentPluginContext } from "../types.js"

/**
 * Agent 基础设施
 */
export interface AgentInfrastructure {
  eventBus: unknown
  memory: unknown
  tools: unknown
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
 * 创建共享 Agent 上下文（EventBus/Memory/Tools）
 *
 * 替代 yunpat-loader.ts 中的 createAgentContext()，
 * 使用全局共享实例而非每次创建新的。
 */
export async function createSharedAgentContext(): Promise<{
  eventBus: unknown
  memory: unknown
  tools: unknown
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void }
} | null> {
  const infra = await getAgentInfrastructure()
  if (!infra) return null

  return {
    ...infra,
    logger: {
      info: (...args: unknown[]) => console.log("[YunPat]", ...args),
      warn: (...args: unknown[]) => console.warn("[YunPat]", ...args),
      error: (...args: unknown[]) => console.error("[YunPat]", ...args),
      debug: () => {},
    },
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

/**
 * Agent 执行包装器
 *
 * 安全地运行 YunPat Agent，处理：
 * - 输入验证和格式化
 * - 超时控制
 * - 错误捕获和降级
 * - 执行指标记录
 */

import { loadYunPatModule } from "./yunpat-loader.js"
import { createSharedAgentContext } from "./agent-factory.js"
import type { PatentPluginContext } from "../types.js"

export interface AgentRunResult<T = any> {
  success: boolean
  data?: T
  error?: string
  duration: number
  mode: "agent" | "llm-fallback"
}

export interface AgentConfig {
  module: string
  className: string
  timeout?: number
  maxIterations?: number
  enableKnowledgeGraph?: boolean
}

/**
 * 安全运行 Agent
 */
export async function runAgentSafely<T = any>(
  config: AgentConfig,
  input: Record<string, any>,
  pluginContext: PatentPluginContext,
): Promise<AgentRunResult<T>> {
  const start = Date.now()
  const timeout = config.timeout ?? 30000

  try {
    // 加载模块
    const mod = await loadYunPatModule(config.module)
    if (!mod?.[config.className]) {
      return {
        success: false,
        error: `Agent ${config.className} not found in ${config.module}`,
        duration: Date.now() - start,
        mode: "agent",
      }
    }

    // 创建共享上下文
    const context = await createSharedAgentContext()
    if (!context) {
      return {
        success: false,
        error: "Failed to create agent context",
        duration: Date.now() - start,
        mode: "agent",
      }
    }

    // 实例化 Agent
    const AgentClass = mod[config.className]
    const agent = new AgentClass({
      llm: pluginContext.llm,
      name: config.className.toLowerCase(),
      description: `${config.className} agent`,
      eventBus: context.eventBus,
      memory: context.memory,
      tools: context.tools,
      maxIterations: config.maxIterations ?? 3,
      timeout,
      enableKnowledgeGraph: config.enableKnowledgeGraph ?? false,
    })

    // 执行（带超时）
    const result = await Promise.race([
      agent.run ? agent.run(input, context) : agent.execute(input),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)),
    ])

    const duration = Date.now() - start

    // Agent 返回的结果可能是 { success, data, error } 或直接是数据
    if (result && typeof result === "object") {
      if ("success" in result) {
        return {
          success: result.success as boolean,
          data: result.data as T,
          error: result.error as string,
          duration,
          mode: "agent",
        }
      }
    }

    return {
      success: true,
      data: result as T,
      duration,
      mode: "agent",
    }
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || String(error),
      duration: Date.now() - start,
      mode: "agent",
    }
  }
}

/**
 * 带 LLM 降级的 Agent 执行
 */
export async function runAgentWithFallback<T = any>(
  config: AgentConfig,
  input: Record<string, any>,
  pluginContext: PatentPluginContext,
  fallbackPrompt: string,
): Promise<AgentRunResult<T>> {
  // 先尝试 Agent
  const agentResult = await runAgentSafely<T>(config, input, pluginContext)
  if (agentResult.success) {
    return agentResult
  }

  console.warn(`[AgentRunner] ${config.className} failed: ${agentResult.error}. Falling back to LLM.`)

  // LLM 降级
  const start = Date.now()
  try {
    const response = await pluginContext.llm.chat({
      messages: [
        { role: "system", content: "你是专利智能助手。请根据输入信息提供专业分析。" },
        { role: "user", content: fallbackPrompt },
      ],
    })

    return {
      success: true,
      data: response.content as unknown as T,
      duration: Date.now() - start,
      mode: "llm-fallback",
    }
  } catch (llmError: any) {
    return {
      success: false,
      error: `Agent failed: ${agentResult.error}; LLM fallback also failed: ${llmError?.message}`,
      duration: Date.now() - start,
      mode: "llm-fallback",
    }
  }
}

/**
 * Agent 配置注册表（正确的类名和输入格式）
 */
export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  // === 已有 Agent（13 个）===
  researcher: { module: "agents/researcher", className: "ResearcherAgent" },
  patentSearch: { module: "agents/search", className: "PatentSearchAgentV3", timeout: 60000 },
  patentSearchV2: { module: "agents/search", className: "PatentSearchAgent", timeout: 30000 },
  inventionUnderstanding: { module: "agents/invention", className: "InventionUnderstandingAgent" },
  specificationDrafter: { module: "agents/specification-drafter", className: "SpecificationDrafterAgent" },
  claimGenerator: { module: "agents/claim-generator", className: "ClaimGeneratorAgent" },
  abstractDrafter: { module: "agents/abstract-drafter", className: "AbstractDrafterAgent" },
  patentResponderV5: { module: "agents/patent-responder", className: "PatentResponderAgentV5", timeout: 60000 },
  patentResponder: { module: "agents/patent-responder", className: "PatentResponderAgent", timeout: 30000 },
  comparisonAnalyzer: { module: "agents/patent-analyzer", className: "ComparisonAnalyzerAgent" },
  qualityChecker: { module: "agents/quality", className: "QualityCheckerAgent" },
  enhancedQualityChecker: { module: "agents/quality", className: "EnhancedQualityCheckerAgent" },
  writer: { module: "agents/writer", className: "WriterAgent", timeout: 60000 },

  // === 新增 Agent（+12 个，CONSTITUTION 10.6）===

  // 分析类
  // 注：patent-analyzer 只导出 ComparisonAnalyzerAgent，CreativeAnalyzerAgent 待 YunPat 实现
  // creativeAnalyzer: { module: "agents/patent-analyzer", className: "CreativeAnalyzerAgent" },
  priorArtAnalyzer: { module: "agents/analysis", className: "PriorArtAnalyzerAgent" },
  disclosureRefiner: { module: "agents/analysis", className: "DisclosureRefinerAgent" },
  comparisonReportGenerator: { module: "agents/analysis", className: "ComparisonReportGeneratorAgent" },

  // 检查类
  subjectMatterChecker: { module: "agents/subject-matter-checker", className: "SubjectMatterChecker" },
  specFormalityChecker: { module: "agents/spec-formality-checker", className: "SpecFormalityChecker" },
  unityChecker: { module: "agents/unity-checker", className: "UnityChecker" },

  // 检索类
  priorArtSearch: { module: "agents/prior-art-search", className: "PriorArtSearchAgent" },

  // 转换类
  formatConverter: { module: "agents/format-converter", className: "PatentFormatConverterAgent" },

  // 多模态类
  drawingUnderstanding: { module: "agents/image-understanding", className: "DrawingUnderstandingAgent" },
  technicalDrawing: { module: "agents/technical-drawing", className: "TechnicalDrawingAgent" },
}

/**
 * YunPat Patent Plugin 共享类型
 */

import type { OpenCodeLLMAdapter } from "./adapters/llm.js"

/**
 * Plugin 共享上下文
 */
export interface PatentPluginContext {
  /** OpenCode SDK 客户端 */
  client: any
  /** YunPat LLM 适配器 */
  llm: OpenCodeLLMAdapter
  /** 当前工作目录 */
  directory: string
  /** Git worktree 根目录 */
  worktree: string
  /** Plugin 配置选项 */
  options?: Record<string, unknown>
}

/**
 * 专利任务结果
 */
export interface PatentTaskResult {
  /** 是否成功 */
  success: boolean
  /** 输出内容（Markdown） */
  content: string
  /** 元数据 */
  metadata?: Record<string, unknown>
  /** 错误信息 */
  error?: string
}

/**
 * YunPat Agent 结果（动态加载时使用的通用接口）
 */
export interface AgentResult {
  success: boolean
  data: unknown
  error?: Error
  executionTime: number
  requiresHITL?: boolean
  hitlCheckpoint?: string
}

/**
 * 研究查询参数
 */
export interface ResearchQuery {
  question: string
  depth?: "quick" | "standard" | "comprehensive"
  sources?: Array<"web" | "academic" | "database">
  timeRange?: "day" | "week" | "month" | "year" | "all"
  maxResults?: number
}

/**
 * 研究计划
 */
export interface ResearchPlan {
  searchStrategy: {
    keywords: string[]
    queries: string[]
    sourcePriority: string[]
  }
  extractionStrategy: {
    infoTypes: string[]
    dataPoints: string[]
  }
  analysisStrategy: {
    dimensions: string[]
    criteria: string[]
  }
}

/**
 * 研究结果
 */
export interface ResearchResult {
  summary: string
  keyFindings: string[]
  sources: Array<{
    title: string
    url?: string
    summary: string
  }>
  analysis: {
    trends: string[]
    comparisons: Array<{
      dimension: string
      findings: string[]
    }>
    knowledgeGraph: Array<{
      entity: string
      relations: Array<{
        target: string
        type: string
      }>
    }>
  }
}

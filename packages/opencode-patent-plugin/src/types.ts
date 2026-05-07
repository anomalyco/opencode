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
  options: Record<string, unknown>
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

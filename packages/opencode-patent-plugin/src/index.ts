/**
 * YunPat Patent Plugin for OpenCode
 *
 * 将 YunPat 知识产权智能体能力封装为 OpenCode Plugin
 */

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { createDefaultLLM } from "./adapters/llm.js"
import { registerResearchTools } from "./tools/research.js"
import { registerDraftTools } from "./tools/draft.js"
import { registerOATools } from "./tools/oa.js"
import { registerSearchTools } from "./tools/search.js"
import { registerAnalyzeTools } from "./tools/analyze.js"
import { registerCheckTools } from "./tools/check.js"

/**
 * YunPat Patent Plugin 入口
 *
 * 封装 YunPat 29 个 Agent 为 OpenCode Plugin Tools
 */
const PatentPlugin: Plugin = async (input, options) => {
  const { client, directory, worktree } = input

  // 初始化 LLM 适配器（桥接 OpenCode → YunPat）
  const llm = createDefaultLLM(client, {
    modelId: (options?.model as string) ?? undefined,
    providerId: (options?.provider as string) ?? undefined,
    temperature: (options?.temperature as number) ?? 0.3,
  })

  // 初始化共享上下文
  const context = {
    client,
    llm,
    directory,
    worktree,
    options,
  }

  // 注册所有 Patent Tools
  const researchTools = await registerResearchTools(context)
  const draftTools = await registerDraftTools(context)
  const oaTools = await registerOATools(context)
  const searchTools = await registerSearchTools(context)
  const analyzeTools = await registerAnalyzeTools(context)
  const checkTools = await registerCheckTools(context)

  return {
    // 注册专利工具集
    tool: {
      ...researchTools,
      ...draftTools,
      ...oaTools,
      ...searchTools,
      ...analyzeTools,
      ...checkTools,
    },

    // 注入专利领域系统提示词
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        `你是 YunPat 知识产权智能助手，基于 OpenCode 平台运行。`,
        `当用户涉及专利、商标、版权等知识产权问题时，优先使用 patent_* 系列工具。`,
        `你的能力包括：法规研究、专利撰写、审查意见答辩、专利分析、质量检查。`,
        `所有法律文件生成后必须标记为"草案"状态，需经专业审校。`,
        `涉及未公开发明内容的操作需经用户明确审批。`,
      )
    },

    // 专利操作审批策略
    "permission.ask": async (permission, output) => {
      const perm = permission.type
      const patterns = Array.isArray(permission.pattern) ? permission.pattern : [permission.pattern].filter(Boolean)

      // 公开数据库检索：自动放行
      if (perm === "patent_search" || perm === "patent_research") {
        output.status = "allow"
        return
      }

      // 分析/检查操作：自动放行
      if (perm === "patent_analyze" || perm === "patent_check") {
        output.status = "allow"
        return
      }

      // 撰写/修改操作：需要审批
      if (perm.startsWith("patent_draft") || perm.startsWith("oa_response") || perm.startsWith("reexam") || perm.startsWith("invalidation")) {
        output.status = "ask"
        return
      }

      // 默认：询问
      output.status = "ask"
    },

    // 事件监听：记录专利操作审计日志
    "tool.execute.after": async (event, _output) => {
      const toolId = event.tool
      if (toolId?.startsWith("patent_") || toolId?.startsWith("oa_") || toolId?.startsWith("reexam_") || toolId?.startsWith("invalidation_")) {
        console.log(`[YunPat Audit] ${toolId} executed in session ${event.sessionID}`)
      }
    },
  }
}

export default PatentPlugin

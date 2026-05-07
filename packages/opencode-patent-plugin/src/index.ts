/**
 * YunPat Patent Plugin for OpenCode
 *
 * 将 YunPat 知识产权智能体能力封装为 OpenCode Plugin
 */

import type { Plugin } from "@opencode-ai/plugin"
import { createDefaultLLM } from "./adapters/llm.js"
import { registerResearchTools } from "./tools/research.js"
import { registerDraftTools } from "./tools/draft.js"
import { registerOATools } from "./tools/oa.js"
import { registerSearchTools } from "./tools/search.js"
import { registerAnalyzeTools } from "./tools/analyze.js"
import { registerCheckTools } from "./tools/check.js"
import { registerReexamTools } from "./tools/reexam.js"
import { registerInvalidationTools } from "./tools/invalidation.js"
import { getCaseStore, type TaskType } from "./utils/case-store.js"
import { checkDBHealth } from "./utils/db.js"

/**
 * YunPat Patent Plugin 入口
 *
 * 封装 YunPat 29 个 Agent 为 OpenCode Plugin Tools
 */
const PatentPlugin: Plugin = async (input, options) => {
  const { client, directory, worktree } = input

  // 初始化 LLM 适配器（使用 fetch 调用 OpenAI-compatible API）
  const llm = createDefaultLLM(client, options)

  // 启动时检查数据库连接（异步不阻塞）
  Promise.all([
    checkDBHealth().then(h => {
      if (h.ok) console.log(`[YunPat] patent_db 连接正常 (${h.latencyMs}ms)`)
      else console.warn(`[YunPat] ⚠️ patent_db 连接失败: ${h.error}`)
    }),
    checkDBHealth({ database: "legal_world_model" }).then(h => {
      if (h.ok) console.log(`[YunPat] legal_world_model 连接正常 (${h.latencyMs}ms)`)
      else console.warn(`[YunPat] ⚠️ legal_world_model 连接失败: ${h.error}`)
    }),
  ]).catch(() => { /* 健康检查失败不阻塞启动 */ })

  // 初始化共享上下文
  const context = {
    client,
    llm,
    directory,
    worktree,
    options,
  }

  // 注册所有 Patent Tools（每个注册独立 try/catch，单个工具失败不影响其他）
  const failedRegistrations: string[] = []

  const researchTools = await registerResearchTools(context).catch(e => { console.error("[YunPat] Research tools failed:", e); failedRegistrations.push("research"); return {} })
  const draftTools = await registerDraftTools(context).catch(e => { console.error("[YunPat] Draft tools failed:", e); failedRegistrations.push("draft"); return {} })
  const oaTools = await registerOATools(context).catch(e => { console.error("[YunPat] OA tools failed:", e); failedRegistrations.push("oa"); return {} })
  const searchTools = await registerSearchTools(context).catch(e => { console.error("[YunPat] Search tools failed:", e); failedRegistrations.push("search"); return {} })
  const analyzeTools = await registerAnalyzeTools(context).catch(e => { console.error("[YunPat] Analyze tools failed:", e); failedRegistrations.push("analyze"); return {} })
  const checkTools = await registerCheckTools(context).catch(e => { console.error("[YunPat] Check tools failed:", e); failedRegistrations.push("check"); return {} })
  const reexamTools = await registerReexamTools(context).catch(e => { console.error("[YunPat] Reexam tools failed:", e); failedRegistrations.push("reexam"); return {} })
  const invalidationTools = await registerInvalidationTools(context).catch(e => { console.error("[YunPat] Invalidation tools failed:", e); failedRegistrations.push("invalidation"); return {} })

  if (failedRegistrations.length > 0) {
    console.warn(`[YunPat] ⚠️ 以下工具注册失败，相关功能不可用: ${failedRegistrations.join(", ")}`)
  }

  return {
    // 注册专利工具集
    tool: {
      ...researchTools,
      ...draftTools,
      ...oaTools,
      ...searchTools,
      ...analyzeTools,
      ...checkTools,
      ...reexamTools,
      ...invalidationTools,
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

    // 事件监听：记录专利操作审计日志 + 案件任务追踪
    "tool.execute.after": async (event, _output) => {
      const toolId = event.tool
      if (toolId?.startsWith("patent_") || toolId?.startsWith("oa_") || toolId?.startsWith("reexam_") || toolId?.startsWith("invalidation_")) {
        console.log(`[YunPat Audit] ${toolId} executed in session ${event.sessionID}`)

        // 记录到案件任务表
        try {
          const store = getCaseStore()
          const taskTypeMap: Record<string, TaskType> = {
            patent_research: "research",
            patent_draft: "draft",
            oa_response: "oa",
            patent_search: "research",
            patent_analyze: "analyze",
            patent_check: "check",
            reexam_response: "reexam",
            invalidation_response: "invalidation",
          }
          const taskType = taskTypeMap[toolId]
          if (taskType) {
            store.createTask({
              sessionId: event.sessionID,
              taskType,
              toolName: toolId,
            })
          }
        } catch (e: any) {
          console.warn("[YunPat] Case store recording failed:", e?.message)
        }
      }
    },
  }
}

export default PatentPlugin

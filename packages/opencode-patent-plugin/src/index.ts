/**
 * YunPat Patent Plugin for OpenCode
 *
 * 将 YunPat 知识产权智能体能力封装为 OpenCode Plugin
 */

import type { Plugin } from "@yunpat/plugin"
import { createDefaultLLM } from "./adapters/llm.js"
import { registerResearchTools } from "./tools/research.js"
import { registerDraftTools } from "./tools/draft.js"
import { registerOATools } from "./tools/oa.js"
import { registerSearchTools } from "./tools/search.js"
import { registerAnalyzeTools } from "./tools/analyze.js"
import { registerCheckTools } from "./tools/check.js"
import { registerReexamTools } from "./tools/reexam.js"
import { registerInvalidationTools } from "./tools/invalidation.js"
import { registerTrademarkResearchTools } from "./tools/trademark-research.js"
import { registerTrademarkSearchTools } from "./tools/trademark-search.js"
import { registerTrademarkAnalyzeTools } from "./tools/trademark-analyze.js"
import { registerTrademarkDraftTools } from "./tools/trademark-draft.js"
import { registerTrademarkOppositionTools } from "./tools/trademark-opposition.js"
import { registerTrademarkReviewTools } from "./tools/trademark-review.js"
import { registerDocumentReaderTools } from "./tools/document-reader.js"
import { registerFileWriterTools } from "./tools/file-writer.js"
import { registerMemoryTools } from "./tools/task-memory.js"
import { registerCaseTools } from "./tools/case-manager.js"
import { createPermissionHandler } from "./hooks/permission.js"
import { createSystemPromptHandler } from "./hooks/system-prompt.js"
import { createAuditLogHandler } from "./hooks/audit-log.js"
import { existsSync } from "fs"
import { checkDBHealth } from "./utils/db.js"
import { getWorkflowStore } from "./utils/workflow-store.js"
import { seedTemplates } from "./utils/workflow-seeds.js"
import { warmUpAvailabilityCache } from "./utils/agent-health.js"
import { restorePersistedFlows } from "./services/workflow-orchestrator.js"

/**
 * YunPat Patent Plugin 入口
 *
 * 封装 YunPat 29 个 Agent 为 OpenCode Plugin Tools
 */
const PatentPlugin: Plugin = async (input, options) => {
  const { client, directory, worktree } = input

  // 初始化 LLM 适配器（使用 fetch 调用 OpenAI-compatible API）
  const llm = createDefaultLLM(client, options)

  // 启动时基础设施诊断（异步不阻塞）
  Promise.all([
    // PostgreSQL 健康检查
    checkDBHealth().then(h => {
      if (h.ok) console.log(`[YunPat] ✅ patent_db 连接正常 (${h.latencyMs}ms)`)
      else console.warn(`[YunPat] ⚠️ patent_db 连接失败: ${h.error}`)
    }),
    checkDBHealth({ database: "legal_world_model" }).then(h => {
      if (h.ok) console.log(`[YunPat] ✅ legal_world_model 连接正常 (${h.latencyMs}ms)`)
      else console.warn(`[YunPat] ⚠️ legal_world_model 连接失败: ${h.error}`)
    }),
    // YunPat Agent 路径检测
    Promise.resolve().then(() => {
      const yunpatPath = process.env.YUNPAT_PATH
      if (yunpatPath) {
        try {
          if (existsSync(yunpatPath)) {
            console.log(`[YunPat] ✅ YUNPAT_PATH=${yunpatPath}`)
          } else {
            console.warn(`[YunPat] ⚠️ YUNPAT_PATH 路径不存在: ${yunpatPath}`)
          }
        } catch { /* ignore */ }
      } else {
        console.log(`[YunPat] ℹ️ YUNPAT_PATH 未设置，使用纯 LLM 模式`)
      }
    }),
    // Obsidian KB 检测
    Promise.resolve().then(() => {
      const kbPath = process.env.OBSIDIAN_KB_PATH
      if (kbPath) {
        try {
          if (existsSync(kbPath)) {
            console.log(`[YunPat] ✅ OBSIDIAN_KB_PATH=${kbPath}`)
          } else {
            console.warn(`[YunPat] ⚠️ OBSIDIAN_KB_PATH 路径不存在: ${kbPath}`)
          }
        } catch { /* ignore */ }
      } else {
        console.log(`[YunPat] ℹ️ OBSIDIAN_KB_PATH 未设置，知识库查询不可用`)
      }
    }),
    // Agent 可用性预热
    warmUpAvailabilityCache(),
    // 恢复上次未完成的工作流
    Promise.resolve().then(() => restorePersistedFlows()),
  ]).catch(() => { /* 诊断失败不阻塞启动 */ })

  // 初始化工作流模板种子
  try {
    const wfStore = getWorkflowStore()
    seedTemplates(wfStore)
  } catch (e: any) {
    console.warn(`[YunPat] ⚠️ 工作流模板初始化失败: ${e?.message}`)
  }

  // 初始化共享上下文
  const context = {
    client,
    llm,
    directory,
    worktree,
    options,
  }

  // 并行注册所有 Patent Tools（每个注册独立 try/catch，单个工具失败不影响其他）
  const toolRegistrations: Array<{ name: string; fn: () => Promise<Record<string, unknown>> }> = [
    { name: "research", fn: () => registerResearchTools(context) },
    { name: "draft", fn: () => registerDraftTools(context) },
    { name: "oa", fn: () => registerOATools(context) },
    { name: "search", fn: () => registerSearchTools(context) },
    { name: "analyze", fn: () => registerAnalyzeTools(context) },
    { name: "check", fn: () => registerCheckTools(context) },
    { name: "reexam", fn: () => registerReexamTools(context) },
    { name: "invalidation", fn: () => registerInvalidationTools(context) },
    { name: "tm_research", fn: () => registerTrademarkResearchTools(context) },
    { name: "tm_search", fn: () => registerTrademarkSearchTools(context) },
    { name: "tm_analyze", fn: () => registerTrademarkAnalyzeTools(context) },
    { name: "tm_draft", fn: () => registerTrademarkDraftTools(context) },
    { name: "tm_opposition", fn: () => registerTrademarkOppositionTools(context) },
    { name: "tm_review", fn: () => registerTrademarkReviewTools(context) },
    { name: "document", fn: () => registerDocumentReaderTools(context) },
    { name: "file_writer", fn: () => registerFileWriterTools(context) },
    { name: "memory", fn: () => registerMemoryTools(context) },
    { name: "case", fn: () => registerCaseTools(context) },
  ]

  const failedRegistrations: string[] = []
  const registrationResults = await Promise.all(
    toolRegistrations.map(({ name, fn }) =>
      fn().catch(e => {
        console.error(`[YunPat] ${name} tools failed:`, e)
        failedRegistrations.push(name)
        return {} as Record<string, any>
      })
    ),
  )

  if (failedRegistrations.length > 0) {
    console.warn(`[YunPat] ⚠️ 以下工具注册失败，相关功能不可用: ${failedRegistrations.join(", ")}`)
  }

  // 合并所有工具注册结果
  const allTools: Record<string, any> = {}
  for (const result of registrationResults) {
    Object.assign(allTools, result)
  }

  return {
    tool: allTools,

    // 注入专利领域系统提示词
    "experimental.chat.system.transform": createSystemPromptHandler(),

    // 专利操作审批策略
    "permission.ask": createPermissionHandler(),

    // 事件监听：记录专利操作审计日志 + 案件任务追踪
    "tool.execute.after": createAuditLogHandler(),
  }
}

export default PatentPlugin

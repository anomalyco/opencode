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
import { checkDBHealth } from "./utils/db.js"
import { getWorkflowStore } from "./utils/workflow-store.js"
import { seedTemplates } from "./utils/workflow-seeds.js"

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
          const fs = require("fs")
          if (fs.existsSync(yunpatPath)) {
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
          const fs = require("fs")
          if (fs.existsSync(kbPath)) {
            console.log(`[YunPat] ✅ OBSIDIAN_KB_PATH=${kbPath}`)
          } else {
            console.warn(`[YunPat] ⚠️ OBSIDIAN_KB_PATH 路径不存在: ${kbPath}`)
          }
        } catch { /* ignore */ }
      } else {
        console.log(`[YunPat] ℹ️ OBSIDIAN_KB_PATH 未设置，知识库查询不可用`)
      }
    }),
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
  const tmResearchTools = await registerTrademarkResearchTools(context).catch(e => { console.error("[YunPat] TM Research tools failed:", e); failedRegistrations.push("tm_research"); return {} })
  const tmSearchTools = await registerTrademarkSearchTools(context).catch(e => { console.error("[YunPat] TM Search tools failed:", e); failedRegistrations.push("tm_search"); return {} })
  const tmAnalyzeTools = await registerTrademarkAnalyzeTools(context).catch(e => { console.error("[YunPat] TM Analyze tools failed:", e); failedRegistrations.push("tm_analyze"); return {} })
  const tmDraftTools = await registerTrademarkDraftTools(context).catch(e => { console.error("[YunPat] TM Draft tools failed:", e); failedRegistrations.push("tm_draft"); return {} })
  const tmOppositionTools = await registerTrademarkOppositionTools(context).catch(e => { console.error("[YunPat] TM Opposition tools failed:", e); failedRegistrations.push("tm_opposition"); return {} })
  const tmReviewTools = await registerTrademarkReviewTools(context).catch(e => { console.error("[YunPat] TM Review tools failed:", e); failedRegistrations.push("tm_review"); return {} })
  const documentTools = await registerDocumentReaderTools(context).catch(e => { console.error("[YunPat] Document Reader tools failed:", e); failedRegistrations.push("document"); return {} })
  const fileWriterTools = await registerFileWriterTools(context).catch(e => { console.error("[YunPat] File Writer tools failed:", e); failedRegistrations.push("file_writer"); return {} })
  const memoryTools = await registerMemoryTools(context).catch(e => { console.error("[YunPat] Memory tools failed:", e); failedRegistrations.push("memory"); return {} })
  const caseTools = await registerCaseTools(context).catch(e => { console.error("[YunPat] Case tools failed:", e); failedRegistrations.push("case"); return {} })

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
      ...tmResearchTools,
      ...tmSearchTools,
      ...tmAnalyzeTools,
      ...tmDraftTools,
      ...tmOppositionTools,
      ...tmReviewTools,
      ...documentTools,
      ...fileWriterTools,
      ...memoryTools,
      ...caseTools,
    },

    // 注入专利领域系统提示词
    "experimental.chat.system.transform": createSystemPromptHandler(),

    // 专利操作审批策略
    "permission.ask": createPermissionHandler(),

    // 事件监听：记录专利操作审计日志 + 案件任务追踪
    "tool.execute.after": createAuditLogHandler(),
  }
}

export default PatentPlugin

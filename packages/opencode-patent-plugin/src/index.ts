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
import { getCaseStore, type TaskType } from "./utils/case-store.js"
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
    },

    // 注入专利领域系统提示词
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        `你是 YunPat 知识产权智能助手，基于 OpenCode 平台运行。`,
        `当用户涉及专利问题时，优先使用 patent_* 系列工具；涉及商标问题时，优先使用 trademark_* 系列工具。`,
        `你可以使用 document_read 工具读取 DOCX/PDF/图片等文档文件，提取技术交底书、对比文件等内容。`,
        `使用 file_write 工具将撰写稿、答辩书等产出保存到文件。`,
        `专利检索时：CNIPA 数据库（patent_search）用于中国专利，Google Patents（patent_search_google）用于全球专利，academic_search 用于学术论文检索。`,
        `你的能力包括：法规研究、专利撰写、审查意见答辩、专利分析、质量检查、商标全流程、文档解析、文件输出。`,
        `所有法律文件生成后必须标记为"草案"状态，需经专业审校。`,
        `涉及未公开发明内容的操作需经用户明确审批。`,
        // 跨会话记忆指令
        `【重要】你拥有跨会话记忆能力。在处理新任务时：`,
        `1. 先用 task_memory(action="search", task_type=..., keyword=...) 查询相似历史任务`,
        `2. 参考历史经验（输出摘要、关键词、策略）来指导当前工作`,
        `3. 如果用户提到之前做过的任务，用 task_memory 查找历史记录`,
        `4. 完成任务后，产出会自动保存到记忆系统，供未来复用`,
        `这确保了"做过的事不需要重复指导"，经验会持续积累。`,
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

      // 分析/检查/文档操作：自动放行
      if (perm === "patent_analyze" || perm === "patent_check" || perm === "trademark" || perm === "document" || perm === "memory") {
        output.status = "allow"
        return
      }

      // 文件写入：需要审批
      if (perm === "file") {
        output.status = "ask"
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
      if (toolId?.startsWith("patent_") || toolId?.startsWith("oa_") || toolId?.startsWith("reexam_") || toolId?.startsWith("invalidation_") || toolId?.startsWith("trademark_") || toolId === "document_read" || toolId === "academic_search" || toolId === "task_memory") {
        console.log(`[YunPat Audit] ${toolId} executed in session ${event.sessionID}`)

        // 记录到案件任务表（含输入输出）
        try {
          const store = getCaseStore()
          const taskTypeMap: Record<string, TaskType> = {
            patent_research: "research",
            patent_draft: "draft",
            oa_response: "oa",
            patent_search: "research",
            patent_search_google: "research",
            academic_search: "research",
            patent_analyze: "analyze",
            patent_check: "check",
            reexam_response: "reexam",
            invalidation_response: "invalidation",
            trademark_research: "trademark",
            trademark_search: "trademark",
            trademark_analyze: "trademark",
            trademark_draft: "trademark",
            trademark_opposition: "trademark",
            trademark_review: "trademark",
            document_read: "research",
            task_memory: "research",
          }
          const taskType = taskTypeMap[toolId]
          if (taskType) {
            const task = store.createTask({
              sessionId: event.sessionID,
              taskType,
              toolName: toolId,
            })
            // 记录输入输出
            const inputJson = JSON.stringify((event as any).input || {}).slice(0, 2000)
            const outputStr = typeof _output === "string" ? _output : JSON.stringify(_output || {})
            store.recordTaskIO(task.id, inputJson, outputStr)
            store.completeTask(task.id)
          }
        } catch (e: any) {
          console.warn("[YunPat] Case store recording failed:", e?.message)
        }
      }
    },
  }
}

export default PatentPlugin

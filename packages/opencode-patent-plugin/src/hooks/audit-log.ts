/**
 * 专利操作审计日志 Hook
 *
 * 监听工具执行完成后的事件，记录审计日志并写入案件任务表。
 * 自动将 Session 绑定到项目目录对应的案件。
 */

import { getCaseStore, type TaskType } from "../utils/case-store.js"

/** 工具 ID → 案件任务类型映射 */
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

/**
 * 创建 tool.execute.after 钩子
 */
export function createAuditLogHandler() {
  return async (event: any, _output: any) => {
    const toolId = event.tool
    if (toolId?.startsWith("patent_") || toolId?.startsWith("oa_") || toolId?.startsWith("reexam_") || toolId?.startsWith("invalidation_") || toolId?.startsWith("trademark_") || toolId === "document_read" || toolId === "academic_search" || toolId === "task_memory") {
      console.log(`[YunPat Audit] ${toolId} executed in session ${event.sessionID}`)

      // 记录到案件任务表（含输入输出）+ 自动绑定 Case
      try {
        const store = getCaseStore()
        const taskType = taskTypeMap[toolId]
        if (taskType) {
          // 自动绑定到项目目录对应的案件
          const projectDir = event.directory || ""
          let caseId: string | undefined
          if (projectDir) {
            try {
              const caseRecord = store.getOrCreateCaseForProject(projectDir)
              caseId = caseRecord.id
            } catch {
              // 案件创建失败不阻塞任务记录
            }
          }

          const task = store.createTask({
            caseId,
            sessionId: event.sessionID,
            taskType,
            toolName: toolId,
          })
          // 记录输入输出
          const inputJson = JSON.stringify((event as any).input || {}).slice(0, 2000)
          const outputStr = typeof _output === "string" ? _output : JSON.stringify(_output || {})
          store.recordTaskIO(task.id, inputJson, outputStr)
          store.completeTask(task.id)

          // 根据工具类型自动推进案件状态
          if (caseId) {
            autoTransitionCase(store, caseId, toolId, (event as any).input)
          }
        }
      } catch (e: any) {
        console.warn("[YunPat] Case store recording failed:", e?.message)
      }
    }
  }
}

/** 根据工具执行自动推进案件状态 */
function autoTransitionCase(
  store: ReturnType<typeof getCaseStore>,
  caseId: string,
  toolId: string,
  input: any,
) {
  // 撰写完成 → draft
  if (toolId === "patent_draft" && input?.action === "integrate") {
    store.transitionCaseStatus(caseId, "draft", "撰写完成")
  }
  // OA 答辩完成 → amended
  if (toolId === "oa_response" && input?.action === "validate") {
    store.transitionCaseStatus(caseId, "amended", "答辩完成")
  }
  // 复审请求完成 → reexam
  if (toolId === "reexam_response" && input?.action === "draft") {
    store.transitionCaseStatus(caseId, "reexam", "复审请求提交")
  }
  // 无效宣告 → invalidation_pending
  if (toolId === "invalidation_response" && (input?.action === "attack" || input?.action === "draft")) {
    store.transitionCaseStatus(caseId, "invalidation_pending", "无效宣告请求")
  }
}

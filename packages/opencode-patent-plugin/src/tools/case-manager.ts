/**
 * 案件管理工具
 *
 * 提供案件状态查询、列表、状态转换、历史查看等功能
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { getCaseStore, type CaseStatus } from "../utils/case-store.js"
import { getValidTransitions, getStatusLabel, getTransitionLabel, canTransition } from "../utils/case-state-machine.js"

export async function registerCaseTools(_pluginContext: PatentPluginContext) {
  return {
    patent_case: tool({
      description: `
        案件管理工具。查看案件状态、列表、历史，或手动推进案件状态。

        支持的动作：
        - status: 查看当前项目案件状态、任务历史、文档列表
        - list: 列出所有案件
        - transition: 手动推进案件状态（需校验合法性）
        - history: 查看案件完整操作时间线
      `,
      args: {
        action: tool.schema.enum(["status", "list", "transition", "history"]).describe("管理动作"),
        status_filter: tool.schema.string().optional().describe("过滤状态（用于 list 动作）"),
        new_status: tool.schema.string().optional().describe("目标状态（用于 transition 动作）"),
        case_id: tool.schema.string().optional().describe("案件 ID（用于 transition/history 动作）"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "patent_case",
          patterns: [args.action],
          always: [],
          metadata: { action: args.action },
        })

        const store = getCaseStore()

        switch (args.action) {
          case "status": return caseStatus(store, ctx.directory)
          case "list": return caseList(store, args.status_filter as CaseStatus | undefined)
          case "transition": return caseTransition(store, args.case_id || "", args.new_status as CaseStatus | undefined, ctx.directory)
          case "history": return caseHistory(store, args.case_id || "", ctx.directory)
          default: return `未知动作: ${args.action}`
        }
      },
    }),
  }
}

function caseStatus(store: ReturnType<typeof getCaseStore>, directory: string): string {
  const caseRecord = store.getOrCreateCaseForProject(directory)
  const tasks = store.getCaseTasks(caseRecord.id)
  const docs = store.getCaseDocuments(caseRecord.id)
  const stats = store.getStats()

  let output = `## 案件状态\n\n`
  output += `**案件 ID**：${caseRecord.id}\n`
  output += `**标题**：${caseRecord.title || "未命名"}\n`
  output += `**状态**：${getStatusLabel(caseRecord.status)}（${caseRecord.status}）\n`
  output += `**申请号**：${caseRecord.application_no || "未填写"}\n`
  output += `**专利类型**：${caseRecord.patent_type || "未填写"}\n`
  output += `**创建时间**：${new Date(caseRecord.created_at * 1000).toLocaleDateString("zh-CN")}\n\n`

  output += `### 可用状态转换\n\n`
  const transitions = getValidTransitions(caseRecord.status)
  if (transitions.length > 0) {
    transitions.forEach(t => {
      output += `- ${getStatusLabel(t)}（${t}）— ${getTransitionLabel(caseRecord.status, t)}\n`
    })
  } else {
    output += `*无可用的状态转换*\n`
  }
  output += `\n`

  output += `### 任务历史（${tasks.length} 条）\n\n`
  if (tasks.length > 0) {
    output += `| 时间 | 类型 | 工具 | 状态 |\n`
    output += `|------|------|------|------|\n`
    tasks.slice(0, 10).forEach(t => {
      const date = new Date(t.created_at * 1000).toLocaleDateString("zh-CN")
      output += `| ${date} | ${t.task_type} | ${t.tool_name || "-"} | ${t.status} |\n`
    })
    if (tasks.length > 10) output += `\n*显示最近 10 条，共 ${tasks.length} 条*\n`
  } else {
    output += `*暂无任务记录*\n`
  }
  output += `\n`

  output += `### 文档列表（${docs.length} 个）\n\n`
  if (docs.length > 0) {
    output += `| 类型 | 文件路径 | 版本 | 日期 |\n`
    output += `|------|---------|------|------|\n`
    docs.forEach(d => {
      const date = new Date(d.created_at * 1000).toLocaleDateString("zh-CN")
      output += `| ${d.doc_type} | ${d.file_path || "-"} | v${d.version} | ${date} |\n`
    })
  } else {
    output += `*暂无文档记录*\n`
  }
  output += `\n---\n*全局统计：${stats.cases} 个案件，${stats.documents} 个文档，${stats.tasks} 个任务*\n`

  return output
}

function caseList(store: ReturnType<typeof getCaseStore>, statusFilter?: CaseStatus): string {
  const cases = store.listCases(statusFilter)

  let output = `## 案件列表（${cases.length} 个${statusFilter ? `，筛选：${statusFilter}` : ""}）\n\n`
  if (cases.length > 0) {
    output += `| ID | 标题 | 状态 | 类型 | 更新时间 |\n`
    output += `|----|------|------|------|----------|\n`
    cases.forEach(c => {
      const date = new Date(c.updated_at * 1000).toLocaleDateString("zh-CN")
      const title = (c.title || "未命名").slice(0, 20)
      output += `| ${c.id.slice(0, 8)}... | ${title} | ${getStatusLabel(c.status)} | ${c.patent_type || "-"} | ${date} |\n`
    })
  } else {
    output += `*没有找到案件*\n`
  }

  return output
}

function caseTransition(
  store: ReturnType<typeof getCaseStore>,
  caseId: string,
  newStatus?: CaseStatus,
  directory?: string,
): string {
  if (!newStatus) {
    return `❌ 请指定 new_status 参数（目标状态）\n\n可用状态：draft, filed, under_exam, oa_issued, amended, allowed, granted, rejected, reexam, invalidation_pending, abandoned, expired, withdrawn`
  }

  // 如果没有指定 case_id，使用项目目录对应的案件
  const caseRecord = caseId
    ? store.getCase(caseId)
    : directory
      ? store.getOrCreateCaseForProject(directory)
      : null

  if (!caseRecord) {
    return `❌ 未找到案件（case_id=${caseId}）`
  }

  if (!canTransition(caseRecord.status, newStatus)) {
    const validNext = getValidTransitions(caseRecord.status)
    return `❌ 非法状态转换：${caseRecord.status} → ${newStatus}\n\n可转换到的状态：\n${validNext.map(s => `- ${s}（${getStatusLabel(s)}）`).join("\n")}`
  }

  const updated = store.transitionCaseStatus(caseRecord.id, newStatus, "手动推进")
  if (!updated) {
    return `❌ 状态转换失败`
  }

  return `✅ 案件状态已更新：${getStatusLabel(caseRecord.status)}（${caseRecord.status}）→ ${getStatusLabel(newStatus)}（${newStatus}）\n\n${getTransitionLabel(caseRecord.status, newStatus)}`
}

function caseHistory(
  store: ReturnType<typeof getCaseStore>,
  caseId: string,
  directory?: string,
): string {
  const caseRecord = caseId
    ? store.getCase(caseId)
    : directory
      ? store.getOrCreateCaseForProject(directory)
      : null

  if (!caseRecord) {
    return `❌ 未找到案件`
  }

  const tasks = store.getCaseTasks(caseRecord.id)
  const transitions = (caseRecord.metadata._transitions as Array<{ from: string; to: string; reason: string; at: number }>) || []

  let output = `## 案件时间线：${caseRecord.title || caseRecord.id.slice(0, 8)}\n\n`

  // 合并任务和状态转换，按时间排序
  const events: Array<{ time: number; type: string; detail: string }> = []

  tasks.forEach(t => {
    events.push({
      time: t.created_at,
      type: "任务",
      detail: `${t.task_type}/${t.tool_name || "?"} → ${t.status}`,
    })
    if (t.completed_at) {
      events.push({
        time: t.completed_at,
        type: "完成",
        detail: `${t.task_type} ${t.output_summary?.slice(0, 50) || ""}`,
      })
    }
  })

  transitions.forEach(t => {
    events.push({
      time: Math.floor(t.at / 1000),
      type: "状态变更",
      detail: `${t.from} → ${t.to}（${t.reason}）`,
    })
  })

  events.sort((a, b) => a.time - b.time)

  if (events.length > 0) {
    output += `| 时间 | 类型 | 详情 |\n`
    output += `|------|------|------|\n`
    events.forEach(e => {
      const date = new Date(e.time * 1000).toLocaleString("zh-CN")
      output += `| ${date} | ${e.type} | ${e.detail} |\n`
    })
  } else {
    output += `*暂无操作记录*\n`
  }

  return output
}

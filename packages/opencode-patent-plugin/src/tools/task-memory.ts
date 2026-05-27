/**
 * 跨会话记忆工具
 *
 * 让 AI 在执行新任务前，自动查找相似的历史任务并注入经验。
 * 实现"做过的事不需要重复指导"的能力。
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { getCaseStore, type TaskType } from "../utils/case-store.js"
import { toolMissingParam } from "../utils/tool-response.js"

export async function registerMemoryTools(_pluginContext: PatentPluginContext) {
  return {
    task_memory: tool({
      description: `
        查询历史任务记忆。在处理新任务时，先查询相似历史任务的经验。

        使用场景：
        - 开始撰写新专利前，查看之前的撰写经验
        - 处理审查意见前，查看之前的答辩策略
        - 检索专利前，查看之前的检索关键词和结果

        系统会自动推荐相关历史任务，帮助你复用之前的经验。
      `,
      args: {
        action: tool.schema
          .enum(["search", "history", "suggest"])
          .describe("动作：search=搜索相似任务, history=查看案件历史, suggest=获取推荐"),
        task_type: tool.schema
          .enum(["research", "draft", "oa", "reexam", "invalidation", "analyze", "check", "trademark"])
          .optional()
          .describe("任务类型"),
        keyword: tool.schema
          .string()
          .optional()
          .describe("搜索关键词"),
        case_id: tool.schema
          .string()
          .optional()
          .describe("案件 ID（用于查看案件历史）"),
        session_id: tool.schema
          .string()
          .optional()
          .describe("会话 ID（用于查看当前会话历史）"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "memory",
          patterns: [args.action],
          always: [],
          metadata: { action: args.action },
        })

        const store = getCaseStore()

        switch (args.action) {
          case "search": {
            if (!args.task_type) return toolMissingParam("task_type", "搜索需要提供任务类型")
            const tasks = store.findSimilarTasks(
              args.task_type as TaskType,
              args.keyword,
              5,
            )
            if (tasks.length === 0) {
              return `## 历史记忆\n\n未找到类型为"${args.task_type}"的相似历史任务。\n\n*这是你第一次处理此类任务，完成后经验将自动保存。*`
            }
            return formatMemoryResults(tasks)
          }
          case "history": {
            if (args.case_id) {
              const tasks = store.getTaskHistory(args.case_id)
              return formatHistory(tasks)
            }
            if (args.session_id) {
              const tasks = store.getSessionTasks(args.session_id)
              return formatHistory(tasks)
            }
            return toolMissingParam("case_id 或 session_id", "查看历史需要提供案件 ID 或会话 ID")
          }
          case "suggest": {
            // 获取各类型最近的完成任务，提供概览
            const types: TaskType[] = ["research", "draft", "oa", "reexam", "invalidation", "analyze", "check", "trademark"]
            let output = "## 记忆概览\n\n"
            for (const t of types) {
              const recent = store.findSimilarTasks(t, undefined, 1)
              if (recent.length > 0) {
                const task = recent[0]
                const date = new Date(task.created_at * 1000).toLocaleDateString("zh-CN")
                output += `- **${t}**: 最近一次在 ${date}（${task.tool_name}）\n`
              }
            }
            const stats = store.getStats()
            output += `\n**累计记录**: ${stats.tasks} 条任务, ${stats.cases} 个案件, ${stats.documents} 份文档`
            return output
          }
          default:
            return `未知的记忆动作: ${args.action}`
        }
      },
    }),
  }
}

function formatMemoryResults(tasks: any[]): string {
  let output = `## 历史记忆（找到 ${tasks.length} 条相似任务）\n\n`

  tasks.forEach((task, i) => {
    const date = new Date(task.created_at * 1000).toLocaleDateString("zh-CN")
    output += `### ${i + 1}. ${task.tool_name} / ${task.action || "N/A"} (${date})\n`

    if (task.input_data) {
      try {
        const input = JSON.parse(task.input_data)
        const summary = Object.entries(input)
          .slice(0, 5)
          .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
          .join(", ")
        output += `**输入**: ${summary}\n`
      } catch {
        output += `**输入**: ${task.input_data.slice(0, 200)}\n`
      }
    }

    if (task.output_data) {
      output += `**输出摘要**: ${task.output_data.slice(0, 300)}${task.output_data.length > 300 ? "..." : ""}\n`
    }
    output += `\n`
  })

  output += `---\n*以上是相似历史任务的经验，可以在当前任务中参考复用。*`
  return output
}

function formatHistory(tasks: any[]): string {
  if (tasks.length === 0) return "未找到相关任务历史。"

  let output = `## 任务历史（${tasks.length} 条）\n\n`
  tasks.forEach((task, i) => {
    const date = new Date(task.created_at * 1000).toLocaleString("zh-CN")
    const status = task.status === "completed" ? "✅" : task.status === "failed" ? "❌" : "⏳"
    output += `${i + 1}. ${status} **${task.tool_name}** (${task.task_type}) — ${date}\n`
    if (task.action) output += `   动作: ${task.action}\n`
  })
  return output
}

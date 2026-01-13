/**
 * ============================================================================
 * 文件名：stats.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 统计命令模块。提供 token 使用量和成本统计功能。
 *
 * 主要功能：
 * - StatsCommand：统计命令
 * - 显示会话概览（会话数、消息数、天数）
 * - 显示成本和 token 统计（总成本、日均成本、token 分布）
 * - 显示模型使用情况（消息数、token 数、成本）
 * - 显示工具使用情况（带可视化条形图）
 * - 支持按天数过滤、按项目过滤
 * - 批量处理大量会话（BATCH_SIZE = 20）
 *
 * 依赖关系：
 * - yargs：命令行参数解析
 * - ./cmd：命令包装
 * - ../../session：会话管理
 * - ../bootstrap：实例引导
 * - ../../storage/storage：存储层
 * - ../../project/project：项目管理
 * - ../../project/instance：实例管理
 *
 * 导出内容：
 * - StatsCommand：统计命令定义
 * - aggregateSessionStats()：聚合会话统计数据
 * - displayStats()：显示统计信息
 * - SessionStats：统计数据类型定义
 *
 * 命令参数：
 * - days：显示最近 N 天的统计（默认：全部时间）
 * - tools：显示的工具数量（默认：全部）
 * - models：显示模型统计（默认：隐藏），传递数字显示前 N 个
 * - project：按项目过滤（默认：所有项目，空字符串表示当前项目）
 *
 * 输出格式：
 * - 使用 Unicode 框线字符绘制表格
 * - 工具使用带条形图可视化
 * - 数字格式化（K/M 后缀）
 *
 * @package opencode
 * @module cli/cmd/stats
 */

// 导入 yargs 类型
import type { Argv } from "yargs"

// 导入命令包装
import { cmd } from "./cmd"

// 导入会话管理
import { Session } from "../../session"

// 导入实例引导
import { bootstrap } from "../bootstrap"

// 导入存储层
import { Storage } from "../../storage/storage"

// 导入项目管理
import { Project } from "../../project/project"

// 导入实例管理
import { Instance } from "../../project/instance"

/**
 * 会话统计数据接口
 *
 * 包含所有统计指标的聚合数据。
 */
interface SessionStats {
  // 总会话数
  totalSessions: number
  // 总消息数
  totalMessages: number
  // 总成本（美元）
  totalCost: number
  // 总 token 统计
  totalTokens: {
    // 输入 token
    input: number
    // 输出 token
    output: number
    // 推理 token（reasoning）
    reasoning: number
    // 缓存 token
    cache: {
      // 缓存读取
      read: number
      // 缓存写入
      write: number
    }
  }
  // 工具使用统计（工具名 -> 使用次数）
  toolUsage: Record<string, number>
  // 模型使用统计（模型 ID -> 详细信息）
  modelUsage: Record<
    string,
    {
      // 消息数量
      messages: number
      // token 统计
      tokens: {
        // 输入 token
        input: number
        // 输出 token
        output: number
      }
      // 成本
      cost: number
    }
  >
  // 日期范围
  dateRange: {
    // 最早时间戳
    earliest: number
    // 最晚时间戳
    latest: number
  }
  // 天数
  days: number
  // 每天平均成本
  costPerDay: number
  // 每个会话平均 token
  tokensPerSession: number
  // 每个会话中位数 token
  medianTokensPerSession: number
}

/**
 * 统计命令
 *
 * 显示 token 使用量和成本统计。
 */
export const StatsCommand = cmd({
  command: "stats",
  describe: "show token usage and cost statistics",
  builder: (yargs: Argv) => {
    return yargs
      // 天数过滤参数
      .option("days", {
        describe: "show stats for the last N days (default: all time)",
        type: "number",
      })
      // 工具显示数量限制
      .option("tools", {
        describe: "number of tools to show (default: all)",
        type: "number",
      })
      // 模型统计显示
      .option("models", {
        describe: "show model statistics (default: hidden). Pass a number to show top N, otherwise shows all",
      })
      // 项目过滤
      .option("project", {
        describe: "filter by project (default: all projects, empty string: current project)",
        type: "string",
      })
  },
  handler: async (args) => {
    // 引导实例并执行命令
    await bootstrap(process.cwd(), async () => {
      // 聚合会话统计数据
      const stats = await aggregateSessionStats(args.days, args.project)

      // 确定模型显示限制
      let modelLimit: number | undefined
      // --models (无值) 显示所有模型
      if (args.models === true) {
        modelLimit = Infinity
      }
      // --models N 显示前 N 个模型
      else if (typeof args.models === "number") {
        modelLimit = args.models
      }

      // 显示统计信息
      displayStats(stats, args.tools, modelLimit)
    })
  },
})

/**
 * 获取当前项目信息
 *
 * @returns Promise，解析为当前项目信息
 */
async function getCurrentProject(): Promise<Project.Info> {
  // 返回实例的项目信息
  return Instance.project
}

/**
 * 获取所有会话
 *
 * 遍历所有项目并收集所有会话信息。
 *
 * @returns Promise，解析为会话信息数组
 */
async function getAllSessions(): Promise<Session.Info[]> {
  // 会话数组
  const sessions: Session.Info[] = []

  // 列出所有项目键
  const projectKeys = await Storage.list(["project"])
  // 并行读取所有项目信息
  const projects = await Promise.all(projectKeys.map((key) => Storage.read<Project.Info>(key)))

  // 遍历每个项目
  for (const project of projects) {
    // 跳过无效项目
    if (!project) continue

    // 列出该项目的所有会话键
    const sessionKeys = await Storage.list(["session", project.id])
    // 并行读取所有会话信息
    const projectSessions = await Promise.all(sessionKeys.map((key) => Storage.read<Session.Info>(key)))

    // 收集有效会话
    for (const session of projectSessions) {
      if (session) {
        sessions.push(session)
      }
    }
  }

  return sessions
}

/**
 * 聚合会话统计数据
 *
 * 从所有会话中聚合 token 使用、成本、工具和模型使用情况。
 *
 * @param days - 限制天数（undefined = 全部时间，0 = 今天，N = 最近 N 天）
 * @param projectFilter - 项目过滤（undefined = 所有项目，"" = 当前项目，其他 = 指定项目 ID）
 * @returns Promise，解析为聚合统计数据
 *
 * 时间过滤逻辑：
 * - days === undefined：显示全部时间
 * - days === 0：显示今天（从 00:00:00 开始）
 * - days > 0：显示最近 N 天
 */
export async function aggregateSessionStats(days?: number, projectFilter?: string): Promise<SessionStats> {
  // 获取所有会话
  const sessions = await getAllSessions()
  // 一天的毫秒数
  const MS_IN_DAY = 24 * 60 * 60 * 1000

  // 计算截止时间（用于过滤）
  const cutoffTime = (() => {
    // undefined = 全部时间，截止时间为 0
    if (days === undefined) return 0
    // 0 = 今天，截止时间为今天 00:00:00
    if (days === 0) {
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      return now.getTime()
    }
    // N = 最近 N 天，截止时间为 N 天前
    return Date.now() - days * MS_IN_DAY
  })()

  // 计算窗口天数（用于显示）
  const windowDays = (() => {
    // undefined = 未指定
    if (days === undefined) return
    // 0 = 1 天（今天）
    if (days === 0) return 1
    // N = N 天
    return days
  })()

  // 按时间过滤会话（如果设置了截止时间）
  let filteredSessions = cutoffTime > 0 ? sessions.filter((session) => session.time.updated >= cutoffTime) : sessions

  // 按项目过滤会话
  if (projectFilter !== undefined) {
    // 空字符串 = 当前项目
    if (projectFilter === "") {
      const currentProject = await getCurrentProject()
      filteredSessions = filteredSessions.filter((session) => session.projectID === currentProject.id)
    }
    // 其他 = 指定项目 ID
    else {
      filteredSessions = filteredSessions.filter((session) => session.projectID === projectFilter)
    }
  }

  // 初始化统计数据结构
  const stats: SessionStats = {
    totalSessions: filteredSessions.length,
    totalMessages: 0,
    totalCost: 0,
    totalTokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    toolUsage: {},
    modelUsage: {},
    dateRange: {
      earliest: Date.now(),
      latest: Date.now(),
    },
    days: 0,
    costPerDay: 0,
    tokensPerSession: 0,
    medianTokensPerSession: 0,
  }

  // 大数据集警告（超过 1000 个会话）
  if (filteredSessions.length > 1000) {
    console.log(`Large dataset detected (${filteredSessions.length} sessions). This may take a while...`)
  }

  // 没有会话的情况
  if (filteredSessions.length === 0) {
    stats.days = windowDays ?? 0
    return stats
  }

  // 时间范围跟踪
  let earliestTime = Date.now()
  let latestTime = 0

  // 会话 token 总数数组（用于计算中位数）
  const sessionTotalTokens: number[] = []

  // 批处理大小（一次处理 20 个会话）
  const BATCH_SIZE = 20
  // 分批处理会话
  for (let i = 0; i < filteredSessions.length; i += BATCH_SIZE) {
    // 获取当前批次
    const batch = filteredSessions.slice(i, i + BATCH_SIZE)

    // 并行处理批次中的每个会话
    const batchPromises = batch.map(async (session) => {
      // 获取会话的所有消息
      const messages = await Session.messages({ sessionID: session.id })

      // 会话统计变量
      let sessionCost = 0
      let sessionTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      let sessionToolUsage: Record<string, number> = {}
      let sessionModelUsage: Record<
        string,
        {
          messages: number
          tokens: {
            input: number
            output: number
          }
          cost: number
        }
      > = {}

      // 遍历消息
      for (const message of messages) {
        // 只处理助手消息（包含 token 和成本信息）
        if (message.info.role === "assistant") {
          // 累加成本
          sessionCost += message.info.cost || 0

          // 构建模型键（provider/model 格式）
          const modelKey = `${message.info.providerID}/${message.info.modelID}`
          // 初始化模型统计
          if (!sessionModelUsage[modelKey]) {
            sessionModelUsage[modelKey] = {
              messages: 0,
              tokens: { input: 0, output: 0 },
              cost: 0,
            }
          }
          // 增加消息计数
          sessionModelUsage[modelKey].messages++
          // 累加模型成本
          sessionModelUsage[modelKey].cost += message.info.cost || 0

          // 处理 token 信息
          if (message.info.tokens) {
            // 累加各类 token
            sessionTokens.input += message.info.tokens.input || 0
            sessionTokens.output += message.info.tokens.output || 0
            sessionTokens.reasoning += message.info.tokens.reasoning || 0
            sessionTokens.cache.read += message.info.tokens.cache?.read || 0
            sessionTokens.cache.write += message.info.tokens.cache?.write || 0

            // 累加模型 token（输出包含推理 token）
            sessionModelUsage[modelKey].tokens.input += message.info.tokens.input || 0
            sessionModelUsage[modelKey].tokens.output +=
              (message.info.tokens.output || 0) + (message.info.tokens.reasoning || 0)
          }
        }

        // 遍历消息部分，统计工具使用
        for (const part of message.parts) {
          if (part.type === "tool" && part.tool) {
            sessionToolUsage[part.tool] = (sessionToolUsage[part.tool] || 0) + 1
          }
        }
      }

      // 返回会话统计结果
      return {
        messageCount: messages.length,
        sessionCost,
        sessionTokens,
        sessionTotalTokens: sessionTokens.input + sessionTokens.output + sessionTokens.reasoning,
        sessionToolUsage,
        sessionModelUsage,
        // 如果设置了截止时间，使用更新时间；否则使用创建时间
        earliestTime: cutoffTime > 0 ? session.time.updated : session.time.created,
        latestTime: session.time.updated,
      }
    })

    // 等待批次处理完成
    const batchResults = await Promise.all(batchPromises)

    // 聚合批次结果到全局统计
    for (const result of batchResults) {
      // 更新时间范围
      earliestTime = Math.min(earliestTime, result.earliestTime)
      latestTime = Math.max(latestTime, result.latestTime)
      // 记录会话 token 总数
      sessionTotalTokens.push(result.sessionTotalTokens)

      // 累加基本统计
      stats.totalMessages += result.messageCount
      stats.totalCost += result.sessionCost
      stats.totalTokens.input += result.sessionTokens.input
      stats.totalTokens.output += result.sessionTokens.output
      stats.totalTokens.reasoning += result.sessionTokens.reasoning
      stats.totalTokens.cache.read += result.sessionTokens.cache.read
      stats.totalTokens.cache.write += result.sessionTokens.cache.write

      // 合并工具使用统计
      for (const [tool, count] of Object.entries(result.sessionToolUsage)) {
        stats.toolUsage[tool] = (stats.toolUsage[tool] || 0) + count
      }

      // 合并模型使用统计
      for (const [model, usage] of Object.entries(result.sessionModelUsage)) {
        if (!stats.modelUsage[model]) {
          stats.modelUsage[model] = {
            messages: 0,
            tokens: { input: 0, output: 0 },
            cost: 0,
          }
        }
        stats.modelUsage[model].messages += usage.messages
        stats.modelUsage[model].tokens.input += usage.tokens.input
        stats.modelUsage[model].tokens.output += usage.tokens.output
        stats.modelUsage[model].cost += usage.cost
      }
    }
  }

  // 计算范围天数（至少 1 天）
  const rangeDays = Math.max(1, Math.ceil((latestTime - earliestTime) / MS_IN_DAY))
  // 有效天数（使用窗口天数或范围天数）
  const effectiveDays = windowDays ?? rangeDays

  // 设置日期范围
  stats.dateRange = {
    earliest: earliestTime,
    latest: latestTime,
  }
  stats.days = effectiveDays
  stats.costPerDay = stats.totalCost / effectiveDays

  // 计算 token 每会话平均值
  const totalTokens = stats.totalTokens.input + stats.totalTokens.output + stats.totalTokens.reasoning
  stats.tokensPerSession = filteredSessions.length > 0 ? totalTokens / filteredSessions.length : 0

  // 计算中位数 token 每会话
  sessionTotalTokens.sort((a, b) => a - b)
  const mid = Math.floor(sessionTotalTokens.length / 2)
  stats.medianTokensPerSession =
    sessionTotalTokens.length === 0
      ? 0
      : sessionTotalTokens.length % 2 === 0
        ? (sessionTotalTokens[mid - 1] + sessionTotalTokens[mid]) / 2
        : sessionTotalTokens[mid]

  return stats
}

/**
 * 显示统计信息
 *
 * 以表格形式打印统计数据。
 *
 * @param stats - 统计数据
 * @param toolLimit - 工具显示数量限制（undefined = 全部）
 * @param modelLimit - 模型显示数量限制（undefined = 不显示，Infinity = 全部，N = 前 N 个）
 */
export function displayStats(stats: SessionStats, toolLimit?: number, modelLimit?: number) {
  // 表格宽度
  const width = 56

  /**
   * 渲染表格行
   *
   * @param label - 标签
   * @param value - 值
   * @returns 格式化的行字符串
   */
  function renderRow(label: string, value: string): string {
    const availableWidth = width - 1
    const paddingNeeded = availableWidth - label.length - value.length
    const padding = Math.max(0, paddingNeeded)
    return `│${label}${" ".repeat(padding)}${value} │`
  }

  // ==================== 概览部分 ====================
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                       OVERVIEW                         │")
  console.log("├────────────────────────────────────────────────────────┤")
  console.log(renderRow("Sessions", stats.totalSessions.toLocaleString()))
  console.log(renderRow("Messages", stats.totalMessages.toLocaleString()))
  console.log(renderRow("Days", stats.days.toString()))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // ==================== 成本 & Token 部分 ====================
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                    COST & TOKENS                       │")
  console.log("├────────────────────────────────────────────────────────┤")
  // 处理 NaN 值
  const cost = isNaN(stats.totalCost) ? 0 : stats.totalCost
  const costPerDay = isNaN(stats.costPerDay) ? 0 : stats.costPerDay
  const tokensPerSession = isNaN(stats.tokensPerSession) ? 0 : stats.tokensPerSession
  console.log(renderRow("Total Cost", `$${cost.toFixed(2)}`))
  console.log(renderRow("Avg Cost/Day", `$${costPerDay.toFixed(2)}`))
  console.log(renderRow("Avg Tokens/Session", formatNumber(Math.round(tokensPerSession))))
  const medianTokensPerSession = isNaN(stats.medianTokensPerSession) ? 0 : stats.medianTokensPerSession
  console.log(renderRow("Median Tokens/Session", formatNumber(Math.round(medianTokensPerSession))))
  console.log(renderRow("Input", formatNumber(stats.totalTokens.input)))
  console.log(renderRow("Output", formatNumber(stats.totalTokens.output)))
  console.log(renderRow("Cache Read", formatNumber(stats.totalTokens.cache.read)))
  console.log(renderRow("Cache Write", formatNumber(stats.totalTokens.cache.write)))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // ==================== 模型使用部分 ====================
  if (modelLimit !== undefined && Object.keys(stats.modelUsage).length > 0) {
    // 按消息数量排序
    const sortedModels = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.messages - a.messages)
    // 应用数量限制
    const modelsToDisplay = modelLimit === Infinity ? sortedModels : sortedModels.slice(0, modelLimit)

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      MODEL USAGE                       │")
    console.log("├────────────────────────────────────────────────────────┤")

    // 遍历每个模型
    for (const [model, usage] of modelsToDisplay) {
      console.log(`│ ${model.padEnd(54)} │`)
      console.log(renderRow("  Messages", usage.messages.toLocaleString()))
      console.log(renderRow("  Input Tokens", formatNumber(usage.tokens.input)))
      console.log(renderRow("  Output Tokens", formatNumber(usage.tokens.output)))
      console.log(renderRow("  Cost", `$${usage.cost.toFixed(4)}`))
      console.log("├────────────────────────────────────────────────────────┤")
    }
    // 移除最后一个分隔符并添加底边框
    process.stdout.write("\x1B[1A") // 向上移动一行
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()

  // ==================== 工具使用部分 ====================
  if (Object.keys(stats.toolUsage).length > 0) {
    // 按使用次数排序
    const sortedTools = Object.entries(stats.toolUsage).sort(([, a], [, b]) => b - a)
    // 应用数量限制
    const toolsToDisplay = toolLimit ? sortedTools.slice(0, toolLimit) : sortedTools

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      TOOL USAGE                        │")
    console.log("├────────────────────────────────────────────────────────┤")

    // 计算最大使用次数（用于条形图缩放）
    const maxCount = Math.max(...toolsToDisplay.map(([, count]) => count))
    // 计算总使用次数（用于百分比）
    const totalToolUsage = Object.values(stats.toolUsage).reduce((a, b) => a + b, 0)

    // 遍历每个工具
    for (const [tool, count] of toolsToDisplay) {
      // 计算条形图长度（最大 20 个字符）
      const barLength = Math.max(1, Math.floor((count / maxCount) * 20))
      const bar = "█".repeat(barLength)
      // 计算百分比
      const percentage = ((count / totalToolUsage) * 100).toFixed(1)

      // 截断过长的工具名
      const maxToolLength = 18
      const truncatedTool = tool.length > maxToolLength ? tool.substring(0, maxToolLength - 2) + ".." : tool
      const toolName = truncatedTool.padEnd(maxToolLength)

      // 构建行内容
      const content = ` ${toolName} ${bar.padEnd(20)} ${count.toString().padStart(3)} (${percentage.padStart(4)}%)`
      const padding = Math.max(0, width - content.length - 1)
      console.log(`│${content}${" ".repeat(padding)} │`)
    }
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()
}

/**
 * 格式化数字（添加 K/M 后缀）
 *
 * @param num - 要格式化的数字
 * @returns 格式化后的字符串
 *
 * 格式化规则：
 * - >= 1,000,000：显示为 X.XM（百万）
 * - >= 1,000：显示为 X.XK（千）
 * - < 1,000：直接显示
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

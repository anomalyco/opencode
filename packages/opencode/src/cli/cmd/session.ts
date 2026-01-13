/**
 * ============================================================================
 * 文件名：session.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 会话管理命令模块。提供会话列表功能。
 *
 * 主要功能：
 * - SessionCommand：会话命令组
 * - SessionListCommand：列出会话命令
 * - 支持表格和 JSON 两种输出格式
 * - 支持分页显示
 *
 * 依赖关系：
 * - yargs：命令行参数解析
 * - ./cmd：命令包装
 * - ../../session：会话管理
 * - ../bootstrap：实例引导
 * - ../ui：UI 工具
 * - ../../util/locale：本地化工具
 * - ../../flag/flag：标志位
 * - os：行尾符
 * - path：路径处理
 *
 * 导出内容：
 * - SessionCommand：会话命令组
 * - SessionListCommand：列出命令
 * - pagerCmd()：分页命令
 * - formatSessionTable()：格式化为表格
 * - formatSessionJSON()：格式化为 JSON
 *
 * 命令参数：
 * - max-count (-n)：限制显示最近 N 个会话
 * - format：输出格式（table 或 json，默认 table）
 *
 * 分页逻辑：
 * - 仅在 TTY 环境、未指定 max-count、格式为 table 时启用
 * - 使用 less/more 命令进行分页
 *
 * @package opencode
 * @module cli/cmd/session
 */

// 导入 yargs 类型
import type { Argv } from "yargs"

// 导入命令包装
import { cmd } from "./cmd"

// 导入会话管理
import { Session } from "../../session"

// 导入实例引导
import { bootstrap } from "../bootstrap"

// 导入 UI 工具
import { UI } from "../ui"

// 导入本地化工具
import { Locale } from "../../util/locale"

// 导入标志位
import { Flag } from "../../flag/flag"

// 导入行尾符
import { EOL } from "os"

// 导入路径处理
import path from "path"

/**
 * 获取分页命令
 *
 * 根据平台和可用性返回合适的分页命令。
 *
 * @returns 分页命令数组
 *
 * 平台支持：
 * - 非 Windows：使用 less（支持原始序列、不换行）
 * - Windows：优先使用 less（如果可用）
 *   - 检查 PATH 中的 less
 *   - 检查 Git Bash 中的 less
 *   - 检查 Git 安装目录中的 less
 * - 回退到 Windows 内置的 more 命令
 */
function pagerCmd(): string[] {
  // less 选项：-R 原始序列，-S 不换行
  const lessOptions = ["-R", "-S"]

  // 非 Windows 平台直接使用 less
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // Windows：检查 less 是否在 PATH 中
  const lessOnPath = Bun.which("less")
  if (lessOnPath) {
    // 验证文件存在且有内容
    if (Bun.file(lessOnPath).size) return [lessOnPath, ...lessOptions]
  }

  // 检查 Git Bash 环境中的 less
  if (Flag.OPENCODE_GIT_BASH_PATH) {
    const less = path.join(Flag.OPENCODE_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  // 检查 Git 安装目录中的 less
  const git = Bun.which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  // 回退到 Windows 内置的 more 命令（通过 cmd.exe）
  return ["cmd", "/c", "more"]
}

/**
 * 会话命令组
 *
 * 管理会话的父命令。
 */
export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) => yargs.command(SessionListCommand).demandCommand(),
  async handler() {},
})

/**
 * 会话列表命令
 *
 * 列出所有会话（排除子会话）。
 */
export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    return yargs
      // 限制显示的会话数量
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      // 输出格式
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
  },
  handler: async (args) => {
    // 引导实例并执行命令
    await bootstrap(process.cwd(), async () => {
      // 收集所有会话
      const sessions = []
      for await (const session of Session.list()) {
        // 排除子会话（有 parentID 的）
        if (!session.parentID) {
          sessions.push(session)
        }
      }

      // 按更新时间排序（最新的在前）
      sessions.sort((a, b) => b.time.updated - a.time.updated)

      // 应用数量限制
      const limitedSessions = args.maxCount ? sessions.slice(0, args.maxCount) : sessions

      // 如果没有会话，直接返回
      if (limitedSessions.length === 0) {
        return
      }

      // 根据格式生成输出
      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(limitedSessions)
      } else {
        output = formatSessionTable(limitedSessions)
      }

      // 确定是否需要分页
      // 条件：TTY 环境、未指定 max-count、格式为 table
      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        // 启动分页进程
        const proc = Bun.spawn({
          cmd: pagerCmd(),
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        // 将输出写入分页器
        proc.stdin.write(output)
        proc.stdin.end()
        // 等待分页进程结束
        await proc.exited
      } else {
        // 直接输出
        console.log(output)
      }
    })
  },
})

/**
 * 格式化会话为表格
 *
 * @param sessions - 会话信息数组
 * @returns 表格格式的字符串
 *
 * 表格列：
 * - Session ID：会话 ID（动态宽度，最小 20）
 * - Title：标题（动态宽度，最小 25）
 * - Updated：更新时间
 */
function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  // 计算各列的最小宽度
  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  // 构建表头
  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  // 添加分隔线
  lines.push("─".repeat(header.length))

  // 构建每个会话的行
  for (const session of sessions) {
    // 截断标题以适应列宽
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    // 格式化时间（今天显示时间，否则显示日期时间）
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    // 构建行
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

/**
 * 格式化会话为 JSON
 *
 * @param sessions - 会话信息数组
 * @returns JSON 格式的字符串
 *
 * 包含字段：
 * - id：会话 ID
 * - title：标题
 * - updated：更新时间戳
 * - created：创建时间戳
 * - projectId：项目 ID
 * - directory：工作目录
 */
function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}

/**
 * ============================================================================
 * 文件名：grep.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Grep 工具模块。允许 AI 使用正则表达式搜索文件内容。
 *
 * 主要功能：
 * - GrepTool：使用正则表达式搜索文件内容的工具
 * - 支持自定义搜索目录
 * - 支持文件名过滤（glob 模式）
 * - 结果按修改时间排序
 * - 限制结果数量（最多 100 个）
 * - 检测结果截断
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类
 * - ../file/ripgrep：Ripgrep 内容搜索
 * - ./grep.txt：工具描述模板
 * - ../project/instance：实例管理
 * - path：路径处理
 * - ./external-directory：外部目录检查
 *
 * 导出内容：
 * - GrepTool：Grep 工具定义
 *
 * 参数：
 * - pattern：正则表达式模式
 * - path：搜索目录（可选，默认当前工作目录）
 * - include：文件包含模式（可选，如 "*.js", "*.{ts,tsx}"）
 *
 * 返回：
 * - title：模式标题
 * - output：匹配结果（文件路径 + 行号 + 行内容）
 * - metadata：元数据（matches、truncated）
 *
 * 常量：
 * - MAX_LINE_LENGTH：单行最大长度（2000）
 *
 * 行为：
 * - 结果按修改时间倒序排列（最新的在前）
 * - 按文件分组显示
 * - 超过限制时截断并提示
 * - 没有结果时返回 "No files found"
 *
 * Ripgrep 参数：
 * - -n：显示行号
 * - -H：显示文件名
 * - --hidden：搜索隐藏文件
 * - --follow：跟随符号链接
 * - --field-match-separator=|：使用 | 作为分隔符
 * - --regexp：搜索模式
 * - --glob：文件过滤模式
 *
 * @package opencode
 * @module tool/grep
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入 Ripgrep 内容搜索
import { Ripgrep } from "../file/ripgrep"

// 导入工具描述模板
import DESCRIPTION from "./grep.txt"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入路径处理
import path from "path"

// 导入外部目录检查
import { assertExternalDirectory } from "./external-directory"

// 单行最大长度
const MAX_LINE_LENGTH = 2000

/**
 * Grep 工具定义
 *
 * 允许 AI 使用正则表达式搜索文件内容。
 */
export const GrepTool = Tool.define("grep", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // 正则表达式模式
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    // 搜索目录（可选）
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    // 文件包含模式（可选）
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),

  async execute(params, ctx) {
    // 检查模式是否提供
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    // 请求 grep 权限
    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    // 解析搜索目录
    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)

    // 检查外部目录权限
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    // 获取 Ripgrep 可执行文件路径
    const rgPath = await Ripgrep.filepath()

    // 构建 Ripgrep 参数
    const args = ["-nH", "--hidden", "--follow", "--field-match-separator=|", "--regexp", params.pattern]

    // 如果有文件过滤模式，添加 glob 参数
    if (params.include) {
      args.push("--glob", params.include)
    }

    // 添加搜索路径
    args.push(searchPath)

    // 启动 Ripgrep 进程
    const proc = Bun.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })

    // 读取输出
    const output = await new Response(proc.stdout).text()
    const errorOutput = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    // 退出码 1 表示没有匹配
    if (exitCode === 1) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    // 其他非零退出码表示错误
    if (exitCode !== 0) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    // 处理 Unix (\n) 和 Windows (\r\n) 行尾
    const lines = output.trim().split(/\r?\n/)
    const matches = []

    // 解析输出
    for (const line of lines) {
      if (!line) continue

      // 解析行：文件路径|行号|行内容
      const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
      if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

      const lineNum = parseInt(lineNumStr, 10)
      const lineText = lineTextParts.join("|")

      // 获取文件信息
      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => null)
      if (!stats) continue

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
    }

    // 按修改时间倒序排序（最新的在前）
    matches.sort((a, b) => b.modTime - a.modTime)

    // 限制结果数量
    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    // 没有匹配
    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    // 构建输出
    const outputLines = [`Found ${finalMatches.length} matches`]

    // 按文件分组显示
    let currentFile = ""
    for (const match of finalMatches) {
      // 切换文件时添加文件名
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }

      // 截断过长的行
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText

      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    // 如果截断，添加提示
    if (truncated) {
      outputLines.push("")
      outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: finalMatches.length,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})

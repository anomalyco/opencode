/**
 * ============================================================================
 * 文件名：truncation.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * 输出截断模块。处理工具输出的截断和溢出管理。
 *
 * 主要功能：
 * - MAX_LINES/MAX_BYTES：默认截断限制
 * - output()：截断输出并保存到文件
 * - cleanup()：清理过期的截断文件
 * - hasTaskTool()：检查是否有 Task 工具权限
 *
 * 依赖关系：
 * - fs/promises：文件操作
 * - path：路径处理
 * - ../global：全局路径
 * - ../id/id：标识符生成
 * - ../util/lazy：惰性初始化
 * - ../permission/next：权限评估
 * - ../agent/agent：Agent 信息
 *
 * 导出内容：
 * - Truncate namespace：截断命名空间
 *   - MAX_LINES：最大行数限制（2000）
 *   - MAX_BYTES：最大字节数限制（50KB）
 *   - DIR：截断文件目录
 *   - GLOB：截断文件匹配模式
 *   - Result：截断结果类型
 *   - Options：截断选项
 *   - cleanup()：清理过期文件
 *   - output()：截断输出
 *
 * 截断逻辑：
 * 1. 检查输出是否超过限制
 * 2. 如果超过，截断为头部或尾部
 * 3. 保存完整输出到文件
 * 4. 返回截断内容和提示
 *
 * 文件保留：
 * - 保留期限：7 天
 * - 按工具 ID 命名
 * - 自动清理过期文件
 *
 * @package opencode
 * @module tool/truncation
 */

// 导入文件操作
import fs from "fs/promises"

// 导入路径处理
import path from "path"

// 导入全局路径
import { Global } from "../global"

// 导入标识符生成
import { Identifier } from "../id/id"

// 导入惰性初始化
import { lazy } from "../util/lazy"

// 导入权限评估
import { PermissionNext } from "../permission/next"

// 导入 Agent 信息
import type { Agent } from "../agent/agent"

/**
 * 截断命名空间
 *
 * 处理工具输出的截断和溢出管理。
 */
export namespace Truncate {
  // 默认最大行数
  export const MAX_LINES = 2000

  // 默认最大字节数（50KB）
  export const MAX_BYTES = 50 * 1024

  // 截断文件存储目录
  export const DIR = path.join(Global.Path.data, "tool-output")

  // 截断文件匹配模式
  export const GLOB = path.join(DIR, "*")

  // 文件保留期限（7 天）
  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

  /**
   * 截断结果类型
   *
   * 使用判别联合类型区分截断和未截断的结果。
   */
  export type Result =
    | { content: string; truncated: false }
    | { content: string; truncated: true; outputPath: string }

  /**
   * 截断选项
   *
   * 配置截断行为。
   */
  export interface Options {
    // 自定义最大行数
    maxLines?: number
    // 自定义最大字节数
    maxBytes?: number
    // 截断方向：head（保留头部）或 tail（保留尾部）
    direction?: "head" | "tail"
  }

  /**
   * 清理过期的截断文件
   *
   * 删除超过保留期限的截断文件。
   */
  export async function cleanup() {
    // 计算截止时间戳（保留期限之前）
    const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - RETENTION_MS))

    // 扫描截断文件目录
    const glob = new Bun.Glob("tool_*")
    const entries = await Array.fromAsync(glob.scan({ cwd: DIR, onlyFiles: true })).catch(() => [] as string[])

    // 删除过期文件
    for (const entry of entries) {
      // 从文件名提取时间戳
      if (Identifier.timestamp(entry) >= cutoff) continue

      // 删除过期文件
      await fs.unlink(path.join(DIR, entry)).catch(() => {})
    }
  }

  // 惰性初始化清理
  const init = lazy(cleanup)

  /**
   * 检查 Agent 是否有 Task 工具权限
   *
   * Task 工具可以用于处理截断的输出。
   *
   * @param agent - Agent 信息
   * @returns 是否有 Task 工具权限
   */
  function hasTaskTool(agent?: Agent.Info): boolean {
    // 没有权限配置则认为没有权限
    if (!agent?.permission) return false

    // 评估 task 工具的权限
    const rule = PermissionNext.evaluate("task", "*", agent.permission)
    // 未拒绝则认为有权限
    return rule.action !== "deny"
  }

  /**
   * 截断输出
   *
   * 如果输出超过限制，截断并保存到文件。
   *
   * @param text - 要截断的文本
   * @param options - 截断选项
   * @param agent - Agent 信息（用于检查权限）
   * @returns Promise，解析为截断结果
   *
   * 处理流程：
   * 1. 检查是否超过行数或字节数限制
   * 2. 如果未超过，直接返回
   * 3. 根据方向截断（head 或 tail）
   * 4. 保存完整输出到文件
   * 5. 返回截断内容和提示
   *
   * 提示消息：
   * - 有 Task 工具权限：建议使用 Task 工具
   * - 无 Task 工具权限：建议使用 Grep/Read
   */
  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    // 获取限制值
    const maxLines = options.maxLines ?? MAX_LINES
    const maxBytes = options.maxBytes ?? MAX_BYTES
    const direction = options.direction ?? "head"

    // 分割文本为行
    const lines = text.split("\n")
    // 计算总字节数
    const totalBytes = Buffer.byteLength(text, "utf-8")

    // 如果未超过限制，直接返回
    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false }
    }

    // 截断输出
    const out: string[] = []
    let i = 0
    let bytes = 0
    let hitBytes = false

    if (direction === "head") {
      // 从头部开始截断
      for (i = 0; i < lines.length && i < maxLines; i++) {
        // 计算当前行的大小（包含换行符）
        const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.push(lines[i])
        bytes += size
      }
    } else {
      // 从尾部开始截断
      for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
        // 计算当前行的大小（包含换行符）
        const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.unshift(lines[i])
        bytes += size
      }
    }

    // 计算移除的数量
    const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
    const unit = hitBytes ? "bytes" : "lines"
    const preview = out.join("\n")

    // 确保清理已初始化
    await init()

    // 生成工具输出文件 ID
    const id = Identifier.ascending("tool")
    const filepath = path.join(DIR, id)

    // 保存完整输出到文件
    await Bun.write(Bun.file(filepath), text)

    // 根据权限生成不同的提示
    const hint = hasTaskTool(agent)
      ? `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse the Task tool to have a subagent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
      : `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`

    // 组装最终消息
    const message =
      direction === "head"
        ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
        : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`

    return { content: message, truncated: true, outputPath: filepath }
  }
}

/**
 * ============================================================================
 * 文件名：ui.ts
 * 所属包：packages/opencode/src/cli
 * ============================================================================
 *
 * 文件作用：
 * CLI UI 模块。提供 CLI 界面的显示和交互功能。
 *
 * 主要功能：
 * - UI namespace：CLI UI 命名空间
 * - LOGO：ASCII 艺术 Logo
 * - Style：ANSI 文本样式常量
 * - println()：打印带换行的消息
 * - print()：打印消息
 * - empty()：打印空行
 * - logo()：生成 Logo
 * - input()：读取用户输入
 * - error()：显示错误消息
 * - markdown()：Markdown 处理（占位）
 *
 * 依赖关系：
 * - zod：类型验证
 * - os：EOL（行尾符）
 * - @opencode-ai/util/error：命名错误
 *
 * 导出内容：
 * - UI namespace：CLI UI 命名空间
 *   - LOGO：ASCII 艺术 Logo
 *   - CancelledError：UI 取消错误
 *   - Style：文本样式常量
 *   - println()：打印消息
 *   - print()：打印消息
 *   - empty()：打印空行
 *   - logo()：生成 Logo
 *   - input()：读取输入
 *   - error()：显示错误
 *   - markdown()：Markdown 处理
 *
 * 样式常量：
 * - TEXT_HIGHLIGHT：高亮文本（青色）
 * - TEXT_DIM：暗淡文本（灰色）
 * - TEXT_NORMAL：普通文本
 * - TEXT_WARNING：警告文本（黄色）
 * - TEXT_DANGER：危险文本（红色）
 * - TEXT_SUCCESS：成功文本（绿色）
 * - TEXT_INFO：信息文本（蓝色）
 * - *_BOLD：对应的粗体版本
 *
 * ANSI 转义码：
 * - \x1b[96m：青色
 * - \x1b[90m：灰色
 * - \x1b[0m：重置
 * - \x1b[1m：粗体
 * - \x1b[93m：黄色
 * - \x1b[91m：红色
 * - \x1b[92m：绿色
 * - \x1b[94m：蓝色
 *
 * @package opencode
 * @module cli/ui
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入行尾符
import { EOL } from "os"

// 导入命名错误
import { NamedError } from "@opencode-ai/util/error"

/**
 * CLI UI 命名空间
 *
 * 提供 CLI 界面的显示和交互功能。
 */
export namespace UI {
  /**
   * ASCII 艺术 Logo
   *
   * 用于 CLI 启动时显示。
   * 每行有两个版本：普通版本和紧凑版本。
   */
  const LOGO = [
    [`                   `, `             ▄     `],
    [`█▀▀█ █▀▀█ █▀▀█ █▀▀▄ `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`],
    [`█░░█ █░░█ █▀▀▀ █░░█ `, `█░░░ █░░█ █░░█ █▀▀▀`],
    [`▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ `, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`],
  ]

  /**
   * UI 取消错误
   *
   * 当用户取消 UI 操作时抛出。
   */
  export const CancelledError = NamedError.create("UICancelledError", z.void())

  /**
   * 文本样式常量
   *
   * ANSI 转义码用于终端文本样式。
   */
  export const Style = {
    // 高亮文本（青色）
    TEXT_HIGHLIGHT: "\x1b[96m",
    TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
    // 暗淡文本（灰色）
    TEXT_DIM: "\x1b[90m",
    TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
    // 普通文本（重置）
    TEXT_NORMAL: "\x1b[0m",
    TEXT_NORMAL_BOLD: "\x1b[1m",
    // 警告文本（黄色）
    TEXT_WARNING: "\x1b[93m",
    TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
    // 危险文本（红色）
    TEXT_DANGER: "\x1b[91m",
    TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
    // 成功文本（绿色）
    TEXT_SUCCESS: "\x1b[92m",
    TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
    // 信息文本（蓝色）
    TEXT_INFO: "\x1b[94m",
    TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
  }

  /**
   * 打印带换行的消息
   *
   * @param message - 要打印的消息片段
   */
  export function println(...message: string[]) {
    print(...message)
    // 写入行尾符
    Bun.stderr.write(EOL)
  }

  /**
   * 打印消息
   *
   * @param message - 要打印的消息片段
   */
  export function print(...message: string[]) {
    // 重置空行标记
    blank = false
    // 合并消息并写入 stderr
    Bun.stderr.write(message.join(" "))
  }

  // 空行标记
  let blank = false

  /**
   * 打印空行
   *
   * 只在上一行不是空行时打印。
   */
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  /**
   * 生成 Logo
   *
   * @param pad - 可选的前导填充
   * @returns Logo 字符串
   */
  export function logo(pad?: string) {
    const result = []
    // 遍历每一行
    for (const row of LOGO) {
      // 添加填充（如果有）
      if (pad) result.push(pad)
      // 添加灰色 ANSI 码
      result.push(Bun.color("gray", "ansi"))
      // 添加第一行（普通版本）
      result.push(row[0])
      // 重置样式
      result.push("\x1b[0m")
      // 添加第二行（紧凑版本）
      result.push(row[1])
      // 添加行尾符
      result.push(EOL)
    }
    return result.join("").trimEnd()
  }

  /**
   * 读取用户输入
   *
   * 使用 Node.js readline 模块。
   *
   * @param prompt - 提示符
   * @returns Promise，解析为用户输入
   */
  export async function input(prompt: string): Promise<string> {
    const readline = require("readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        rl.close()
        // 修剪并返回答案
        resolve(answer.trim())
      })
    })
  }

  /**
   * 显示错误消息
   *
   * @param message - 错误消息
   */
  export function error(message: string) {
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  /**
   * Markdown 处理（占位函数）
   *
   * @param text - Markdown 文本
   * @returns 处理后的文本
   */
  export function markdown(text: string): string {
    return text
  }
}

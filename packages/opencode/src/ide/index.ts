/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/ide
 * ============================================================================
 *
 * 文件作用：
 * IDE（集成开发环境）检测和扩展安装模块。支持检测当前 IDE 并安装 OpenCode 扩展。
 *
 * 主要功能：
 * - ide()：检测当前运行的 IDE
 * - alreadyInstalled()：检查扩展是否已安装
 * - install(ideName)：安装 OpenCode 扩展到指定 IDE
 *
 * 依赖关系：
 * - @/bus/bus-event：事件定义
 * - @/bus：全局事件总线
 * - bun：spawn 子进程
 * - zod：类型验证
 * - @opencode-ai/util/error：命名错误
 * - @/util/log：日志
 *
 * 导出内容：
 * - Ide namespace：IDE 管理命名空间
 *   - Event：IDE 事件
 *   - AlreadyInstalledError：已安装错误
 *   - InstallFailedError：安装失败错误
 *   - ide()：检测当前 IDE
 *   - alreadyInstalled()：检查是否已安装
 *   - install(ideName)：安装扩展
 *
 * 支持的 IDE：
 * - Windsurf
 * - Visual Studio Code - Insiders
 * - Visual Studio Code
 * - Cursor
 * - VSCodium
 *
 * 检测方式：
 * - 通过环境变量 TERM_PROGRAM 检测 VSCode
 * - 通过环境变量 GIT_ASKPASS 检测具体 IDE 名称
 * - 通过环境变量 OPENCODE_CALLER 检测扩展是否已安装
 *
 * @package opencode
 * @module ide
 */

// 导入事件定义工具
import { BusEvent } from "@/bus/bus-event"

// 导入全局事件总线
import { Bus } from "@/bus"

// 导入 Bun spawn 函数
import { spawn } from "bun"

// 导入 Zod 类型验证库
import z from "zod"

// 导入命名错误工具
import { NamedError } from "@opencode-ai/util/error"

// 导入日志
import { Log } from "../util/log"

/**
 * 支持的 IDE 列表
 *
 * 每个条目包含显示名称和命令行命令。
 */
const SUPPORTED_IDES = [
  { name: "Windsurf" as const, cmd: "windsurf" },                      // Windsurf IDE
  { name: "Visual Studio Code - Insiders" as const, cmd: "code-insiders" },  // VSCode Insiders
  { name: "Visual Studio Code" as const, cmd: "code" },                 // VSCode 稳定版
  { name: "Cursor" as const, cmd: "cursor" },                           // Cursor IDE
  { name: "VSCodium" as const, cmd: "codium" },                         // VSCodium
]

/**
 * IDE 管理命名空间
 *
 * 包含所有 IDE 相关的功能。
 */
export namespace Ide {
  // 创建 IDE 服务日志记录器
  const log = Log.create({ service: "ide" })

  /**
   * IDE 事件
   *
   * 定义 IDE 相关的事件类型。
   */
  export const Event = {
    /**
     * IDE 扩展已安装事件
     *
     * 当 OpenCode 扩展成功安装到 IDE 时触发。
     */
    Installed: BusEvent.define(
      "ide.installed",
      z.object({
        // IDE 名称
        ide: z.string(),
      }),
    ),
  }

  /**
   * 已安装错误
   *
   * 当扩展已经安装时抛出。
   */
  export const AlreadyInstalledError = NamedError.create("AlreadyInstalledError", z.object({}))

  /**
   * 安装失败错误
   *
   * 当扩展安装命令失败时抛出。
   */
  export const InstallFailedError = NamedError.create(
    "InstallFailedError",
    z.object({
      // 标准错误输出
      stderr: z.string(),
    }),
  )

  /**
   * 检测当前 IDE
   *
   * 通过环境变量检测当前运行的 IDE。
   *
   * @returns IDE 名称，如果无法检测返回 "unknown"
   *
   * 检测逻辑：
   * 1. 检查 TERM_PROGRAM 是否为 "vscode"
   * 2. 检查 GIT_ASKPASS 是否包含支持的 IDE 名称
   * 3. 返回匹配的 IDE 名称或 "unknown"
   */
  export function ide() {
    // 检查是否在 VSCode 中运行
    if (process.env["TERM_PROGRAM"] === "vscode") {
      // 获取 GIT_ASKPASS 环境变量
      const v = process.env["GIT_ASKPASS"]

      // 遍历支持的 IDE 列表，查找匹配项
      for (const ide of SUPPORTED_IDES) {
        if (v?.includes(ide.name)) return ide.name
      }
    }

    // 无法检测 IDE
    return "unknown"
  }

  /**
   * 检查扩展是否已安装
   *
   * 通过环境变量检查 OpenCode 扩展是否已安装。
   *
   * @returns 如果扩展已安装返回 true，否则返回 false
   *
   * 检测方式：
   * - 检查 OPENCODE_CALLER 环境变量是否为 "vscode" 或 "vscode-insiders"
   */
  export function alreadyInstalled() {
    // 检查环境变量是否表示从 VSCode 调用
    return process.env["OPENCODE_CALLER"] === "vscode" || process.env["OPENCODE_CALLER"] === "vscode-insiders"
  }

  /**
   * 安装 OpenCode 扩展到指定 IDE
   *
   * 使用 IDE 的命令行工具安装扩展。
   *
   * @param ide - 目标 IDE 名称
   * @throws {Error} 未知的 IDE
   * @throws {InstallFailedError} 安装命令失败
   * @throws {AlreadyInstalledError} 扩展已安装
   *
   * 安装命令：
   * - VSCode 系：code --install-extension sst-dev.opencode
   * - Cursor：cursor --install-extension sst-dev.opencode
   * - 等
   *
   * 扩展 ID：sst-dev.opencode
   */
  export async function install(ide: (typeof SUPPORTED_IDES)[number]["name"]) {
    // 查找对应 IDE 的命令
    const cmd = SUPPORTED_IDES.find((i) => i.name === ide)?.cmd

    // 如果找不到对应 IDE，抛出错误
    if (!cmd) throw new Error(`Unknown IDE: ${ide}`)

    // 使用 spawn 启动安装命令
    const p = spawn([cmd, "--install-extension", "sst-dev.opencode"], {
      stdout: "pipe",  // 捕获标准输出
      stderr: "pipe",  // 捕获标准错误
    })

    // 等待进程退出
    await p.exited

    // 读取输出
    const stdout = await new Response(p.stdout).text()
    const stderr = await new Response(p.stderr).text()

    // 记录安装结果
    log.info("installed", {
      ide,
      stdout,
      stderr,
    })

    // 检查退出码
    if (p.exitCode !== 0) {
      throw new InstallFailedError({ stderr })
    }

    // 检查是否已经安装
    if (stdout.includes("already installed")) {
      throw new AlreadyInstalledError({})
    }
  }
}

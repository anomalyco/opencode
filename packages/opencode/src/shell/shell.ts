/**
 * ============================================================================
 * 文件名：shell.ts
 * 所属包：packages/opencode/src/shell
 * ============================================================================
 *
 * 文件作用：
 * Shell 工具模块。提供 Shell 检测和进程树终止功能。
 *
 * 主要功能：
 * - killTree()：终止进程树（进程及其所有子进程）
 * - preferred()：获取首选 Shell（支持环境变量 SHELL）
 * - acceptable()：获取可接受的 Shell（排除黑名单中的 Shell）
 * - fallback()：获取平台默认 Shell 回退选项
 *
 * 依赖关系：
 * - @/flag/flag：命令行标志位（用于获取 Git Bash 路径）
 * - @/util/lazy：延迟加载工具
 * - path：路径处理
 * - child_process：子进程管理（spawn, ChildProcess）
 *
 * 导出内容：
 * - Shell namespace：Shell 工具命名空间
 *   - killTree(proc, opts)：终止进程树
 *   - preferred：延迟加载的首选 Shell
 *   - acceptable：延迟加载的可接受 Shell
 *
 * 常量：
 * - SIGKILL_TIMEOUT_MS：SIGTERM 到 SIGKILL 的超时时间（200ms）
 * - BLACKLIST：不兼容的 Shell 列表（fish, nu）
 *
 * 平台支持：
 * - win32：使用 taskkill 命令终止进程树
 * - darwin/linux：使用进程组 ID（负 PID）终止进程组
 *
 * @package opencode
 * @module shell
 */

// 导入命令行标志位，用于获取 Git Bash 路径配置
import { Flag } from "@/flag/flag"

// 导入延迟加载工具
import { lazy } from "@/util/lazy"

// 导入路径处理模块
import path from "path"

// 导入子进程管理模块
import { spawn, type ChildProcess } from "child_process"

/**
 * SIGTERM 到 SIGKILL 的超时时间
 *
 * 发送 SIGTERM 后等待进程退出的时间（毫秒）。
 * 如果进程在此时间内未退出，将发送 SIGKILL 强制终止。
 */
const SIGKILL_TIMEOUT_MS = 200

/**
 * Shell 工具命名空间
 *
 * 包含所有 Shell 相关的工具函数。
 */
export namespace Shell {
  /**
   * 终止进程树
   *
   * 终止指定进程及其所有子进程。
   *
   * @param proc - 要终止的子进程对象
   * @param opts - 可选参数
   *   - exited: 检查进程是否已退出的回调函数
   * @returns Promise，进程终止后解析
   *
   * 平台差异：
   * - win32：使用 taskkill /pid /f /t 命令（/t 表示终止子进程树）
   * - darwin/linux：使用负 PID 终止整个进程组
   *
   * 终止策略：
   * 1. 首先发送 SIGTERM 信号，允许进程优雅退出
   * 2. 等待 SIGKILL_TIMEOUT_MS（200ms）
   * 3. 如果进程未退出，发送 SIGKILL 强制终止
   */
  export async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
    // 获取进程 ID
    const pid = proc.pid

    // 如果进程无效或已退出，直接返回
    if (!pid || opts?.exited?.()) return

    // Windows 平台：使用 taskkill 命令终止进程树
    if (process.platform === "win32") {
      // 创建 Promise 等待 taskkill 命令完成
      await new Promise<void>((resolve) => {
        // /f：强制终止
        // /t：终止指定进程及其子进程
        const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" })

        // 命令退出时解析 Promise（无论成功或失败）
        killer.once("exit", () => resolve())
        killer.once("error", () => resolve())
      })
      return
    }

    // Unix 平台（darwin/linux）：尝试使用进程组 ID 终止
    try {
      // 使用负 PID 表示终止整个进程组
      process.kill(-pid, "SIGTERM")

      // 等待进程退出
      await Bun.sleep(SIGKILL_TIMEOUT_MS)

      // 如果进程仍未退出，强制终止
      if (!opts?.exited?.()) {
        process.kill(-pid, "SIGKILL")
      }
    } catch (_e) {
      // 如果进程组终止失败（可能不是进程组组长），回退到直接终止进程
      proc.kill("SIGTERM")

      // 等待进程退出
      await Bun.sleep(SIGKILL_TIMEOUT_MS)

      // 如果进程仍未退出，强制终止
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL")
      }
    }
  }

  /**
   * Shell 黑名单
   *
   * 不兼容的 Shell 列表。
   * 这些 Shell 可能因为语法或行为差异导致问题。
   *
   * - fish：Friendly Interactive Shell，语法与 POSIX 不兼容
   * - nu：Nushell，现代 Shell 但与 POSIX 不兼容
   */
  const BLACKLIST = new Set(["fish", "nu"])

  /**
   * 获取平台默认 Shell（回退选项）
   *
   * 当环境变量 SHELL 未设置或 Shell 在黑名单时使用。
   *
   * @returns Shell 可执行文件路径
   *
   * 平台回退策略：
   * - win32：
   *   1. 使用 Flag.OPENCODE_GIT_BASH_PATH（如果设置）
   *   2. 查找 Git Bash（通过 git.exe 路径推断）
   *   3. 使用 COMSPEC 环境变量（通常是 cmd.exe）
   * - darwin：使用 /bin/zsh
   * - linux：
   *   1. 使用 which 查找 bash
   *   2. 回退到 /bin/sh
   */
  function fallback() {
    // Windows 平台处理
    if (process.platform === "win32") {
      // 如果设置了 Git Bash 路径，直接使用
      if (Flag.OPENCODE_GIT_BASH_PATH) return Flag.OPENCODE_GIT_BASH_PATH

      // 尝试通过 git.exe 查找 bash.exe
      const git = Bun.which("git")
      if (git) {
        // git.exe 通常位于：C:\Program Files\Git\cmd\git.exe
        // bash.exe 通常位于：C:\Program Files\Git\bin\bash.exe
        const bash = path.join(git, "..", "..", "bin", "bash.exe")

        // 如果 bash.exe 存在，返回路径
        if (Bun.file(bash).size) return bash
      }

      // 回退到命令提示符（cmd.exe）
      return process.env.COMSPEC || "cmd.exe"
    }

    // macOS 平台：使用 zsh
    if (process.platform === "darwin") return "/bin/zsh"

    // Linux 平台：尝试查找 bash
    const bash = Bun.which("bash")
    if (bash) return bash

    // 最后回退到 sh
    return "/bin/sh"
  }

  /**
   * 首选 Shell（延迟加载）
   *
   * 返回用户配置的首选 Shell。
   * 优先使用环境变量 SHELL，否则使用平台回退选项。
   *
   * 注意：不检查黑名单，直接使用 SHELL 环境变量。
   */
  export const preferred = lazy(() => {
    // 优先使用 SHELL 环境变量
    const s = process.env.SHELL
    if (s) return s

    // 否则使用平台回退选项
    return fallback()
  })

  /**
   * 可接受的 Shell（延迟加载）
   *
   * 返回一个可用的且兼容的 Shell。
   * 排除黑名单中的 Shell（fish, nu）。
   *
   * 与 preferred 的区别：
   * - preferred：直接使用 SHELL 环境变量（不考虑兼容性）
   * - acceptable：如果 SHELL 在黑名单中，使用回退选项
   */
  export const acceptable = lazy(() => {
    // 获取 SHELL 环境变量
    const s = process.env.SHELL

    // 如果 SHELL 已设置且不在黑名单中，使用它
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s

    // 否则使用平台回退选项
    return fallback()
  })
}

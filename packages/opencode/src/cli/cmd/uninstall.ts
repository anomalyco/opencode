/**
 * ============================================================================
 * 文件名：uninstall.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 卸载命令模块。提供 OpenCode 完全卸载功能。
 *
 * 主要功能：
 * - UninstallCommand：卸载命令
 * - 收集需要删除的目录和文件
 * - 显示卸载摘要（包含目录大小）
 * - 删除数据、缓存、配置、状态目录
 * - 清理 shell 配置文件中的 PATH 设置
 * - 通过包管理器卸载（npm、pnpm、bun、yarn、brew）
 * - 删除 curl 安装的二进制文件
 * - 支持 dry-run 模式（预览）
 * - 支持 force 模式（跳过确认）
 *
 * 依赖关系：
 * - yargs：命令行参数解析
 * - ../ui：UI 工具
 * - @clack/prompts：交互式提示
 * - ../../installation：安装方法检测
 * - ../../global：全局路径
 * - bun：Bun shell ($)
 * - fs/promises：文件系统操作
 * - path：路径处理
 * - os：系统信息
 *
 * 导出内容：
 * - UninstallCommand：卸载命令定义
 * - UninstallArgs：卸载参数接口
 * - RemovalTargets：删除目标接口
 *
 * 命令参数：
 * - --keep-config (-c)：保留配置文件
 * - --keep-data (-d)：保留会话数据和快照
 * - --dry-run：显示将要删除的内容而不实际删除
 * - --force (-f)：跳过确认提示
 *
 * 支持的 shell：
 * - fish：~/.config/fish/config.fish
 * - zsh：~/.zshrc, ~/.zshenv, ~/.config/zsh/.zshrc, ~/.config/zsh/.zshenv
 * - bash：~/.bashrc, ~/.bash_profile, ~/.profile, ~/.config/bash/.bashrc
 * - ash：~/.ashrc, ~/.profile
 * - sh：~/.profile
 *
 * 支持的包管理器：
 * - npm：npm uninstall -g opencode-ai
 * - pnpm：pnpm uninstall -g opencode-ai
 * - bun：bun remove -g opencode-ai
 * - yarn：yarn global remove opencode-ai
 * - brew：brew uninstall opencode
 *
 * @package opencode
 * @module cli/cmd/uninstall
 */

// 导入 yargs 类型
import type { Argv } from "yargs"

// 导入 UI 工具
import { UI } from "../ui"

// 导入交互式提示
import * as prompts from "@clack/prompts"

// 导入安装方法检测
import { Installation } from "../../installation"

// 导入全局路径
import { Global } from "../../global"

// 导入 Bun shell
import { $ } from "bun"

// 导入文件系统操作
import fs from "fs/promises"

// 导入路径处理
import path from "path"

// 导入系统信息
import os from "os"

/**
 * 卸载命令参数接口
 */
interface UninstallArgs {
  // 是否保留配置文件
  keepConfig: boolean
  // 是否保留数据
  keepData: boolean
  // 是否为 dry-run 模式
  dryRun: boolean
  // 是否跳过确认
  force: boolean
}

/**
 * 删除目标接口
 *
 * 定义需要删除的所有内容。
 */
interface RemovalTargets {
  // 目录列表（路径、标签、是否保留）
  directories: Array<{ path: string; label: string; keep: boolean }>
  // Shell 配置文件路径（如果有）
  shellConfig: string | null
  // 二进制文件路径（如果有）
  binary: string | null
}

/**
 * 卸载命令
 *
 * 完全卸载 OpenCode 并移除所有相关文件。
 */
export const UninstallCommand = {
  command: "uninstall",
  describe: "uninstall opencode and remove all related files",
  builder: (yargs: Argv) =>
    yargs
      // 保留配置选项
      .option("keep-config", {
        alias: "c",
        type: "boolean",
        describe: "keep configuration files",
        default: false,
      })
      // 保留数据选项
      .option("keep-data", {
        alias: "d",
        type: "boolean",
        describe: "keep session data and snapshots",
        default: false,
      })
      // Dry-run 选项
      .option("dry-run", {
        type: "boolean",
        describe: "show what would be removed without removing",
        default: false,
      })
      // 强制卸载选项
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "skip confirmation prompts",
        default: false,
      }),

  handler: async (args: UninstallArgs) => {
    // 打印空行
    UI.empty()
    // 打印 Logo
    UI.println(UI.logo("  "))
    // 打印空行
    UI.empty()
    // 显示卸载提示
    prompts.intro("Uninstall OpenCode")

    // 检测安装方法
    const method = await Installation.method()
    prompts.log.info(`Installation method: ${method}`)

    // 收集需要删除的目标
    const targets = await collectRemovalTargets(args, method)

    // 显示删除摘要
    await showRemovalSummary(targets, method)

    // 确认卸载（非 force 且非 dry-run 时）
    if (!args.force && !args.dryRun) {
      const confirm = await prompts.confirm({
        message: "Are you sure you want to uninstall?",
        initialValue: false,
      })
      // 用户取消或确认失败
      if (!confirm || prompts.isCancel(confirm)) {
        prompts.outro("Cancelled")
        return
      }
    }

    // Dry-run 模式
    if (args.dryRun) {
      prompts.log.warn("Dry run - no changes made")
      prompts.outro("Done")
      return
    }

    // 执行卸载
    await executeUninstall(method, targets)

    // 显示完成消息
    prompts.outro("Done")
  },
}

/**
 * 收集删除目标
 *
 * 根据参数和安装方法确定需要删除的内容。
 *
 * @param args - 命令参数
 * @param method - 安装方法
 * @returns Promise，解析为删除目标
 */
async function collectRemovalTargets(args: UninstallArgs, method: Installation.Method): Promise<RemovalTargets> {
  // 定义要删除的目录
  const directories: RemovalTargets["directories"] = [
    // 数据目录（根据 --keep-data 决定是否保留）
    { path: Global.Path.data, label: "Data", keep: args.keepData },
    // 缓存目录（总是删除）
    { path: Global.Path.cache, label: "Cache", keep: false },
    // 配置目录（根据 --keep-config 决定是否保留）
    { path: Global.Path.config, label: "Config", keep: args.keepConfig },
    // 状态目录（总是删除）
    { path: Global.Path.state, label: "State", keep: false },
  ]

  // 只有 curl 安装才清理 shell 配置
  const shellConfig = method === "curl" ? await getShellConfigFile() : null
  // curl 安装的二进制文件路径
  const binary = method === "curl" ? process.execPath : null

  return { directories, shellConfig, binary }
}

/**
 * 显示删除摘要
 *
 * 打印将要删除的内容及其大小。
 *
 * @param targets - 删除目标
 * @param method - 安装方法
 */
async function showRemovalSummary(targets: RemovalTargets, method: Installation.Method) {
  prompts.log.message("The following will be removed:")

  // 遍历目录
  for (const dir of targets.directories) {
    // 检查目录是否存在
    const exists = await fs
      .access(dir.path)
      .then(() => true)
      .catch(() => false)
    // 跳过不存在的目录
    if (!exists) continue

    // 获取目录大小
    const size = await getDirectorySize(dir.path)
    const sizeStr = formatSize(size)
    // 状态标记（保留或删除）
    const status = dir.keep ? UI.Style.TEXT_DIM + "(keeping)" : ""
    // 前缀符号（○ 保留，✓ 删除）
    const prefix = dir.keep ? "○" : "✓"

    // 打印目录信息
    prompts.log.info(`  ${prefix} ${dir.label}: ${shortenPath(dir.path)} ${UI.Style.TEXT_DIM}(${sizeStr})${status}`)
  }

  // 打印二进制文件信息
  if (targets.binary) {
    prompts.log.info(`  ✓ Binary: ${shortenPath(targets.binary)}`)
  }

  // 打印 shell 配置信息
  if (targets.shellConfig) {
    prompts.log.info(`  ✓ Shell PATH in ${shortenPath(targets.shellConfig)}`)
  }

  // 打印包管理器卸载命令
  if (method !== "curl" && method !== "unknown") {
    const cmds: Record<string, string> = {
      npm: "npm uninstall -g opencode-ai",
      pnpm: "pnpm uninstall -g opencode-ai",
      bun: "bun remove -g opencode-ai",
      yarn: "yarn global remove opencode-ai",
      brew: "brew uninstall opencode",
    }
    prompts.log.info(`  ✓ Package: ${cmds[method] || method}`)
  }
}

/**
 * 执行卸载
 *
 * 实际删除所有目标。
 *
 * @param method - 安装方法
 * @param targets - 删除目标
 */
async function executeUninstall(method: Installation.Method, targets: RemovalTargets) {
  // 创建进度 spinner
  const spinner = prompts.spinner()
  // 错误列表
  const errors: string[] = []

  // ==================== 删除目录 ====================
  for (const dir of targets.directories) {
    // 跳过保留的目录
    if (dir.keep) {
      prompts.log.step(`Skipping ${dir.label} (--keep-${dir.label.toLowerCase()})`)
      continue
    }

    // 检查目录是否存在
    const exists = await fs
      .access(dir.path)
      .then(() => true)
      .catch(() => false)
    if (!exists) continue

    // 删除目录
    spinner.start(`Removing ${dir.label}...`)
    const err = await fs.rm(dir.path, { recursive: true, force: true }).catch((e) => e)
    if (err) {
      spinner.stop(`Failed to remove ${dir.label}`, 1)
      errors.push(`${dir.label}: ${err.message}`)
      continue
    }
    spinner.stop(`Removed ${dir.label}`)
  }

  // ==================== 清理 shell 配置 ====================
  if (targets.shellConfig) {
    spinner.start("Cleaning shell config...")
    const err = await cleanShellConfig(targets.shellConfig).catch((e) => e)
    if (err) {
      spinner.stop("Failed to clean shell config", 1)
      errors.push(`Shell config: ${err.message}`)
    } else {
      spinner.stop("Cleaned shell config")
    }
  }

  // ==================== 包管理器卸载 ====================
  if (method !== "curl" && method !== "unknown") {
    // 定义各包管理器的卸载命令
    const cmds: Record<string, string[]> = {
      npm: ["npm", "uninstall", "-g", "opencode-ai"],
      pnpm: ["pnpm", "uninstall", "-g", "opencode-ai"],
      bun: ["bun", "remove", "-g", "opencode-ai"],
      yarn: ["yarn", "global", "remove", "opencode-ai"],
      brew: ["brew", "uninstall", "opencode"],
    }

    const cmd = cmds[method]
    if (cmd) {
      spinner.start(`Running ${cmd.join(" ")}...`)
      const result = await $`${cmd}`.quiet().nothrow()
      if (result.exitCode !== 0) {
        spinner.stop(`Package manager uninstall failed`, 1)
        prompts.log.warn(`You may need to run manually: ${cmd.join(" ")}`)
        errors.push(`Package manager: exit code ${result.exitCode}`)
      } else {
        spinner.stop("Package removed")
      }
    }
  }

  // ==================== 删除 curl 安装的二进制文件 ====================
  if (method === "curl" && targets.binary) {
    UI.empty()
    prompts.log.message("To finish removing the binary, run:")
    prompts.log.info(`  rm "${targets.binary}"`)

    // 如果在 .opencode 目录中，也删除目录
    const binDir = path.dirname(targets.binary)
    if (binDir.includes(".opencode")) {
      prompts.log.info(`  rmdir "${binDir}" 2>/dev/null`)
    }
  }

  // ==================== 显示错误 ====================
  if (errors.length > 0) {
    UI.empty()
    prompts.log.warn("Some operations failed:")
    for (const err of errors) {
      prompts.log.error(`  ${err}`)
    }
  }

  // ==================== 感谢消息 ====================
  UI.empty()
  prompts.log.success("Thank you for using OpenCode!")
}

/**
 * 获取 shell 配置文件路径
 *
 * 根据当前 shell 查找包含 OpenCode PATH 设置的配置文件。
 *
 * @returns Promise，解析为配置文件路径，如果未找到则返回 null
 *
 * 支持的配置文件位置：
 * - fish: ~/.config/fish/config.fish
 * - zsh: ~/.zshrc, ~/.zshenv, ~/.config/zsh/.zshrc, ~/.config/zsh/.zshenv
 * - bash: ~/.bashrc, ~/.bash_profile, ~/.profile, ~/.config/bash/.bashrc, ~/.config/bash/.bash_profile
 * - ash: ~/.ashrc, ~/.profile
 * - sh: ~/.profile
 */
async function getShellConfigFile(): Promise<string | null> {
  // 获取当前 shell 名称（默认 bash）
  const shell = path.basename(process.env.SHELL || "bash")
  // 获取用户主目录
  const home = os.homedir()
  // 获取 XDG 配置目录（默认 ~/.config）
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config")

  // 定义各 shell 的配置文件位置
  const configFiles: Record<string, string[]> = {
    fish: [path.join(xdgConfig, "fish", "config.fish")],
    zsh: [
      path.join(home, ".zshrc"),
      path.join(home, ".zshenv"),
      path.join(xdgConfig, "zsh", ".zshrc"),
      path.join(xdgConfig, "zsh", ".zshenv"),
    ],
    bash: [
      path.join(home, ".bashrc"),
      path.join(home, ".bash_profile"),
      path.join(home, ".profile"),
      path.join(xdgConfig, "bash", ".bashrc"),
      path.join(xdgConfig, "bash", ".bash_profile"),
    ],
    ash: [path.join(home, ".ashrc"), path.join(home, ".profile")],
    sh: [path.join(home, ".profile")],
  }

  // 获取候选文件列表（未找到则使用 bash 的列表）
  const candidates = configFiles[shell] || configFiles.bash

  // 遍历候选文件
  for (const file of candidates) {
    // 检查文件是否存在
    const exists = await fs
      .access(file)
      .then(() => true)
      .catch(() => false)
    if (!exists) continue

    // 读取文件内容
    const content = await Bun.file(file)
      .text()
      .catch(() => "")
    // 检查是否包含 OpenCode 相关内容
    if (content.includes("# opencode") || content.includes(".opencode/bin")) {
      return file
    }
  }

  return null
}

/**
 * 清理 shell 配置文件
 *
 * 移除 OpenCode 相关的 PATH 设置。
 *
 * @param file - 配置文件路径
 *
 * 移除的内容：
 * - "# opencode" 注释行及其下一行的 PATH 设置
 * - 包含 ".opencode/bin" 的 export PATH 行
 * - 包含 ".opencode" 的 fish_add_path 行
 */
async function cleanShellConfig(file: string) {
  // 读取文件内容
  const content = await Bun.file(file).text()
  const lines = content.split("\n")

  // 过滤后的行列表
  const filtered: string[] = []
  // 跳过标记
  let skip = false

  // 遍历每一行
  for (const line of lines) {
    const trimmed = line.trim()

    // 检测 opencode 注释标记
    if (trimmed === "# opencode") {
      skip = true
      continue
    }

    // 跳过标记后的下一行（如果包含 opencode 相关内容）
    if (skip) {
      skip = false
      if (trimmed.includes(".opencode/bin") || trimmed.includes("fish_add_path")) {
        continue
      }
    }

    // 跳过包含 opencode 的 PATH 设置
    if (
      (trimmed.startsWith("export PATH=") && trimmed.includes(".opencode/bin")) ||
      (trimmed.startsWith("fish_add_path") && trimmed.includes(".opencode"))
    ) {
      continue
    }

    // 保留其他行
    filtered.push(line)
  }

  // 移除末尾空行
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
    filtered.pop()
  }

  // 写入清理后的内容
  const output = filtered.join("\n") + "\n"
  await Bun.write(file, output)
}

/**
 * 获取目录大小
 *
 * 递归计算目录中所有文件的总大小。
 *
 * @param dir - 目录路径
 * @returns Promise，解析为字节大小
 */
async function getDirectorySize(dir: string): Promise<number> {
  let total = 0

  /**
   * 递归遍历目录
   *
   * @param current - 当前遍历路径
   */
  const walk = async (current: string) => {
    // 读取目录内容
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])

    // 遍历每个条目
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      // 目录：递归遍历
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      // 文件：累加大小
      if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null)
        if (stat) total += stat.size
      }
    }
  }

  await walk(dir)
  return total
}

/**
 * 格式化大小
 *
 * 将字节转换为人类可读的格式。
 *
 * @param bytes - 字节数
 * @returns 格式化后的字符串
 *
 * 格式：
 * - < 1 KB：显示为 "X B"
 * - < 1 MB：显示为 "X.X KB"
 * - < 1 GB：显示为 "X.X MB"
 * - >= 1 GB：显示为 "X.X GB"
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * 缩短路径
 *
 * 将用户主目录替换为 ~。
 *
 * @param p - 路径
 * @returns 缩短后的路径
 */
function shortenPath(p: string): string {
  const home = os.homedir()
  if (p.startsWith(home)) {
    return p.replace(home, "~")
  }
  return p
}

/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/installation
 * ============================================================================
 *
 * 文件作用：
 * 安装和升级管理模块。检测安装方法、执行升级、获取版本信息。
 *
 * 主要功能：
 * - 检测安装方法（curl、npm、pnpm、bun、brew）
 * - 执行升级到指定版本
 * - 获取最新版本信息
 * - 判断是否为预览版本或本地版本
 * - 发送安装相关事件
 *
 * 依赖关系：
 * - @/bus/bus-event：事件定义
 * - path：路径处理
 * - bun：Bun shell ($)
 * - zod：类型验证
 * - @opencode-ai/util/error：命名错误
 * - ../util/log：日志
 * - @/util/iife：IIFE 工具
 * - ../flag/flag：标志位
 *
 * 导出内容：
 * - Installation namespace：安装管理命名空间
 *   - VERSION：当前版本
 *   - CHANNEL：发布渠道
 *   - USER_AGENT：用户代理字符串
 *   - Info：安装信息 Zod schema
 *   - Event：安装事件
 *   - UpgradeFailedError：升级失败错误
 *   - method()：检测安装方法
 *   - upgrade(method, target)：执行升级
 *   - latest()：获取最新版本
 *   - info()：获取安装信息
 *   - isPreview()：是否为预览版本
 *   - isLocal()：是否为本地版本
 *
 * 支持的安装方法：
 * - curl：通过 install.opencode.ai 脚本安装
 * - npm：通过 npm 全局安装
 * - pnpm：通过 pnpm 全局安装
 * - bun：通过 bun 全局安装
 * - brew：通过 Homebrew 安装
 * - unknown：无法检测安装方法
 *
 * 版本渠道：
 * - latest：稳定版本
 * - preview：预览版本
 * - local：本地开发版本
 *
 * @package opencode
 * @module installation
 */

// 导入事件定义工具
import { BusEvent } from "@/bus/bus-event"

// 导入路径处理
import path from "path"

// 导入 Bun shell
import { $ } from "bun"

// 导入 Zod 类型验证库
import z from "zod"

// 导入命名错误
import { NamedError } from "@opencode-ai/util/error"

// 导入日志
import { Log } from "../util/log"

// 导入 IIFE 工具
import { iife } from "@/util/iife"

// 导入标志位
import { Flag } from "../flag/flag"

/**
 * 全局变量声明
 *
 * 在构建时注入版本和渠道信息。
 */
declare global {
  // OpenCode 版本号
  const OPENCODE_VERSION: string
  // OpenCode 发布渠道（latest/preview/local）
  const OPENCODE_CHANNEL: string
}

/**
 * 安装管理命名空间
 *
 * 包含所有安装和升级相关的功能。
 */
export namespace Installation {
  // 创建安装服务日志记录器
  const log = Log.create({ service: "installation" })

  /**
   * 安装方法类型
   *
   * 可能的值：curl、npm、pnpm、bun、brew、unknown
   */
  export type Method = Awaited<ReturnType<typeof method>>

  /**
   * 安装事件
   *
   * 定义安装相关的事件类型。
   */
  export const Event = {
    /**
     * 安装更新事件
     *
     * 当 OpenCode 成功更新到新版本时触发。
     */
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        // 新版本号
        version: z.string(),
      }),
    ),

    /**
     * 更新可用事件
     *
     * 当检测到有新版本可用时触发。
     */
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        // 可用的新版本号
        version: z.string(),
      }),
    ),
  }

  /**
   * 安装信息 Zod Schema
   *
   * 验证安装信息的数据结构。
   */
  export const Info = z
    .object({
      // 当前版本
      version: z.string(),
      // 最新版本
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  /**
   * 获取安装信息
   *
   * @returns Promise，解析为包含当前版本和最新版本的对象
   */
  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  /**
   * 判断是否为预览版本
   *
   * @returns 是否为预览版本（非 latest 渠道）
   */
  export function isPreview() {
    return CHANNEL !== "latest"
  }

  /**
   * 判断是否为本地版本
   *
   * @returns 是否为本地开发版本
   */
  export function isLocal() {
    return CHANNEL === "local"
  }

  /**
   * 检测安装方法
   *
   * 通过检查可执行文件路径和已安装的包来确定安装方法。
   *
   * @returns Promise，解析为安装方法名称
   *
   * 检测逻辑：
   * 1. 如果 execPath 包含 .opencode/bin 或 .local/bin，返回 "curl"
   * 2. 检查各包管理器的全局包列表
   * 3. 优先匹配 execPath 中包含的包管理器名称
   */
  export async function method() {
    // 检查是否为 curl 安装（特定路径特征）
    if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"

    // 转换为小写用于匹配
    const exec = process.execPath.toLowerCase()

    // 定义各包管理器的检查方法
    const checks = [
      {
        name: "npm" as const,
        command: () => $`npm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "yarn" as const,
        command: () => $`yarn global list`.throws(false).quiet().text(),
      },
      {
        name: "pnpm" as const,
        command: () => $`pnpm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "bun" as const,
        command: () => $`bun pm ls -g`.throws(false).quiet().text(),
      },
      {
        name: "brew" as const,
        command: () => $`brew list --formula opencode`.throws(false).quiet().text(),
      },
    ]

    // 排序：优先检查 execPath 中包含的包管理器
    checks.sort((a, b) => {
      const aMatches = exec.includes(a.name)
      const bMatches = exec.includes(b.name)
      if (aMatches && !bMatches) return -1
      if (!aMatches && bMatches) return 1
      return 0
    })

    // 依次检查各包管理器
    for (const check of checks) {
      const output = await check.command()
      // 检查输出中是否包含 opencode 包
      if (output.includes(check.name === "brew" ? "opencode" : "opencode-ai")) {
        return check.name
      }
    }

    // 无法检测安装方法
    return "unknown"
  }

  /**
   * 升级失败错误
   *
   * 当升级命令执行失败时抛出。
   */
  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      // 标准错误输出
      stderr: z.string(),
    }),
  )

  /**
   * 获取 Homebrew formula 名称
   *
   * 检查是从哪个 tap 安装的 opencode。
   *
   * @returns Promise，解析为 formula 名称
   *
   * 可能的返回值：
   * - "anomalyco/tap/opencode"：从自定义 tap 安装
   * - "opencode"：从 core tap 安装
   */
  async function getBrewFormula() {
    // 检查自定义 tap
    const tapFormula = await $`brew list --formula anomalyco/tap/opencode`.throws(false).quiet().text()
    if (tapFormula.includes("opencode")) return "anomalyco/tap/opencode"
    // 检查 core tap
    const coreFormula = await $`brew list --formula opencode`.throws(false).quiet().text()
    if (coreFormula.includes("opencode")) return "opencode"
    // 默认使用 core
    return "opencode"
  }

  /**
   * 执行升级
   *
   * 根据安装方法执行相应的升级命令。
   *
   * @param method - 安装方法
   * @param target - 目标版本
   * @throws {UpgradeFailedError} 升级失败时
   * @throws {Error} 未知安装方法
   *
   * 各方法的升级命令：
   * - curl：curl -fsSL https://opencode.ai/install | bash
   * - npm：npm install -g opencode-ai@{target}
   * - pnpm：pnpm install -g opencode-ai@{target}
   * - bun：bun install -g opencode-ai@{target}
   * - brew：brew upgrade {formula}
   */
  export async function upgrade(method: Method, target: string) {
    let cmd

    // 根据安装方法选择升级命令
    switch (method) {
      case "curl":
        // 使用安装脚本，设置 VERSION 环境变量
        cmd = $`curl -fsSL https://opencode.ai/install | bash`.env({
          ...process.env,
          VERSION: target,
        })
        break
      case "npm":
        cmd = $`npm install -g opencode-ai@${target}`
        break
      case "pnpm":
        cmd = $`pnpm install -g opencode-ai@${target}`
        break
      case "bun":
        cmd = $`bun install -g opencode-ai@${target}`
        break
      case "brew": {
        const formula = await getBrewFormula()
        // 禁用自动更新以加快速度
        cmd = $`brew upgrade ${formula}`.env({
          HOMEBREW_NO_AUTO_UPDATE: "1",
          ...process.env,
        })
        break
      }
      default:
        throw new Error(`Unknown method: ${method}`)
    }

    // 执行升级命令
    const result = await cmd.quiet().throws(false)

    // 记录升级结果
    log.info("upgraded", {
      method,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })

    // 检查升级是否成功
    if (result.exitCode !== 0)
      throw new UpgradeFailedError({
        stderr: result.stderr.toString("utf8"),
      })

    // 验证新版本
    await $`${process.execPath} --version`.nothrow().quiet().text()
  }

  /**
   * 当前版本
   *
   * 从全局变量或构建时注入的值获取。
   */
  export const VERSION = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"

  /**
   * 发布渠道
   *
   * 可能的值：latest、preview、local
   */
  export const CHANNEL = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"

  /**
   * 用户代理字符串
   *
   * 用于 API 请求，格式：opencode/{channel}/{version}/{client}
   */
  export const USER_AGENT = `opencode/${CHANNEL}/${VERSION}/${Flag.OPENCODE_CLIENT}`

  /**
   * 获取最新版本
   *
   * 根据安装方法从相应的源获取最新版本号。
   *
   * @param installMethod - 可选的安装方法（默认自动检测）
   * @returns Promise，解析为最新版本号
   *
   * 各方法的版本获取源：
   * - brew：从 Homebrew formula API
   * - npm/pnpm/bun：从 npm registry
   * - curl/其他：从 GitHub Releases API
   */
  export async function latest(installMethod?: Method) {
    // 使用指定方法或自动检测
    const detectedMethod = installMethod || (await method())

    if (detectedMethod === "brew") {
      const formula = await getBrewFormula()
      if (formula === "opencode") {
        // 从 Homebrew formula API 获取版本
        return fetch("https://formulae.brew.sh/api/formula/opencode.json")
          .then((res) => {
            if (!res.ok) throw new Error(res.statusText)
            return res.json()
          })
          .then((data: any) => data.versions.stable)
      }
    }

    if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
      // 获取 npm registry 地址
      const registry = await iife(async () => {
        const r = (await $`npm config get registry`.quiet().nothrow().text()).trim()
        const reg = r || "https://registry.npmjs.org"
        return reg.endsWith("/") ? reg.slice(0, -1) : reg
      })
      // 从 npm registry 获取版本
      const channel = CHANNEL
      return fetch(`${registry}/opencode-ai/${channel}`)
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    // 从 GitHub Releases API 获取版本
    return fetch("https://api.github.com/repos/anomalyco/opencode/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.tag_name.replace(/^v/, ""))
  }
}

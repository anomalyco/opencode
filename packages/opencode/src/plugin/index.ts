/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/plugin
 * ============================================================================
 *
 * 文件作用：
 * 插件系统核心模块。管理插件的加载、初始化和生命周期。
 *
 * 主要功能：
 * - INTERNAL_PLUGINS：内置插件列表
 * - state：插件状态管理（hooks 和 input）
 * - trigger(name, input, output)：触发插件钩子
 * - list()：获取所有已加载的插件
 * - init()：初始化所有插件
 *
 * 依赖关系：
 * - @opencode-ai/plugin：插件 SDK 类型定义
 * - ../config/config：配置系统
 * - ../bus：事件总线
 * - ../util/log：日志记录
 * - @opencode-ai/sdk：OpenCode SDK 客户端
 * - ../server/server：服务器管理
 * - ../bun：Bun 运行时工具
 * - ../project/instance：实例管理
 * - ../flag/flag：功能标志
 * - ./codex：内置 Codex 认证插件
 * - ../session：会话管理
 * - @opencode-ai/util/error：命名错误
 *
 * 导出内容：
 * - Plugin namespace：插件管理命名空间
 *   - trigger()：触发插件钩子
 *   - list()：获取所有插件
 *   - init()：初始化插件
 *
 * 插件类型：
 * 1. 内置插件：直接导入的插件（INTERNAL_PLUGINS）
 * 2. 配置插件：用户在配置文件中指定的插件
 * 3. 默认插件：BUILTIN 列表中的插件
 *
 * 插件生命周期：
 * 1. 创建插件输入（client, project, worktree, directory 等）
 * 2. 调用插件工厂函数创建钩子
 * 3. 在各种时机触发钩子
 *
 * 使用示例：
 * ```typescript
 * // 初始化插件
 * await Plugin.init()
 *
 * // 触发钩子
 * await Plugin.trigger("beforeRequest", input, output)
 *
 * // 获取所有插件
 * const hooks = await Plugin.list()
 * ```
 *
 * @package opencode
 * @module plugin/index
 */

// 导入插件 SDK 类型
import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"

// 导入配置系统
import { Config } from "../config/config"

// 导入事件总线
import { Bus } from "../bus"

// 导入日志工具
import { Log } from "../util/log"

// 导入 OpenCode SDK 客户端
import { createOpencodeClient } from "@opencode-ai/sdk"

// 导入服务器管理模块
import { Server } from "../server/server"

// 导入 Bun 运行时工具
import { BunProc } from "../bun"

// 导入实例管理模块
import { Instance } from "../project/instance"

// 导入功能标志
import { Flag } from "../flag/flag"

// 导入内置 Codex 认证插件
import { CodexAuthPlugin } from "./codex"

// 导入会话管理模块
import { Session } from "../session"

// 导入命名错误工具
import { NamedError } from "@opencode-ai/util/error"

/**
 * 插件管理命名空间
 *
 * 管理插件的加载、初始化和执行。
 */
export namespace Plugin {
  // 创建日志记录器
  const log = Log.create({ service: "plugin" })

  /**
   * 内置插件列表
   *
   * 这些插件默认加载，除非用户明确禁用。
   */
  const BUILTIN = ["opencode-copilot-auth@0.0.12", "opencode-anthropic-auth@0.0.8"]

  /**
   * 内置插件实例
   *
   * 直接导入而非从 npm 安装的插件。
   * 这些插件始终可用，不需要网络安装。
   */
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin]

  /**
   * 插件状态
   *
   * 实例级状态，包含插件钩子和输入。
   */
  const state = Instance.state(async () => {
    // 创建 OpenCode SDK 客户端
    // 连接到本地服务器
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      // @ts-ignore - fetch 类型不兼容
      // 使用服务器的 fetch 函数，避免额外的网络请求
      fetch: async (...args) => Server.App().fetch(...args),
    })

    // 获取配置
    const config = await Config.get()

    // 钩子列表
    const hooks: Hooks[] = []

    // 构造插件输入
    const input: PluginInput = {
      // SDK 客户端
      client,
      // 项目信息
      project: Instance.project,
      // 工作树根目录
      worktree: Instance.worktree,
      // 工作目录
      directory: Instance.directory,
      // 服务器 URL
      serverUrl: Server.url(),
      // Shell 命令执行器
      $: Bun.$,
    }

    // 加载内置插件
    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      // 调用插件工厂函数
      const init = await plugin(input)
      hooks.push(init)
    }

    // 获取用户配置的插件
    const plugins = [...(config.plugin ?? [])]
    // 如果未禁用默认插件，添加内置插件
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push(...BUILTIN)
    }

    // 加载外部插件
    for (let plugin of plugins) {
      // 忽略旧的 Codex 插件（现已内置）
      if (plugin.includes("opencode-openai-codex-auth")) continue
      log.info("loading plugin", { path: plugin })

      // 如果不是 file:// 协议，需要安装
      if (!plugin.startsWith("file://")) {
        // 解析包名和版本
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"

        // 检查是否为内置插件
        const builtin = BUILTIN.some((x) => x.startsWith(pkg + "@"))

        // 安装插件包
        plugin = await BunProc.install(pkg, version).catch((err) => {
          // 如果不是内置插件，抛出错误
          if (!builtin) throw err

          // 内置插件安装失败，记录错误但不中断
          const message = err instanceof Error ? err.message : String(err)
          log.error("failed to install builtin plugin", {
            pkg,
            version,
            error: message,
          })

          // 发布错误事件
          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: `Failed to install built-in plugin ${pkg}@${version}: ${message}`,
            }).toObject(),
          })

          return ""
        })

        // 如果安装失败，跳过此插件
        if (!plugin) continue
      }

      // 导入插件模块
      const mod = await import(plugin)

      // 防止重复初始化：当插件同时导出命名导出和默认导出时
      // （例如 `export const X` 和 `export default X` 指向同一函数）
      // Object.entries(mod) 会返回两个指向同一函数引用的条目
      const seen = new Set<PluginInstance>()

      // 遍历模块导出
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        // 跳过已处理的函数
        if (seen.has(fn)) continue
        seen.add(fn)

        // 调用插件工厂函数
        const init = await fn(input)
        hooks.push(init)
      }
    }

    return {
      hooks,
      input,
    }
  })

  /**
   * 触发插件钩子
   *
   * 在指定时机调用所有插件的相关钩子函数。
   *
   * @param name - 钩子名称
   * @param input - 钩子输入参数
   * @param output - 钩子输出参数（可被插件修改）
   * @returns Promise，解析为处理后的输出
   *
   * 工作流程：
   * 1. 遍历所有已加载的插件
   * 2. 对于每个插件，查找指定的钩子
   * 3. 如果钩子存在，调用它
   * 4. 按顺序处理，后一个插件接收前一个插件的输出
   *
   * @example
   * ```typescript
   * // 触发请求前钩子
   * await Plugin.trigger("beforeRequest", { request }, { headers: {} })
   * ```
   */
  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    // 如果钩子名称为空，直接返回
    if (!name) return output

    // 遍历所有插件的钩子
    for (const hook of await state().then((x) => x.hooks)) {
      // 检查插件是否实现了此钩子
      const fn = hook[name]
      if (!fn) continue

      // @ts-expect-error 类型系统限制，无法精确推断钩子函数类型
      // try-counter: 2
      // 调用钩子函数
      await fn(input, output)
    }
    return output
  }

  /**
   * 获取所有已加载的插件
   *
   * @returns Promise，解析为插件钩子列表
   *
   * @example
   * ```typescript
   * const hooks = await Plugin.list()
   * console.log(hooks.length) // 插件数量
   * ```
   */
  export async function list() {
    return state().then((x) => x.hooks)
  }

  /**
   * 初始化所有插件
   *
   * 设置插件的事件监听和配置钩子。
   *
   * @returns Promise，完成时所有插件已初始化
   *
   * 初始化流程：
   * 1. 调用每个插件的 config 钩子
   * 2. 订阅所有事件，触发插件的 event 钩子
   *
   * @example
   * ```typescript
   * // 在应用启动时初始化插件
   * await Plugin.init()
   * ```
   */
  export async function init() {
    // 获取所有插件钩子
    const hooks = await state().then((x) => x.hooks)

    // 获取配置
    const config = await Config.get()

    // 调用每个插件的 config 钩子
    for (const hook of hooks) {
      // @ts-expect-error 插件类型未迁移到 SDK v2
      await hook.config?.(config)
    }

    // 订阅所有事件
    Bus.subscribeAll(async (input) => {
      // 获取所有插件钩子
      const hooks = await state().then((x) => x.hooks)

      // 触发每个插件的 event 钩子
      for (const hook of hooks) {
        hook["event"]?.({
          event: input,
        })
      }
    })
  }
}

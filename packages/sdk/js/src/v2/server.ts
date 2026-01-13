/**
 * ============================================================================
 * 文件名：server.ts
 * 所属包：packages/sdk/js/src/v2
 * ============================================================================
 *
 * 文件作用：
 * OpenCode SDK V2 版本的服务器模块。
 * 提供创建和管理 OpenCode 服务器的功能，用于本地开发和测试。
 *
 * 主要功能：
 * - 启动 OpenCode V2 服务器进程
 * - 解析服务器 URL
 * - 管理服务器生命周期（启动/关闭）
 * - 创建 TUI（终端用户界面）会话
 *
 * 依赖关系：
 * - node:child_process：用于启动子进程
 * - gen/types.gen.js：类型定义
 *
 * 导出内容：
 * - createOpencodeServer：创建 OpenCode V2 服务器
 * - createOpencodeTui：创建 OpenCode V2 TUI 会话
 * - ServerOptions：服务器配置选项
 * - TuiOptions：TUI 配置选项
 *
 * 使用场景：
 * - 本地开发环境
 * - 集成测试
 * - 自动化脚本
 *
 * @package sdk/js
 * @module v2/server
 */

// 导入 spawn 函数，用于启动子进程
// spawn 用于在后台启动 opencode CLI 进程
import { spawn } from "node:child_process"

// 导入配置类型定义
import { type Config } from "./gen/types.gen.js"

/**
 * 服务器配置选项类型
 *
 * 定义创建 OpenCode V2 服务器时可配置的选项。
 */
export type ServerOptions = {
  // 服务器主机名，默认为 "127.0.0.1"
  hostname?: string

  // 服务器端口，默认为 4096
  port?: number

  // 用于取消服务器启动的 AbortSignal
  signal?: AbortSignal

  // 等待服务器启动的超时时间（毫秒），默认为 5000ms
  timeout?: number

  // OpenCode V2 配置对象
  config?: Config
}

/**
 * TUI（终端用户界面）配置选项类型
 *
 * 定义创建 OpenCode V2 TUI 会话时可配置的选项。
 */
export type TuiOptions = {
  // 项目路径
  project?: string

  // 使用的模型
  model?: string

  // 会话 ID
  session?: string

  // 使用的 Agent
  agent?: string

  // 用于取消 TUI 的 AbortSignal
  signal?: AbortSignal

  // OpenCode V2 配置对象
  config?: Config
}

/**
 * 创建 OpenCode V2 服务器
 *
 * 启动一个 OpenCode V2 服务器进程，等待其启动完成，并返回服务器信息。
 *
 * @param options - 服务器配置选项
 * @returns 包含服务器 URL 和 close 方法的对象
 *          - url: 服务器的完整 URL
 *          - close(): 关闭服务器的方法
 *
 * 执行流程：
 * 1. 合并默认选项和用户选项
 * 2. 构建 opencode CLI 命令参数
 * 3. 启动 opencode 子进程
 * 4. 等待服务器输出启动消息
 * 5. 从输出中解析服务器 URL
 * 6. 返回服务器控制对象
 *
 * 使用场景：
 * - 本地开发时启动测试服务器
 * - 集成测试中启动隔离的服务器
 * - 自动化脚本
 *
 * @example
 * ```typescript
 * import { createOpencodeServer } from "@opencode-ai/sdk/v2"
 *
 * // 创建服务器
 * const server = await createOpencodeServer({
 *   hostname: "localhost",
 *   port: 4096,
 * })
 *
 * console.log("Server running at:", server.url)
 *
 * // 完成后关闭服务器
 * server.close()
 * ```
 */
export async function createOpencodeServer(options?: ServerOptions) {
  // 合并默认选项和用户选项
  // 使用 Object.assign 创建新的配置对象
  options = Object.assign(
    {
      // 默认监听本地地址
      hostname: "127.0.0.1",

      // 默认端口 4096
      port: 4096,

      // 默认超时 5 秒
      timeout: 5000,
    },
    options ?? {},
  )

  // 构建 CLI 命令参数
  // 使用 serve 子命令启动服务器
  const args = [`serve`, `--hostname=${options.hostname}`, `--port=${options.port}`]

  // 如果配置了日志级别，添加相应参数
  if (options.config?.logLevel) args.push(`--log-level=${options.config.logLevel}`)

  // 启动 opencode 子进程
  // spawn 在后台启动命令并返回进程对象
  const proc = spawn(`opencode`, args, {
    // 传递 AbortSignal，用于取消进程
    signal: options.signal,

    // 设置环境变量
    env: {
      // 保留现有环境变量
      ...process.env,

      // 通过环境变量传递配置
      // OPENCODE_CONFIG_CONTENT 包含 JSON 格式的配置
      OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config ?? {}),
    },
  })

  // 等待服务器启动并获取 URL
  // 使用 Promise 包装异步等待过程
  const url = await new Promise<string>((resolve, reject) => {
    // 设置超时定时器
    // 如果在指定时间内服务器未启动，拒绝 Promise
    const id = setTimeout(() => {
      reject(new Error(`Timeout waiting for server to start after ${options.timeout}ms`))
    }, options.timeout)

    // 用于累积服务器输出
    let output = ""

    // 监听标准输出
    proc.stdout?.on("data", (chunk) => {
      // 将输出块转换为字符串并累积
      output += chunk.toString()

      // 按行分割输出
      const lines = output.split("\n")

      // 遍历每一行查找启动消息
      for (const line of lines) {
        // 检查是否包含服务器启动消息
        if (line.startsWith("opencode server listening")) {
          // 使用正则表达式提取 URL
          // 匹配 "on <url>" 格式的 URL
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)

          // 如果没有匹配到 URL，抛出错误
          if (!match) {
            throw new Error(`Failed to parse server url from output: ${line}`)
          }

          // 清除超时定时器
          clearTimeout(id)

          // 解析成功，返回 URL
          resolve(match[1]!)
          return
        }
      }
    })

    // 监听标准错误输出
    // 错误输出也会累积，用于错误消息
    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
    })

    // 监听进程退出事件
    proc.on("exit", (code) => {
      // 清除超时定时器
      clearTimeout(id)

      // 构建错误消息
      let msg = `Server exited with code ${code}`

      // 如果有输出，添加到错误消息
      if (output.trim()) {
        msg += `\nServer output: ${output}`
      }

      // 拒绝 Promise，返回错误
      reject(new Error(msg))
    })

    // 监听进程错误事件
    proc.on("error", (error) => {
      // 清除超时定时器
      clearTimeout(id)

      // 拒绝 Promise，返回错误
      reject(error)
    })

    // 监听 AbortSignal 的 abort 事件
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        // 清除超时定时器
        clearTimeout(id)

        // 拒绝 Promise，返回中止错误
        reject(new Error("Aborted"))
      })
    }
  })

  // 返回服务器控制对象
  return {
    // 服务器 URL，用于连接客户端
    url,

    // 关闭服务器的方法
    // kill() 会终止 opencode 进程
    close() {
      proc.kill()
    },
  }
}

/**
 * 创建 OpenCode V2 TUI（终端用户界面）会话
 *
 * 启动 OpenCode V2 的交互式终端界面，用于直接在终端中使用 OpenCode。
 *
 * @param options - TUI 配置选项
 * @returns 包含 close 方法的对象，用于关闭 TUI
 *
 * 执行流程：
 * 1. 根据选项构建命令参数
 * 2. 启动 opencode 子进程（继承标准输入输出）
 * 3. 返回控制对象
 *
 * 使用场景：
 * - 在脚本中启动交互式会话
 * - 开发调试
 *
 * @example
 * ```typescript
 * import { createOpencodeTui } from "@opencode-ai/sdk/v2"
 *
 * // 创建 TUI 会话
 * const tui = createOpencodeTui({
 *   project: "/path/to/project",
 *   model: "gpt-4",
 * })
 *
 * // 稍后关闭（通常由用户手动退出）
 * tui.close()
 * ```
 */
export function createOpencodeTui(options?: TuiOptions) {
  // 命令参数数组
  const args = []

  // 如果指定了项目路径，添加参数
  if (options?.project) {
    args.push(`--project=${options.project}`)
  }

  // 如果指定了模型，添加参数
  if (options?.model) {
    args.push(`--model=${options.model}`)
  }

  // 如果指定了会话 ID，添加参数
  if (options?.session) {
    args.push(`--session=${options.session}`)
  }

  // 如果指定了 Agent，添加参数
  if (options?.agent) {
    args.push(`--agent=${options.agent}`)
  }

  // 启动 opencode TUI 进程
  const proc = spawn(`opencode`, args, {
    // 传递 AbortSignal
    signal: options?.signal,

    // 继承标准输入输出
    // 这使 TUI 可以直接与用户终端交互
    stdio: "inherit",

    // 设置环境变量
    env: {
      // 保留现有环境变量
      ...process.env,

      // 通过环境变量传递配置
      OPENCODE_CONFIG_CONTENT: JSON.stringify(options?.config ?? {}),
    },
  })

  // 返回 TUI 控制对象
  return {
    // 关闭 TUI 的方法
    close() {
      proc.kill()
    },
  }
}

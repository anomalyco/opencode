/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/plugin/src
 * ============================================================================
 *
 * 文件作用：
 * OpenCode 插件系统的核心类型定义和接口。
 * 定义了插件系统的所有类型，包括插件输入、输出、钩子和认证机制。
 *
 * 主要功能：
 * - 定义插件系统类型
 * - 提供钩子（Hooks）接口
 * - 定义认证提供者接口
 * - 定义工具（Tool）扩展接口
 *
 * 依赖关系：
 * - @opencode-ai/sdk：OpenCode SDK 核心类型
 * - ./shell：Shell 类型定义
 * - ./tool：工具类型定义
 *
 * 导出内容：
 * - Plugin：插件函数类型
 * - PluginInput：插件输入类型
 * - Hooks：钩子接口
 * - AuthHook：认证钩子类型
 * - 各种工具类型
 *
 * 使用场景：
 * - 创建 OpenCode 插件
 * - 扩展 OpenCode 功能
 * - 集成第三方服务
 *
 * @package plugin
 * @module index
 */

// 从 OpenCode SDK 导入核心类型
// 这些类型用于定义插件的输入输出
import type {
  Event,           // 服务器事件类型
  createOpencodeClient,  // 客户端创建函数类型
  Project,         // 项目信息类型
  Model,           // 模型信息类型
  Provider,        // 提供商信息类型
  Permission,      // 权限类型
  UserMessage,     // 用户消息类型
  Message,         // 消息类型
  Part,            // 消息部分类型
  Auth,            // 认证信息类型
  Config,          // 配置类型
} from "@opencode-ai/sdk"

// 导入 Shell 类型
import type { BunShell } from "./shell"

// 导入工具类型定义
import { type ToolDefinition } from "./tool"

// 重新导出工具模块的所有内容
// 这使得插件开发者可以从这个入口导入工具相关类型
export * from "./tool"

/**
 * 提供者上下文类型
 *
 * 包含 AI 提供商的配置信息和来源。
 */
export type ProviderContext = {
  // 提供商配置的来源
  // - "env": 从环境变量读取
  // - "config": 从配置文件读取
  // - "custom": 用户自定义配置
  // - "api": 从 API 获取
  source: "env" | "config" | "custom" | "api"

  // 提供商信息（ID、名称等）
  info: Provider

  // 提供商配置选项
  options: Record<string, any>
}

/**
 * 插件输入类型
 *
 * 定义插件函数接收的输入参数，包含所有必要的上下文信息。
 */
export type PluginInput = {
  // OpenCode 客户端实例
  // 用于调用 OpenCode API
  client: ReturnType<typeof createOpencodeClient>

  // 项目信息
  // 包含项目路径、ID 等
  project: Project

  // 项目目录的绝对路径
  directory: string

  // Git worktree 路径
  // 用于支持 Git worktree 功能
  worktree: string

  // 服务器 URL
  // OpenCode 服务器的完整地址
  serverUrl: URL

  // Shell 命令执行接口
  // 用于在插件中执行 shell 命令
  $: BunShell
}

/**
 * 插件函数类型
 *
 * 插件是一个异步函数，接收插件输入，返回钩子配置对象。
 *
 * @param input - 插件输入，包含客户端、项目信息等
 * @returns 钩子配置对象，定义插件响应的各种事件
 *
 * 插件生命周期：
 * 1. 插件被加载
 * 2. 调用插件函数，传入输入参数
 * 3. 插件返回钩子配置
 * 4. OpenCode 在相应事件发生时调用钩子
 */
export type Plugin = (input: PluginInput) => Promise<Hooks>

/**
 * 认证钩子类型
 *
 * 定义插件如何为 AI 提供商添加认证支持。
 */
export type AuthHook = {
  // 提供商标识（如 "openai", "anthropic" 等）
  provider: string

  // 可选的认证加载器
  // 用于自定义认证信息的加载和处理
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>

  // 认证方法数组
  // 支持多种认证方式（OAuth、API Key 等）
  methods: (
    // OAuth 认证方法
    | {
        // 方法类型标识
        type: "oauth"

        // 方法显示名称
        label: string

        // 可选的用户输入提示
        prompts?: Array<
          // 文本输入提示
          | {
              // 提示类型
              type: "text"

              // 输入的键名
              key: string

              // 提示消息
              message: string

              // 占位符文本
              placeholder?: string

              // 验证函数，返回错误消息或 undefined 表示通过
              validate?: (value: string) => string | undefined

              // 条件函数，决定是否显示此提示
              condition?: (inputs: Record<string, string>) => boolean
            }
          // 下拉选择提示
          | {
              // 提示类型
              type: "select"

              // 输入的键名
              key: string

              // 提示消息
              message: string

              // 可选项列表
              options: Array<{
                label: string    // 显示文本
                value: string   // 选项值
                hint?: string   // 提示文本
              }>

              // 条件函数，决定是否显示此提示
              condition?: (inputs: Record<string, string>) => boolean
            }
        >

        // 授权函数
        authorize(inputs?: Record<string, string>): Promise<AuthOuathResult>
      }

    // API 认证方法
    | {
        // 方法类型标识
        type: "api"

        // 方法显示名称
        label: string

        // 可选的用户输入提示
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >

        // 可选的授权函数
        authorize?(inputs?: Record<string, string>): Promise<
          // 成功响应
          | {
              type: "success"
              key: string         // API key
              provider?: string   // 提供商 ID
            }
          // 失败响应
          | {
              type: "failed"
            }
        >
      }
  )[]
}

/**
 * OAuth 授权结果类型
 *
 * 定义 OAuth 认证流程的返回值。
 */
export type AuthOuathResult = { url: string; instructions: string } & (
  // 自动授权方法
  | {
      // 方法标识
      method: "auto"

      // 回调函数，完成 OAuth 流程
      callback(): Promise<
        // 成功响应
        | ({
            type: "success"
            provider?: string   // 提供商 ID
          } & (
            // 返回访问令牌和刷新令牌
            | {
                refresh: string     // 刷新令牌
                access: string      // 访问令牌
                expires: number     // 过期时间戳
                accountId?: string  // 账户 ID
              }
            // 返回 API key
            | { key: string }
          ))
        // 失败响应
        | {
            type: "failed"
          }
      >
    }

    // 授权码方法
    | {
      // 方法标识
      method: "code"

      // 回调函数，处理用户输入的授权码
      callback(code: string): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
)

/**
 * 钩子接口
 *
 * 定义插件可以响应的各种事件钩子。
 */
export interface Hooks {
  /**
   * 服务器事件钩子
   *
   * 当服务器事件发生时调用。
   *
   * @param input.event - 服务器事件对象
   */
  event?: (input: { event: Event }) => Promise<void>

  /**
   * 配置钩子
   *
   * 当配置更改时调用。
   *
   * @param input - 配置对象
   */
  config?: (input: Config) => Promise<void>

  /**
   * 工具钩子
   *
   * 定义插件提供的自定义工具。
   * 键是工具名称，值是工具定义。
   */
  tool?: {
    [key: string]: ToolDefinition
  }

  /**
   * 认证钩子
   *
   * 定义插件如何为 AI 提供商添加认证支持。
   */
  auth?: AuthHook

  /**
   * 聊天消息钩子
   *
   * 当接收到新消息时调用。
   *
   * @param input.sessionID - 会话 ID
   * @param input.agent - Agent 标识
   * @param input.model - 使用的模型信息
   * @param input.messageID - 消息 ID
   * @param input.variant - 消息变体
   * @param output.message - 用户消息对象
   * @param output.parts - 消息部分数组
   */
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>

  /**
   * 聊天参数钩子
   *
   * 修改发送给 LLM 的参数。
   *
   * @param input.sessionID - 会话 ID
   * @param input.agent - Agent 标识
   * @param input.model - 使用的模型
   * @param input.provider - 提供商上下文
   * @param input.message - 用户消息
   * @param output.temperature - 温度参数
   * @param output.topP - Top-P 参数
   * @param output.topK - Top-K 参数
   * @param output.options - 其他选项
   */
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>

  /**
   * 权限询问钩子
   *
   * 当需要请求权限时调用。
   *
   * @param input - 权限请求对象
   * @param output.status - 权限状态（"ask" | "deny" | "allow"）
   */
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>

  /**
   * 工具执行前钩子
   *
   * 在工具执行前调用，可以修改工具参数。
   *
   * @param input.tool - 工具名称
   * @param input.sessionID - 会话 ID
   * @param input.callID - 调用 ID
   * @param output.args - 工具参数
   */
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>

  /**
   * 工具执行后钩子
   *
   * 在工具执行后调用，可以处理工具输出。
   *
   * @param input.tool - 工具名称
   * @param input.sessionID - 会话 ID
   * @param input.callID - 调用 ID
   * @param output.title - 输出标题
   * @param output.output - 输出内容
   * @param output.metadata - 元数据
   */
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void>

  /**
   * 消息转换钩子（实验性）
   *
   * 允许插件在发送给 LLM 之前转换消息。
   *
   * @param output.messages - 消息数组
   */
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message
        parts: Part[]
      }[]
    },
  ) => Promise<void>

  /**
   * 系统消息转换钩子（实验性）
   *
   * 允许插件修改系统消息。
   *
   * @param input.sessionID - 会话 ID
   * @param output.system - 系统消息数组
   */
  "experimental.chat.system.transform"?: (
    input: { sessionID: string },
    output: {
      system: string[]
    },
  ) => Promise<void>

  /**
   * 会话压缩钩子（实验性）
   *
   * 在会话压缩开始前调用。
   * 允许插件自定义压缩提示词。
   *
   * - context: 附加到默认提示词的上下文字符串
   * - prompt: 如果设置，完全替换默认压缩提示词
   *
   * @param input.sessionID - 会话 ID
   * @param output.context - 附加上下文
   * @param output.prompt - 自定义提示词（可选）
   */
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>

  /**
   * 文本补全钩子（实验性）
   *
   * 在文本补全时调用。
   *
   * @param input.sessionID - 会话 ID
   * @param input.messageID - 消息 ID
   * @param input.partID - 部分 ID
   * @param output.text - 补全的文本
   */
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
}

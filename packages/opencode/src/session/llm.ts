/**
 * ============================================================================
 * 文件名：llm.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * LLM（大语言模型）流式输出模块。使用 Vercel AI SDK 实现 LLM 文本流式输出，
 * 处理系统提示词、工具调用、权限过滤和提供商转换。
 *
 * 主要功能：
 * - StreamInput/StreamOutput：流式输入输出类型定义
 * - stream(input)：执行 LLM 文本流式输出
 * - resolveTools(input)：根据权限过滤可用工具
 *
 * 依赖关系：
 * - os：Node.js 操作系统模块，用于获取平台信息
 * - ../installation：安装信息和版本号
 * - ../provider/provider：提供商和模型管理
 * - ../util/log：日志记录
 * - ai：Vercel AI SDK（streamText, wrapLanguageModel, extractReasoningMiddleware）
 * - remeda：工具函数（clone, mergeDeep, pipe）
 * - ../provider/transform：提供商转换工具
 * - ../config/config：配置系统
 * - ../project/instance：实例管理
 * - ../agent/agent：Agent 管理
 * - ./message-v2：消息模型
 * - ../plugin：插件系统
 * - ./system：系统提示词
 * - ../flag/flag：功能标志
 * - ../permission/next：权限管理
 * - ../auth：认证管理
 *
 * 导出内容：
 * - LLM namespace：LLM 流式输出命名空间
 *   - OUTPUT_TOKEN_MAX：最大输出 token 数
 *   - StreamInput：流式输入类型
 *   - StreamOutput：流式输出类型
 *   - stream()：执行流式输出
 *   - resolveTools()：解析工具权限
 *
 * 使用示例：
 * ```typescript
 * const result = await LLM.stream({
 *   user: userMessage,
 *   sessionID: "session-123",
 *   model: model,
 *   agent: agent,
 *   system: ["额外指令"],
 *   abort: signal,
 *   messages: history,
 *   tools: availableTools,
 * })
 *
 * for await (const chunk of result.textStream) {
 *   process.stdout.write(chunk)
 * }
 * ```
 *
 * @package opencode
 * @module session/llm
 */

// 导入 Node.js 操作系统模块，用于获取平台和架构信息
import os from "os"

// 导入安装信息，用于获取版本号
import { Installation } from "@/installation"

// 导入提供商管理模块
import { Provider } from "@/provider/provider"

// 导入日志工具
import { Log } from "@/util/log"

// 导入 Vercel AI SDK
import {
  streamText,                    // 流式文本输出核心函数
  wrapLanguageModel,             // 包装语言模型，添加中间件
  type ModelMessage,              // AI SDK 消息类型
  type StreamTextResult,          // 流式输出结果类型
  type Tool,                      // 工具定义类型
  type ToolSet,                   // 工具集合类型
  extractReasoningMiddleware,    // 推理提取中间件
} from "ai"

// 导入 remeda 工具函数
import { clone, mergeDeep, pipe } from "remeda"

// 导入提供商转换工具
import { ProviderTransform } from "@/provider/transform"

// 导入配置系统
import { Config } from "@/config/config"

// 导入实例管理
import { Instance } from "@/project/instance"

// 导入 Agent 类型
import type { Agent } from "@/agent/agent"

// 导入消息模型
import type { MessageV2 } from "./message-v2"

// 导入插件系统
import { Plugin } from "@/plugin"

// 导入系统提示词
import { SystemPrompt } from "./system"

// 导入功能标志
import { Flag } from "@/flag/flag"

// 导入权限管理
import { PermissionNext } from "@/permission/next"

// 导入认证管理
import { Auth } from "@/auth"

/**
 * LLM 流式输出命名空间
 *
 * 处理与大语言模型的交互，包括流式输出、工具调用和权限管理。
 */
export namespace LLM {
  // 创建日志记录器
  const log = Log.create({ service: "llm" })

  /**
   * 最大输出 token 数
   *
   * 可通过环境变量 OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX 覆盖。
   * 默认值为 32,000 tokens。
   */
  export const OUTPUT_TOKEN_MAX = Flag.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  /**
   * 流式输出输入参数
   *
   * 调用 LLM 流式输出所需的所有参数。
   */
  export type StreamInput = {
    // 用户消息
    user: MessageV2.User
    // 会话 ID，用于日志和跟踪
    sessionID: string
    // 要使用的模型
    model: Provider.Model
    // 要使用的 Agent
    agent: Agent.Info
    // 额外的系统提示词
    system: string[]
    // 中止信号，用于取消请求
    abort: AbortSignal
    // 历史消息列表
    messages: ModelMessage[]
    // 是否使用"小模型"配置（更少的 token、更低的成本）
    small?: boolean
    // 可用工具集合
    tools: Record<string, Tool>
    // 最大重试次数
    retries?: number
  }

  /**
   * 流式输出结果
   *
   * streamText 函数的返回类型。
   */
  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  /**
   * 执行 LLM 文本流式输出
   *
   * 这是与 LLM 交互的核心函数。它处理：
   * - 系统提示词构建和转换
   * - 提供商选项合并
   * - 工具权限过滤
   * - 特殊提供商处理（如 Codex）
   * - 错误处理和工具调用修复
   *
   * @param input - 流式输出参数
   * @returns Promise，解析为流式输出结果
   *
   * 处理流程：
   * 1. 创建带标签的日志记录器
   * 2. 获取模型语言和配置
   * 3. 构建系统提示词（插件可转换）
   * 4. 合并提供商选项
   * 5. 触发插件钩子
   * 6. 过滤可用工具
   * 7. 调用 streamText 启动流式输出
   */
  export async function stream(input: StreamInput) {
    // 创建克隆的日志记录器并添加标签
    // 标签用于在日志中识别特定请求
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)

    // 记录流式输出开始
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })

    // 并行获取模型语言和配置
    const [language, cfg] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get()
    ])

    // 构建系统提示词
    // 首先添加提供商特定的头部（如 Claude 的 XML 标签）
    const system = SystemPrompt.header(input.model.providerID)

    // 添加提示词主体
    system.push(
      [
        // 优先使用 Agent 自定义提示词，否则使用提供商默认提示词
        ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
        // 本次调用传入的额外系统提示词
        ...input.system,
        // 用户消息中的系统提示词
        ...(input.user.system ? [input.user.system] : []),
      ]
        // 过滤掉空值
        .filter((x) => x)
        // 合并为单个字符串
        .join("\n"),
    )

    // 保存原始系统提示词的头部，用于后续比较
    const header = system[0]

    // 克隆原始系统提示词，以便插件转换失败时恢复
    const original = clone(system)

    // 触发插件钩子，允许插件转换系统提示词
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID },
      { system }
    )

    // 如果插件清空了系统提示词，恢复原始内容
    if (system.length === 0) {
      system.push(...original)
    }

    // 重新合并以保持两部分结构（头部 + 主体）
    // 这样可以在头部不变时利用缓存
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    // 获取提供商和认证信息
    const provider = await Provider.getProvider(input.model.providerID)
    const auth = await Auth.get(input.model.providerID)

    // 检查是否为 Codex（OpenAI OAuth 认证）
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    // 选择模型变体（如果存在且用户指定了）
    const variant =
      !input.small && input.model.variants && input.user.variant
        ? input.model.variants[input.user.variant]
        : {}

    // 构建基础选项
    // 小模型使用简化配置，普通模型使用完整配置
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options(input.model, input.sessionID, provider.options)

    // 合并所有选项（基础 -> 模型 -> Agent -> 变体）
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )

    // Codex 特殊处理
    if (isCodex) {
      // 添加指令格式
      options.instructions = SystemPrompt.instructions()
      // 禁用数据存储
      options.store = false
    }

    // 触发插件钩子，允许插件修改生成参数
    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider: Provider.getProvider(input.model.providerID),
        message: input.user,
      },
      {
        // 温度参数（如果模型支持）
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        // Top P 采样参数
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        // Top K 采样参数
        topK: ProviderTransform.topK(input.model),
        // 合并后的选项
        options,
      },
    )

    // 计算最大输出 token 数
    // Codex 不限制，其他模型根据配置限制
    const maxOutputTokens = isCodex
      ? undefined
      : ProviderTransform.maxOutputTokens(
          input.model.api.npm,
          params.options,
          input.model.limit.output,
          OUTPUT_TOKEN_MAX,
        )

    // 解析并过滤可用工具（根据权限）
    const tools = await resolveTools(input)

    // 启动流式文本输出
    return streamText({
      // 错误处理回调
      onError(error) {
        l.error("stream error", { error })
      },

      // 工具调用修复
      // 当工具名称大小写不匹配时，尝试修复
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()

        // 如果小写版本存在，使用小写版本
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }

        // 无法修复，返回 invalid 工具调用
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },

      // 生成参数
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,

      // 提供商特定选项
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),

      // 活跃工具列表（排除 invalid）
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,

      // 最大输出 token 数
      maxOutputTokens,

      // 中止信号
      abortSignal: input.abort,

      // HTTP 头部
      headers: {
        // Codex 特定头部
        ...(isCodex
          ? {
              // 标识来源
              originator: "opencode",
              // 用户代理（包含版本和平台信息）
              "User-Agent": `opencode/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
              // 会话 ID
              session_id: input.sessionID,
            }
          : undefined),

        // OpenCode 提供商特定头部
        ...(input.model.providerID.startsWith("opencode")
          ? {
              // 项目 ID
              "x-opencode-project": Instance.project.id,
              // 会话 ID
              "x-opencode-session": input.sessionID,
              // 请求 ID
              "x-opencode-request": input.user.id,
              // 客户端标识
              "x-opencode-client": Flag.OPENCODE_CLIENT,
            }
          : undefined),

        // 模型自定义头部
        ...input.model.headers,
      },

      // 最大重试次数
      maxRetries: input.retries ?? 0,

      // 消息列表
      messages: [
        // Codex 使用用户消息格式
        ...(isCodex
          ? [
              {
                role: "user",
                content: system.join("\n\n"),
              } as ModelMessage,
            ]
          : system.map(
              (x): ModelMessage => ({
                role: "system",
                content: x,
              }),
            )),
        // 历史消息
        ...input.messages,
      ],

      // 语言模型包装器
      // 添加中间件处理消息格式和推理提取
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            // 转换参数中间件
            async transformParams(args) {
              // 流式请求时转换消息格式
              if (args.type === "stream") {
                // @ts-expect-error 类型定义不完整
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model)
              }
              return args.params
            },
          },
          // 推理提取中间件
          // 提取 <think> 标签中的推理内容
          extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
        ],
      }),

      // 实验性遥测
      experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
    })
  }

  /**
   * 解析工具权限
   *
   * 根据 Agent 权限和用户配置过滤可用工具。
   * 被禁用或拒绝的工具将从工具集中移除。
   *
   * @param input - 工具解析参数
   *   - tools：可用工具集合
   *   - agent：Agent 信息（包含权限）
   *   - user：用户消息（包含工具禁用配置）
   * @returns Promise，解析为过滤后的工具集合
   *
   * 过滤规则：
   * 1. 用户明确禁用的工具（user.tools[tool] === false）
   * 2. Agent 权限拒绝的工具
   */
  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    // 获取被权限禁用的工具集合
    const disabled = PermissionNext.disabled(
      Object.keys(input.tools),
      input.agent.permission
    )

    // 遍历所有工具，移除被禁用的
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }

    return input.tools
  }
}

/**
 * ============================================================================
 * 文件名：message-v2.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 消息模型定义模块 v2。定义会话中消息和部分的数据结构。
 *
 * 主要功能：
 * - 各种 Part Schema：消息部分类型定义
 * - User/Assistant Schema：用户/助手消息结构
 * - Info Schema：消息联合类型
 * - Event：消息相关事件
 * - toModelMessage()：转换为 AI SDK 消息格式
 * - stream()：流式读取会话消息
 * - parts()：获取消息的所有部分
 * - get()：获取指定消息
 * - filterCompacted()：过滤压缩后的消息
 * - fromError()：将错误转换为消息错误格式
 *
 * 依赖关系：
 * - ../bus/bus-event：事件定义工具
 * - zod：运行时类型验证
 * - @opencode-ai/util/error：命名错误
 * - ai：Vercel AI SDK（错误类型、消息转换）
 * - ../id/id：标识符生成
 * - ../lsp：LSP 类型定义
 * - ../snapshot：快照管理
 * - ../util/fn：函数包装工具
 * - ../storage/storage：存储层
 * - ../provider/transform：提供商转换
 * - http：HTTP 状态码
 * - ../util/iife：立即执行函数表达式工具
 *
 * 导出内容：
 * - MessageV2 namespace：消息模型命名空间
 *   - OutputLengthError：输出长度错误
 *   - AbortedError：中止错误
 *   - AuthError：认证错误
 *   - APIError：API 错误
 *   - Part Schema：消息部分联合类型
 *   - Info Schema：消息信息
 *   - WithParts Schema：带部分的消息
 *   - Event：消息事件集合
 *   - toModelMessage()：转换为模型消息
 *   - stream()：流式读取
 *   - parts()：获取部分
 *   - get()：获取消息
 *   - filterCompacted()：过滤压缩消息
 *   - fromError()：错误转换
 *
 * 消息部分类型：
 * - TextPart：文本内容
 * - ReasoningPart：推理内容
 * - FilePart：文件附件
 * - ToolPart：工具调用
 * - SnapshotPart：快照
 * - PatchPart：补丁
 * - AgentPart：Agent 调用
 * - RetryPart：重试
 * - CompactionPart：压缩
 * - SubtaskPart：子任务
 * - StepStartPart/StepFinishPart：步骤开始/结束
 *
 * 消息角色：
 * - user：用户消息
 * - assistant：助手消息
 *
 * 工具状态：
 * - pending：等待中
 * - running：运行中
 * - completed：已完成
 * - error：错误
 *
 * 使用示例：
 * ```typescript
 * // 获取消息
 * const message = await MessageV2.get({ sessionID, messageID })
 *
 * // 转换为 AI SDK 格式
 * const modelMessages = MessageV2.toModelMessage(messages)
 *
 * // 错误处理
 * const error = MessageV2.fromError(e, { providerID: "openai" })
 * ```
 *
 * @package opencode
 * @module session/message-v2
 */

// 导入事件定义工具
import { BusEvent } from "@/bus/bus-event"

// 导入 Zod 用于类型验证
import z from "zod"

// 导入命名错误工具
import { NamedError } from "@opencode-ai/util/error"

// 导入 AI SDK 类型
import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"

// 导入标识符生成
import { Identifier } from "../id/id"

// 导入 LSP 类型
import { LSP } from "../lsp"

// 导入快照管理
import { Snapshot } from "@/snapshot"

// 导入函数包装工具
import { fn } from "@/util/fn"

// 导入存储层
import { Storage } from "@/storage/storage"

// 导入提供商转换工具
import { ProviderTransform } from "@/provider/transform"

// 导入 HTTP 状态码
import { STATUS_CODES } from "http"

// 导入 IIFE 工具
import { iife } from "@/util/iife"

/**
 * 消息模型命名空间 v2
 *
 * 定义消息和部分的数据结构。
 */
export namespace MessageV2 {
  /**
   * 输出长度错误
   *
   * 当模型输出超过最大长度时抛出。
   */
  export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))

  /**
   * 中止错误
   *
   * 当请求被中止时抛出。
   */
  export const AbortedError = NamedError.create("MessageAbortedError", z.object({ message: z.string() }))

  /**
   * 认证错误
   *
   * 当 API Key 认证失败时抛出。
   */
  export const AuthError = NamedError.create(
    "ProviderAuthError",
    z.object({
      providerID: z.string(),
      message: z.string(),
    }),
  )

  /**
   * API 错误
   *
   * 封装 API 调用错误信息。
   */
  export const APIError = NamedError.create(
    "APIError",
    z.object({
      message: z.string(),
      statusCode: z.number().optional(),
      isRetryable: z.boolean(),
      responseHeaders: z.record(z.string(), z.string()).optional(),
      responseBody: z.string().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    }),
  )
  export type APIError = z.infer<typeof APIError.Schema>

  // 消息部分的基础字段
  const PartBase = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
  })

  /**
   * 快照部分
   *
   * 存储文件系统快照。
   */
  export const SnapshotPart = PartBase.extend({
    type: z.literal("snapshot"),
    snapshot: z.string(),
  }).meta({
    ref: "SnapshotPart",
  })
  export type SnapshotPart = z.infer<typeof SnapshotPart>

  /**
   * 补丁部分
   *
   * 存储文件补丁信息。
   */
  export const PatchPart = PartBase.extend({
    type: z.literal("patch"),
    hash: z.string(),
    files: z.string().array(),
  }).meta({
    ref: "PatchPart",
  })
  export type PatchPart = z.infer<typeof PatchPart>

  /**
   * 文本部分
   *
   * 存储文本内容和时间信息。
   */
  export const TextPart = PartBase.extend({
    type: z.literal("text"),
    text: z.string(),
    // 是否为合成内容（非 AI 生成）
    synthetic: z.boolean().optional(),
    // 是否被忽略（不发送给 AI）
    ignored: z.boolean().optional(),
    // 生成时间
    time: z
      .object({
        start: z.number(),
        end: z.number().optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: "TextPart",
  })
  export type TextPart = z.infer<typeof TextPart>

  /**
   * 推理部分
   *
   * 存储模型的推理内容。
   */
  export const ReasoningPart = PartBase.extend({
    type: z.literal("reasoning"),
    text: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number().optional(),
    }),
  }).meta({
    ref: "ReasoningPart",
  })
  export type ReasoningPart = z.infer<typeof ReasoningPart>

  // 文件部分来源的基础字段
  const FilePartSourceBase = z.object({
    text: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .meta({
        ref: "FilePartSourceText",
      }),
  })

  /**
   * 文件来源
   *
   * 文件来源于文件路径。
   */
  export const FileSource = FilePartSourceBase.extend({
    type: z.literal("file"),
    path: z.string(),
  }).meta({
    ref: "FileSource",
  })

  /**
   * 符号来源
   *
   * 文件来源于代码符号（LSP）。
   */
  export const SymbolSource = FilePartSourceBase.extend({
    type: z.literal("symbol"),
    path: z.string(),
    range: LSP.Range,
    name: z.string(),
    kind: z.number().int(),
  }).meta({
    ref: "SymbolSource",
  })

  /**
   * 资源来源
   *
   * 文件来源于 LSP 资源。
   */
  export const ResourceSource = FilePartSourceBase.extend({
    type: z.literal("resource"),
    clientName: z.string(),
    uri: z.string(),
  }).meta({
    ref: "ResourceSource",
  })

  /**
   * 文件部分来源联合类型
   *
   * 可以是文件、符号或资源。
   */
  export const FilePartSource = z.discriminatedUnion("type", [FileSource, SymbolSource, ResourceSource]).meta({
    ref: "FilePartSource",
  })

  /**
   * 文件部分
   *
   * 表示文件附件。
   */
  export const FilePart = PartBase.extend({
    type: z.literal("file"),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(),
    source: FilePartSource.optional(),
  }).meta({
    ref: "FilePart",
  })
  export type FilePart = z.infer<typeof FilePart>

  /**
   * Agent 部分
   *
   * 表示子 Agent 调用。
   */
  export const AgentPart = PartBase.extend({
    type: z.literal("agent"),
    name: z.string(),
    source: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .optional(),
  }).meta({
    ref: "AgentPart",
  })
  export type AgentPart = z.infer<typeof AgentPart>

  /**
   * 压缩部分
   *
   * 标记会话压缩操作。
   */
  export const CompactionPart = PartBase.extend({
    type: z.literal("compaction"),
    auto: z.boolean(),
  }).meta({
    ref: "CompactionPart",
  })
  export type CompactionPart = z.infer<typeof CompactionPart>

  /**
   * 子任务部分
   *
   * 表示子任务执行。
   */
  export const SubtaskPart = PartBase.extend({
    type: z.literal("subtask"),
    prompt: z.string(),
    description: z.string(),
    agent: z.string(),
    command: z.string().optional(),
  })
  export type SubtaskPart = z.infer<typeof SubtaskPart>

  /**
   * 重试部分
   *
   * 记录重试尝试。
   */
  export const RetryPart = PartBase.extend({
    type: z.literal("retry"),
    attempt: z.number(),
    error: APIError.Schema,
    time: z.object({
      created: z.number(),
    }),
  }).meta({
    ref: "RetryPart",
  })
  export type RetryPart = z.infer<typeof RetryPart>

  /**
   * 步骤开始部分
   *
   * 标记一个执行步骤的开始。
   */
  export const StepStartPart = PartBase.extend({
    type: z.literal("step-start"),
    snapshot: z.string().optional(),
  }).meta({
    ref: "StepStartPart",
  })
  export type StepStartPart = z.infer<typeof StepStartPart>

  /**
   * 步骤结束部分
   *
   * 标记一个执行步骤的结束。
   */
  export const StepFinishPart = PartBase.extend({
    type: z.literal("step-finish"),
    reason: z.string(),
    snapshot: z.string().optional(),
    cost: z.number(),
    tokens: z.object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    }),
  }).meta({
    ref: "StepFinishPart",
  })
  export type StepFinishPart = z.infer<typeof StepFinishPart>

  /**
   * 工具状态：等待中
   */
  export const ToolStatePending = z
    .object({
      status: z.literal("pending"),
      input: z.record(z.string(), z.any()),
      raw: z.string(),
    })
    .meta({
      ref: "ToolStatePending",
    })

  export type ToolStatePending = z.infer<typeof ToolStatePending>

  /**
   * 工具状态：运行中
   */
  export const ToolStateRunning = z
    .object({
      status: z.literal("running"),
      input: z.record(z.string(), z.any()),
      title: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
      }),
    })
    .meta({
      ref: "ToolStateRunning",
    })
  export type ToolStateRunning = z.infer<typeof ToolStateRunning>

  /**
   * 工具状态：已完成
   */
  export const ToolStateCompleted = z
    .object({
      status: z.literal("completed"),
      input: z.record(z.string(), z.any()),
      output: z.string(),
      title: z.string(),
      metadata: z.record(z.string(), z.any()),
      time: z.object({
        start: z.number(),
        end: z.number(),
        compacted: z.number().optional(),
      }),
      attachments: FilePart.array().optional(),
    })
    .meta({
      ref: "ToolStateCompleted",
    })
  export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>

  /**
   * 工具状态：错误
   */
  export const ToolStateError = z
    .object({
      status: z.literal("error"),
      input: z.record(z.string(), z.any()),
      error: z.string(),
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
        end: z.number(),
      }),
    })
    .meta({
      ref: "ToolStateError",
    })
  export type ToolStateError = z.infer<typeof ToolStateError>

  /**
   * 工具状态联合类型
   *
   * 可以是等待中、运行中、已完成或错误。
   */
  export const ToolState = z
    .discriminatedUnion("status", [ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])
    .meta({
      ref: "ToolState",
    })

  /**
   * 工具部分
   *
   * 表示工具调用及其状态。
   */
  export const ToolPart = PartBase.extend({
    type: z.literal("tool"),
    callID: z.string(),
    tool: z.string(),
    state: ToolState,
    metadata: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: "ToolPart",
  })
  export type ToolPart = z.infer<typeof ToolPart>

  // 消息的基础字段
  const Base = z.object({
    id: z.string(),
    sessionID: z.string(),
  })

  /**
   * 用户消息
   *
   * 用户发送的消息及其配置。
   */
  export const User = Base.extend({
    role: z.literal("user"),
    time: z.object({
      created: z.number(),
    }),
    summary: z
      .object({
        title: z.string().optional(),
        body: z.string().optional(),
        diffs: Snapshot.FileDiff.array(),
      })
      .optional(),
    agent: z.string(),
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
    system: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    variant: z.string().optional(),
  }).meta({
    ref: "UserMessage",
  })
  export type User = z.infer<typeof User>

  /**
   * 消息部分联合类型
   *
   * 所有可能的消息部分类型。
   */
  export const Part = z
    .discriminatedUnion("type", [
      TextPart,
      SubtaskPart,
      ReasoningPart,
      FilePart,
      ToolPart,
      StepStartPart,
      StepFinishPart,
      SnapshotPart,
      PatchPart,
      AgentPart,
      RetryPart,
      CompactionPart,
    ])
    .meta({
      ref: "Part",
    })
  export type Part = z.infer<typeof Part>

  /**
   * 助手消息
   *
   * AI 助手返回的消息。
   */
  export const Assistant = Base.extend({
    role: z.literal("assistant"),
    time: z.object({
      created: z.number(),
      completed: z.number().optional(),
    }),
    error: z
      .discriminatedUnion("name", [
        AuthError.Schema,
        NamedError.Unknown.Schema,
        OutputLengthError.Schema,
        AbortedError.Schema,
        APIError.Schema,
      ])
      .optional(),
    parentID: z.string(),
    modelID: z.string(),
    providerID: z.string(),
    /**
     * @deprecated
     */
    mode: z.string(),
    agent: z.string(),
    path: z.object({
      cwd: z.string(),
      root: z.string(),
    }),
    summary: z.boolean().optional(),
    cost: z.number(),
    tokens: z.object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    }),
    finish: z.string().optional(),
  }).meta({
    ref: "AssistantMessage",
  })
  export type Assistant = z.infer<typeof Assistant>

  /**
   * 消息信息联合类型
   *
   * 可以是用户消息或助手消息。
   */
  export const Info = z.discriminatedUnion("role", [User, Assistant]).meta({
    ref: "Message",
  })
  export type Info = z.infer<typeof Info>

  /**
   * 消息事件定义
   *
   * 定义消息相关的所有事件类型。
   */
  export const Event = {
    // 消息更新事件
    Updated: BusEvent.define(
      "message.updated",
      z.object({
        info: Info,
      }),
    ),
    // 消息移除事件
    Removed: BusEvent.define(
      "message.removed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
      }),
    ),
    // 消息部分更新事件
    PartUpdated: BusEvent.define(
      "message.part.updated",
      z.object({
        part: Part,
        delta: z.string().optional(),
      }),
    ),
    // 消息部分移除事件
    PartRemoved: BusEvent.define(
      "message.part.removed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        partID: z.string(),
      }),
    ),
  }

  /**
   * 带部分的消息
   *
   * 包含消息信息和所有部分的完整消息。
   */
  export const WithParts = z.object({
    info: Info,
    parts: z.array(Part),
  })
  export type WithParts = z.infer<typeof WithParts>

  /**
   * 转换为 AI SDK 消息格式
   *
   * 将内部消息格式转换为 Vercel AI SDK 可用的格式。
   *
   * @param input - 内部消息列表
   * @returns AI SDK 消息列表
   *
   * 转换规则：
   * - 忽略空的文本部分
   * - 跳过纯文本和目录文件
   * - 工具返回附件时插入用户消息
   * - 过滤掉 step-start 部分
   * - 错误消息只在没有其他内容时显示
   */
  export function toModelMessage(input: WithParts[]): ModelMessage[] {
    const result: UIMessage[] = []

    for (const msg of input) {
      // 跳过没有部分的消息
      if (msg.parts.length === 0) continue

      // 处理用户消息
      if (msg.info.role === "user") {
        const userMessage: UIMessage = {
          id: msg.info.id,
          role: "user",
          parts: [],
        }
        result.push(userMessage)
        for (const part of msg.parts) {
          // 添加未被忽略的文本部分
          if (part.type === "text" && !part.ignored)
            userMessage.parts.push({
              type: "text",
              text: part.text,
            })
          // 跳过 text/plain 和目录文件
          if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory")
            userMessage.parts.push({
              type: "file",
              url: part.url,
              mediaType: part.mime,
              filename: part.filename,
            })

          // 压缩部分转换为问题
          if (part.type === "compaction") {
            userMessage.parts.push({
              type: "text",
              text: "What did we do so far?",
            })
          }
          // 子任务部分转换为说明
          if (part.type === "subtask") {
            userMessage.parts.push({
              type: "text",
              text: "The following tool was executed by the user",
            })
          }
        }
      }

      // 处理助手消息
      if (msg.info.role === "assistant") {
        // 如果有错误且不是中止后的消息，跳过
        if (
          msg.info.error &&
          !(
            MessageV2.AbortedError.isInstance(msg.info.error) &&
            msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
          )
        ) {
          continue
        }
        const assistantMessage: UIMessage = {
          id: msg.info.id,
          role: "assistant",
          parts: [],
        }
        for (const part of msg.parts) {
          // 文本部分
          if (part.type === "text")
            assistantMessage.parts.push({
              type: "text",
              text: part.text,
              providerMetadata: part.metadata,
            })
          // 步骤开始部分
          if (part.type === "step-start")
            assistantMessage.parts.push({
              type: "step-start",
            })
          // 工具部分
          if (part.type === "tool") {
            if (part.state.status === "completed") {
              // 如果有附件，插入用户消息
              if (part.state.attachments?.length) {
                result.push({
                  id: Identifier.ascending("message"),
                  role: "user",
                  parts: [
                    {
                      type: "text",
                      text: `Tool ${part.tool} returned an attachment:`,
                    },
                    ...part.state.attachments.map((attachment) => ({
                      type: "file" as const,
                      url: attachment.url,
                      mediaType: attachment.mime,
                      filename: attachment.filename,
                    })),
                  ],
                })
              }
              // 添加工具结果
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-available",
                toolCallId: part.callID,
                input: part.state.input,
                output: part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output,
                callProviderMetadata: part.metadata,
              })
            }
            if (part.state.status === "error")
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-error",
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                callProviderMetadata: part.metadata,
              })
          }
          // 推理部分
          if (part.type === "reasoning") {
            assistantMessage.parts.push({
              type: "reasoning",
              text: part.text,
              providerMetadata: part.metadata,
            })
          }
        }
        // 只有有内容时才添加
        if (assistantMessage.parts.length > 0) {
          result.push(assistantMessage)
        }
      }
    }

    // 过滤掉 step-start 并转换
    return convertToModelMessages(result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")))
  }

  /**
   * 流式读取会话消息
   *
   * @param sessionID - 会话 ID
   * @returns 异步生成器，产生会话中的所有消息（按时间顺序）
   */
  export const stream = fn(Identifier.schema("session"), async function* (sessionID) {
    // 获取所有消息键
    const list = await Array.fromAsync(await Storage.list(["message", sessionID]))
    // 倒序遍历（最新的在前）
    for (let i = list.length - 1; i >= 0; i--) {
      yield await get({
        sessionID,
        messageID: list[i][2],
      })
    }
  })

  /**
   * 获取消息的所有部分
   *
   * @param messageID - 消息 ID
   * @returns Promise，解析为部分列表（按 ID 排序）
   */
  export const parts = fn(Identifier.schema("message"), async (messageID) => {
    const result = [] as MessageV2.Part[]
    // 遍历所有部分
    for (const item of await Storage.list(["part", messageID])) {
      const read = await Storage.read<MessageV2.Part>(item)
      result.push(read)
    }
    // 按 ID 排序
    result.sort((a, b) => (a.id > b.id ? 1 : -1))
    return result
  })

  /**
   * 获取指定消息
   *
   * @param input - 查询参数
   *   - sessionID：会话 ID
   *   - messageID：消息 ID
   * @returns Promise，解析为带部分的消息
   */
  export const get = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      return {
        info: await Storage.read<MessageV2.Info>(["message", input.sessionID, input.messageID]),
        parts: await parts(input.messageID),
      }
    },
  )

  /**
   * 过滤压缩后的消息
   *
   * 返回从最新消息到最近一次压缩之间的消息。
   *
   * @param stream - 消息流
   * @returns Promise，解析为过滤后的消息列表
   */
  export async function filterCompacted(stream: AsyncIterable<MessageV2.WithParts>) {
    const result = [] as MessageV2.WithParts[]
    // 记录已完成的父消息 ID
    const completed = new Set<string>()
    for await (const msg of stream) {
      result.push(msg)
      // 如果遇到压缩部分且父消息已完成，停止
      if (
        msg.info.role === "user" &&
        completed.has(msg.info.id) &&
        msg.parts.some((part) => part.type === "compaction")
      )
        break
      // 标记完成的父消息
      if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish) completed.add(msg.info.parentID)
    }
    // 反转顺序
    result.reverse()
    return result
  }

  /**
   * 从错误创建消息错误格式
   *
   * 将各种错误转换为统一的错误格式。
   *
   * @param e - 原始错误
   * @param ctx - 上下文信息
   *   - providerID：提供商 ID
   * @returns 消息错误对象
   *
   * 支持的错误类型：
   * - DOMException (AbortError)：中止错误
   * - OutputLengthError：输出长度错误
   * - LoadAPIKeyError：API Key 加载错误
   * - SystemError (ECONNRESET)：连接重置
   * - APICallError：API 调用错误
   * - 其他 Error：未知错误
   */
  export function fromError(e: unknown, ctx: { providerID: string }) {
    switch (true) {
      // 中止错误
      case e instanceof DOMException && e.name === "AbortError":
        return new MessageV2.AbortedError(
          { message: e.message },
          {
            cause: e,
          },
        ).toObject()
      // 输出长度错误
      case MessageV2.OutputLengthError.isInstance(e):
        return e
      // API Key 加载错误
      case LoadAPIKeyError.isInstance(e):
        return new MessageV2.AuthError(
          {
            providerID: ctx.providerID,
            message: e.message,
          },
          { cause: e },
        ).toObject()
      // 连接重置
      case (e as SystemError)?.code === "ECONNRESET":
        return new MessageV2.APIError(
          {
            message: "Connection reset by server",
            isRetryable: true,
            metadata: {
              code: (e as SystemError).code ?? "",
              syscall: (e as SystemError).syscall ?? "",
              message: (e as SystemError).message ?? "",
            },
          },
          { cause: e },
        ).toObject()
      // API 调用错误
      case APICallError.isInstance(e):
        const message = iife(() => {
          let msg = e.message
          // 如果消息为空，尝试从响应体获取
          if (msg === "") {
            if (e.responseBody) return e.responseBody
            if (e.statusCode) {
              const err = STATUS_CODES[e.statusCode]
              if (err) return err
            }
            return "Unknown error"
          }
          // 应用提供商转换
          const transformed = ProviderTransform.error(ctx.providerID, e)
          if (transformed !== msg) {
            return transformed
          }
          // 如果有响应体且不是状态码描述，尝试解析
          if (!e.responseBody || (e.statusCode && msg !== STATUS_CODES[e.statusCode])) {
            return msg
          }

          try {
            const body = JSON.parse(e.responseBody)
            // 提取常见错误消息字段
            const errMsg = body.message || body.error || body.error?.message
            if (errMsg && typeof errMsg === "string") {
              return `${msg}: ${errMsg}`
            }
          } catch {}

          return `${msg}: ${e.responseBody}`
        }).trim()

        const metadata = e.url ? { url: e.url } : undefined
        return new MessageV2.APIError(
          {
            message,
            statusCode: e.statusCode,
            isRetryable: e.isRetryable,
            responseHeaders: e.responseHeaders,
            responseBody: e.responseBody,
            metadata,
          },
          { cause: e },
        ).toObject()
      // 其他错误
      case e instanceof Error:
        return new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
      default:
        return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e })
    }
  }
}

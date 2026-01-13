/**
 * ============================================================================
 * 文件名：message.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 消息模型（v1）定义。定义了消息的各种 Part 类型和 Info 结构，
 * 用于表示会话中的消息内容。这是旧版消息模型，正在被 message-v2.ts 替代。
 *
 * 主要功能：
 * - OutputLengthError：输出长度错误
 * - AuthError：提供商认证错误
 * - ToolCall/ToolPartialCall/ToolResult：工具调用状态
 * - TextPart/ReasoningPart/ToolInvocationPart：消息 Part 类型
 * - SourceUrlPart/FilePart/StepStartPart：其他 Part 类型
 * - MessagePart：联合类型
 * - Info：消息信息结构
 *
 * 依赖关系：
 * - zod：类型验证
 * - @opencode-ai/util/error：命名错误
 *
 * 导出内容：
 * - Message namespace：消息模型命名空间
 *   - OutputLengthError：输出长度错误
 *   - AuthError：认证错误
 *   - ToolCall/ToolPartialCall/ToolResult：工具调用类型
 *   - ToolInvocation：工具调用联合类型
 *   - TextPart/ReasoningPart 等：Part 类型
 *   - MessagePart：Part 联合类型
 *   - Info：消息信息类型
 *
 * @package opencode
 * @module session/message
 */

// 导入 Zod 用于类型验证
import z from "zod"

// 导入命名错误工具
import { NamedError } from "@opencode-ai/util/error"

/**
 * 消息模型命名空间
 *
 * 定义消息的各种 Part 类型和 Info 结构。
 * 这是旧版消息模型（v1），建议使用 message-v2.ts 中的新模型。
 */
export namespace Message {
  /**
   * 输出长度错误
   *
   * 当消息输出超过模型限制时抛出此错误。
   */
  export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))

  /**
   * 认证错误
   *
   * 当提供商认证失败时抛出此错误。
   */
  export const AuthError = NamedError.create(
    "ProviderAuthError",
    z.object({
      // 提供商 ID
      providerID: z.string(),
      // 错误消息
      message: z.string(),
    }),
  )

  /**
   * 工具调用状态
   *
   * 表示一个工具调用请求。
   */
  export const ToolCall = z
    .object({
      // 状态标识
      state: z.literal("call"),
      // 步骤编号
      step: z.number().optional(),
      // 工具调用 ID
      toolCallId: z.string(),
      // 工具名称
      toolName: z.string(),
      // 工具参数
      args: z.custom<Required<unknown>>(),
    })
    .meta({
      ref: "ToolCall",
    })
  export type ToolCall = z.infer<typeof ToolCall>

  /**
   * 工具部分调用状态
   *
   * 表示一个正在构建中的工具调用（参数还在生成）。
   */
  export const ToolPartialCall = z
    .object({
      // 状态标识
      state: z.literal("partial-call"),
      // 步骤编号
      step: z.number().optional(),
      // 工具调用 ID
      toolCallId: z.string(),
      // 工具名称
      toolName: z.string(),
      // 部分参数
      args: z.custom<Required<unknown>>(),
    })
    .meta({
      ref: "ToolPartialCall",
    })
  export type ToolPartialCall = z.infer<typeof ToolPartialCall>

  /**
   * 工具调用结果
   *
   * 表示一个工具调用的执行结果。
   */
  export const ToolResult = z
    .object({
      // 状态标识
      state: z.literal("result"),
      // 步骤编号
      step: z.number().optional(),
      // 工具调用 ID
      toolCallId: z.string(),
      // 工具名称
      toolName: z.string(),
      // 工具参数
      args: z.custom<Required<unknown>>(),
      // 执行结果
      result: z.string(),
    })
    .meta({
      ref: "ToolResult",
    })
  export type ToolResult = z.infer<typeof ToolResult>

  /**
   * 工具调用联合类型
   *
   * 使用 discriminatedUnion 根据状态字段区分三种工具调用状态。
   */
  export const ToolInvocation = z.discriminatedUnion("state", [ToolCall, ToolPartialCall, ToolResult]).meta({
    ref: "ToolInvocation",
  })
  export type ToolInvocation = z.infer<typeof ToolInvocation>

  /**
   * 文本 Part
   *
   * 表示消息中的文本内容。
   */
  export const TextPart = z
    .object({
      // Part 类型
      type: z.literal("text"),
      // 文本内容
      text: z.string(),
    })
    .meta({
      ref: "TextPart",
    })
  export type TextPart = z.infer<typeof TextPart>

  /**
   * 推理 Part
   *
   * 表示模型推理过程的内容（如  标签内的内容）。
   */
  export const ReasoningPart = z
    .object({
      // Part 类型
      type: z.literal("reasoning"),
      // 推理文本
      text: z.string(),
      // 提供商元数据
      providerMetadata: z.record(z.string(), z.any()).optional(),
    })
    .meta({
      ref: "ReasoningPart",
    })
  export type ReasoningPart = z.infer<typeof ReasoningPart>

  /**
   * 工具调用 Part
   *
   * 包装工具调用为一个消息 Part。
   */
  export const ToolInvocationPart = z
    .object({
      // Part 类型
      type: z.literal("tool-invocation"),
      // 工具调用
      toolInvocation: ToolInvocation,
    })
    .meta({
      ref: "ToolInvocationPart",
    })
  export type ToolInvocationPart = z.infer<typeof ToolInvocationPart>

  /**
   * 来源 URL Part
   *
   * 表示消息中引用的来源 URL（如搜索结果）。
   */
  export const SourceUrlPart = z
    .object({
      // Part 类型
      type: z.literal("source-url"),
      // 来源 ID
      sourceId: z.string(),
      // URL 地址
      url: z.string(),
      // 标题
      title: z.string().optional(),
      // 提供商元数据
      providerMetadata: z.record(z.string(), z.any()).optional(),
    })
    .meta({
      ref: "SourceUrlPart",
    })
  export type SourceUrlPart = z.infer<typeof SourceUrlPart>

  /**
   * 文件 Part
   *
   * 表示消息中包含的文件（图片、文档等）。
   */
  export const FilePart = z
    .object({
      // Part 类型
      type: z.literal("file"),
      // 媒体类型（MIME type）
      mediaType: z.string(),
      // 文件名
      filename: z.string().optional(),
      // 文件 URL
      url: z.string(),
    })
    .meta({
      ref: "FilePart",
    })
  export type FilePart = z.infer<typeof FilePart>

  /**
   * 步骤开始 Part
   *
   * 标记一个推理步骤的开始。
   */
  export const StepStartPart = z
    .object({
      // Part 类型
      type: z.literal("step-start"),
    })
    .meta({
      ref: "StepStartPart",
    })
  export type StepStartPart = z.infer<typeof StepStartPart>

  /**
   * 消息 Part 联合类型
   *
   * 包含所有可能的 Part 类型。
   */
  export const MessagePart = z
    .discriminatedUnion("type", [TextPart, ReasoningPart, ToolInvocationPart, SourceUrlPart, FilePart, StepStartPart])
    .meta({
      ref: "MessagePart",
    })
  export type MessagePart = z.infer<typeof MessagePart>

  /**
   * 消息信息结构
   *
   * 包含消息的所有信息，包括 Parts 和元数据。
   */
  export const Info = z
    .object({
      // 消息 ID
      id: z.string(),
      // 角色（用户或助手）
      role: z.enum(["user", "assistant"]),
      // 消息 Parts 列表
      parts: z.array(MessagePart),
      // 元数据
      metadata: z
        .object({
          // 时间信息
          time: z.object({
            // 创建时间
            created: z.number(),
            // 完成时间
            completed: z.number().optional(),
          }),
          // 错误信息
          error: z
            .discriminatedUnion("name", [AuthError.Schema, NamedError.Unknown.Schema, OutputLengthError.Schema])
            .optional(),
          // 会话 ID
          sessionID: z.string(),
          // 工具执行记录
          tool: z.record(
            z.string(),
            z
              .object({
                // 工具标题
                title: z.string(),
                // 快照
                snapshot: z.string().optional(),
                // 执行时间
                time: z.object({
                  start: z.number(),
                  end: z.number(),
                }),
              })
              .catchall(z.any()),
          ),
          // 助手消息专用元数据
          assistant: z
            .object({
              // 系统提示词
              system: z.string().array(),
              // 模型 ID
              modelID: z.string(),
              // 提供商 ID
              providerID: z.string(),
              // 路径信息
              path: z.object({
                cwd: z.string(),
                root: z.string(),
              }),
              // 成本
              cost: z.number(),
              // 是否为摘要消息
              summary: z.boolean().optional(),
              // Token 统计
              tokens: z.object({
                input: z.number(),
                output: z.number(),
                reasoning: z.number(),
                cache: z.object({
                  read: z.number(),
                  write: z.number(),
                }),
              }),
            })
            .optional(),
          // 快照
          snapshot: z.string().optional(),
        })
        .meta({ ref: "MessageMetadata" }),
    })
    .meta({
      ref: "Message",
    })
  export type Info = z.infer<typeof Info>
}

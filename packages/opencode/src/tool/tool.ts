/**
 * ============================================================================
 * 文件名：tool.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * 工具系统核心类型定义模块。定义所有工具的接口和类型。
 *
 * 主要功能：
 * - Metadata：工具元数据类型
 * - InitContext：工具初始化上下文
 * - Context：工具执行上下文
 * - Info：工具信息接口
 * - define()：工具定义函数
 * - InferParameters：参数类型推断
 * - InferMetadata：元数据类型推断
 *
 * 依赖关系：
 * - zod：类型验证
 * - ../session/message-v2：消息类型
 * - ../agent/agent：Agent 信息
 * - ../permission/next：权限请求
 * - ./truncation：输出截断
 *
 * 导出内容：
 * - Tool namespace：工具命名空间
 *   - Metadata：元数据类型
 *   - InitContext：初始化上下文
 *   - Context：执行上下文
 *   - Info：工具信息接口
 *   - InferParameters：参数推断类型
 *   - InferMetadata：元数据推断类型
 *   - define()：定义工具
 *
 * 工具执行流程：
 * 1. 工具注册到 ToolRegistry
 * 2. Agent 调用工具时传入参数
 * 3. define() 包装器验证参数
 * 4. 执行工具的 execute 函数
 * 5. 自动处理输出截断
 *
 * @package opencode
 * @module tool/tool
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入消息类型
import type { MessageV2 } from "../session/message-v2"

// 导入 Agent 信息类型
import type { Agent } from "../agent/agent"

// 导入权限请求类型
import type { PermissionNext } from "../permission/next"

// 导入截断模块
import { Truncate } from "./truncation"

/**
 * 工具命名空间
 *
 * 包含所有工具相关的类型和定义函数。
 */
export namespace Tool {
  /**
   * 工具元数据类型
   *
   * 工具执行后返回的任意元数据。
   * 可以包含状态、统计信息等。
   */
  interface Metadata {
    [key: string]: any
  }

  /**
   * 工具初始化上下文
   *
   * 在工具初始化时提供的信息。
   */
  export interface InitContext {
    // 可选的 Agent 信息
    agent?: Agent.Info
  }

  /**
   * 工具执行上下文
   *
   * 在工具执行时传递的上下文信息。
   *
   * @template M - 元数据类型
   */
  export type Context<M extends Metadata = Metadata> = {
    // 会话 ID
    sessionID: string
    // 消息 ID
    messageID: string
    // Agent ID
    agent: string
    // 中止信号，用于取消操作
    abort: AbortSignal
    // 工具调用 ID（可选）
    callID?: string
    // 额外信息
    extra?: { [key: string]: any }
    // 设置结果元数据的函数
    metadata(input: { title?: string; metadata?: M }): void
    // 向用户请求权限的函数
    ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
  }

  /**
   * 工具信息接口
   *
   * 定义一个工具的完整结构。
   *
   * @template Parameters - 参数 Zod 类型
   * @template M - 元数据类型
   */
  export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    // 工具唯一标识符
    id: string
    // 初始化函数，返回工具的描述、参数和执行逻辑
    init: (ctx?: InitContext) => Promise<{
      // 工具描述，用于 AI 理解工具用途
      description: string
      // 参数 Schema，用于验证工具调用
      parameters: Parameters
      // 执行函数
      execute(
        args: z.infer<Parameters>,
        ctx: Context,
      ): Promise<{
        // 结果标题
        title: string
        // 结果元数据
        metadata: M
        // 输出文本
        output: string
        // 可选的附件（文件）
        attachments?: MessageV2.FilePart[]
      }>
      // 可选的验证错误格式化函数
      formatValidationError?(error: z.ZodError): string
    }>
  }

  /**
   * 推断工具的参数类型
   *
   * 从 Tool.Info 提取参数类型。
   *
   * @template T - 工具信息类型
   */
  export type InferParameters<T extends Info> = T extends Info<infer P> ? z.infer<P> : never

  /**
   * 推断工具的元数据类型
   *
   * 从 Tool.Info 提取元数据类型。
   *
   * @template T - 工具信息类型
   */
  export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never

  /**
   * 定义工具
   *
   * 创建一个工具定义，包装参数验证和输出截断。
   *
   * @param id - 工具唯一标识符
   * @param init - 初始化配置或初始化函数
   * @returns 工具信息对象
   *
   * 处理流程：
   * 1. 调用 init 获取工具配置
   * 2. 包装 execute 函数
   * 3. 在 execute 前验证参数
   * 4. 在 execute 后处理截断
   *
   * 参数验证：
   * - 使用 Zod schema 验证
   * - 失败时调用 formatValidationError 或使用默认消息
   * - 抛出包含详细信息的错误
   *
   * 输出截断：
   * - 自动应用 Truncate.output
   * - 工具可以设置 metadata.truncated 跳过
   *
   * @template Parameters - 参数 Zod 类型
   * @template Result - 元数据类型
   *
   * @example
   * ```typescript
   * export const MyTool = Tool.define(
   *   "my_tool",
   *   {
   *     description: "Does something",
   *     parameters: z.object({
   *       input: z.string()
   *     }),
   *     async execute(args, ctx) {
   *       return {
   *         title: "Result",
   *         output: "Done",
   *         metadata: {}
   *       }
   *     }
   *   }
   * )
   * ```
   */
  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init: Info<Parameters, Result>["init"] | Awaited<ReturnType<Info<Parameters, Result>["init"]>>,
  ): Info<Parameters, Result> {
    return {
      id,
      // 包装初始化函数
      init: async (initCtx) => {
        // 如果 init 是函数，调用它获取配置
        const toolInfo = init instanceof Function ? await init(initCtx) : init
        // 保存原始 execute 函数
        const execute = toolInfo.execute

        // 包装 execute 函数，添加验证和截断
        toolInfo.execute = async (args, ctx) => {
          try {
            // 验证参数
            toolInfo.parameters.parse(args)
          } catch (error) {
            // 参数验证失败
            if (error instanceof z.ZodError && toolInfo.formatValidationError) {
              // 使用自定义错误格式化
              throw new Error(toolInfo.formatValidationError(error), { cause: error })
            }
            // 使用默认错误消息
            throw new Error(
              `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
              { cause: error },
            )
          }

          // 执行原始函数
          const result = await execute(args, ctx)

          // 如果工具自己处理了截断，直接返回
          if (result.metadata.truncated !== undefined) {
            return result
          }

          // 应用输出截断
          const truncated = await Truncate.output(result.output, {}, initCtx?.agent)
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              // 如果被截断，记录输出路径
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }
        return toolInfo
      },
    }
  }
}

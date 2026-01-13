/**
 * ============================================================================
 * 文件名：batch.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Batch 工具模块。允许 AI 并行执行多个工具调用以提高性能。
 *
 * 主要功能：
 * - BatchTool：批量执行工具调用的工具
 * - 并行执行多个工具（最多 10 个）
 * - 收集所有结果和错误
 * - 跟踪每个工具的状态
 * - 防止嵌套 batch 调用
 * - 过滤不可用的工具
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类
 * - ./batch.txt：工具描述模板
 * - ../session：会话管理（动态导入）
 * - ../id/id：标识符生成（动态导入）
 * - ./registry：工具注册表（动态导入）
 *
 * 导出内容：
 * - BatchTool：Batch 工具定义
 *
 * 参数：
 * - tool_calls：工具调用数组（至少 1 个，最多 10 个）
 *   - tool：工具名称
 *   - parameters：工具参数
 *
 * 返回：
 * - title：批量执行标题（成功/失败统计）
 * - output：执行结果摘要
 * - attachments：所有成功工具的附件
 * - metadata：元数据（totalCalls、successful、failed、tools、details）
 *
 * 常量：
 * - DISALLOWED：禁止在 batch 中使用的工具集合（batch 自身）
 * - FILTERED_FROM_SUGGESTIONS：从建议中过滤的工具（invalid, patch, batch）
 *
 * 行为：
 * - 最多执行 10 个工具调用
 * - 超过 10 个的调用将被丢弃并返回错误
 * - 不允许嵌套 batch 调用
 * - 外部工具（MCP、环境）不能批量执行
 * - 每个工具调用有独立的 part ID
 * - 工具调用状态保存在会话中
 *
 * 错误处理：
 * - 单个工具失败不影响其他工具
 * - 所有错误都包含在结果中
 * - 被丢弃的调用显示为错误
 *
 * @package opencode
 * @module tool/batch
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入工具描述模板
import DESCRIPTION from "./batch.txt"

// 禁止在 batch 中使用的工具集合
const DISALLOWED = new Set(["batch"])

// 从建议中过滤的工具集合
const FILTERED_FROM_SUGGESTIONS = new Set(["invalid", "patch", ...DISALLOWED])

/**
 * Batch 工具定义
 *
 * 允许 AI 并行执行多个工具调用以提高性能。
 */
export const BatchTool = Tool.define("batch", async () => {
  return {
    // 工具描述（从模板导入）
    description: DESCRIPTION,

    // 参数 Schema
    parameters: z.object({
      // 工具调用数组
      tool_calls: z
        .array(
          z.object({
            // 工具名称
            tool: z.string().describe("The name of the tool to execute"),
            // 工具参数（宽松模式，允许任意属性）
            parameters: z.object({}).loose().describe("Parameters for the tool"),
          }),
        )
        .min(1, "Provide at least one tool call")
        .describe("Array of tool calls to execute in parallel"),
    }),

    // 自定义验证错误格式
    formatValidationError(error) {
      const formattedErrors = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root"
          return `  - ${path}: ${issue.message}`
        })
        .join("\n")

      return `Invalid parameters for tool 'batch':\n${formattedErrors}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
    },

    async execute(params, ctx) {
      // 动态导入会话模块
      const { Session } = await import("../session")
      // 动态导入标识符模块
      const { Identifier } = await import("../id/id")

      // 限制最多 10 个工具调用
      const toolCalls = params.tool_calls.slice(0, 10)
      const discardedCalls = params.tool_calls.slice(10)

      // 获取可用工具
      const { ToolRegistry } = await import("./registry")
      const availableTools = await ToolRegistry.tools("")
      const toolMap = new Map(availableTools.map((t) => [t.id, t]))

      // 执行单个工具调用
      const executeCall = async (call: (typeof toolCalls)[0]) => {
        const callStartTime = Date.now()
        // 生成唯一的 part ID
        const partID = Identifier.ascending("part")

        try {
          // 检查是否是禁止的工具
          if (DISALLOWED.has(call.tool)) {
            throw new Error(
              `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`,
            )
          }

          // 获取工具
          const tool = toolMap.get(call.tool)
          if (!tool) {
            // 过滤掉建议中的工具
            const availableToolsList = Array.from(toolMap.keys()).filter((name) => !FILTERED_FROM_SUGGESTIONS.has(name))
            throw new Error(
              `Tool '${call.tool}' not in registry. External tools (MCP, environment) cannot be batched - call them directly. Available tools: ${availableToolsList.join(", ")}`,
            )
          }

          // 验证参数
          const validatedParams = tool.parameters.parse(call.parameters)

          // 更新 part 状态为运行中
          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "running",
              input: call.parameters,
              time: {
                start: callStartTime,
              },
            },
          })

          // 执行工具
          const result = await tool.execute(validatedParams, { ...ctx, callID: partID })

          // 更新 part 状态为完成
          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "completed",
              input: call.parameters,
              output: result.output,
              title: result.title,
              metadata: result.metadata,
              attachments: result.attachments,
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: true as const, tool: call.tool, result }
        } catch (error) {
          // 更新 part 状态为错误
          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "error",
              input: call.parameters,
              error: error instanceof Error ? error.message : String(error),
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: false as const, tool: call.tool, error }
        }
      }

      // 并行执行所有工具调用
      const results = await Promise.all(toolCalls.map((call) => executeCall(call)))

      // 添加被丢弃的调用作为错误
      const now = Date.now()
      for (const call of discardedCalls) {
        const partID = Identifier.ascending("part")
        await Session.updatePart({
          id: partID,
          messageID: ctx.messageID,
          sessionID: ctx.sessionID,
          type: "tool",
          tool: call.tool,
          callID: partID,
          state: {
            status: "error",
            input: call.parameters,
            error: "Maximum of 10 tools allowed in batch",
            time: { start: now, end: now },
          },
        })
        results.push({
          success: false as const,
          tool: call.tool,
          error: new Error("Maximum of 10 tools allowed in batch"),
        })
      }

      // 统计成功和失败数量
      const successfulCalls = results.filter((r) => r.success).length
      const failedCalls = results.length - successfulCalls

      // 构建输出消息
      const outputMessage =
        failedCalls > 0
          ? `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`
          : `All ${successfulCalls} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`

      return {
        title: `Batch execution (${successfulCalls}/${results.length} successful)`,
        output: outputMessage,
        // 收集所有成功工具的附件
        attachments: results.filter((result) => result.success).flatMap((r) => r.result.attachments ?? []),
        metadata: {
          totalCalls: results.length,
          successful: successfulCalls,
          failed: failedCalls,
          tools: params.tool_calls.map((c) => c.tool),
          details: results.map((r) => ({ tool: r.tool, success: r.success })),
        },
      }
    },
  }
})

/**
 * ============================================================================
 * 文件名：tool.ts
 * 所属包：packages/plugin/src
 * ============================================================================
 *
 * 文件作用：
 * 定义插件工具系统的类型和工厂函数。
 * 允许插件为 OpenCode 提供自定义工具，这些工具可以被 AI Agent 调用。
 *
 * 主要功能：
 * - 定义工具上下文类型（ToolContext）
 * - 提供 tool 工厂函数用于创建工具定义
 * - 提供 Zod 实例用于参数验证
 * - 定义工具定义类型（ToolDefinition）
 *
 * 依赖关系：
 * - zod：运行时类型验证和 schema 定义
 *
 * 导出内容：
 * - ToolContext：工具执行上下文类型
 * - tool：工具工厂函数
 * - ToolDefinition：工具定义类型
 *
 * 使用场景：
 * - 插件提供自定义工具给 AI Agent
 * - 定义工具的参数 schema
 * - 实现工具的执行逻辑
 *
 * @package plugin
 * @module tool
 */

// 从 zod 导入 schema 验证库
// 用于定义工具参数的类型和验证规则
import { z } from "zod"

/**
 * 工具上下文类型
 *
 * 定义工具执行时可用的上下文信息。
 * 这些信息由 OpenCode 在调用工具时提供。
 */
export type ToolContext = {
  // 会话 ID
  // 标识当前对话会话的唯一标识符
  sessionID: string

  // 消息 ID
  // 标识触发工具调用的消息的唯一标识符
  messageID: string

  // Agent 标识
  // 标识当前使用的 AI Agent
  agent: string

  // 中止信号
  // 用于检测和响应取消请求
  // 当用户中断操作时，此信号会被触发
  abort: AbortSignal
}

/**
 * 工厂函数：创建工具定义
 *
 * 这是一个身份函数，直接返回输入对象。
 * 它的作用是提供类型安全和良好的开发体验。
 *
 * @template Args - 参数 schema 类型，必须是 Zod 原始形状
 * @param input.description - 工具的描述，告诉 AI 这个工具做什么
 * @param input.args - 工具参数的 Zod schema，定义参数的类型和验证规则
 * @param input.execute - 工具的执行函数，接收验证后的参数和上下文，返回结果字符串
 * @returns 工具定义对象
 *
 * @example
 * ```typescript
 * const myTool = tool({
 *   description: "计算两个数的和",
 *   args: {
 *     a: tool.schema.number().describe("第一个数"),
 *     b: tool.schema.number().describe("第二个数"),
 *   },
 *   execute: async ({ a, b }, context) => {
 *     return `结果是 ${a + b}`
 *   }
 * })
 * ```
 */
export function tool<Args extends z.ZodRawShape>(input: {
  // 工具描述，AI 会根据这个描述决定何时使用工具
  description: string

  // 参数 schema 定义
  // 键是参数名，值是 Zod schema
  args: Args

  // 执行函数
  // args 是根据 args schema 推断出的类型
  // context 是工具执行的上下文信息
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>
}) {
  // 直接返回输入对象
  // 这是一个类型级别的函数，用于推断类型，不需要运行时处理
  return input
}

// 将 Zod 实例附加到 tool 函数上
// 这样插件开发者可以使用 tool.schema 来访问 Zod，而不需要额外导入
// 这是一个便捷的导出方式
tool.schema = z

/**
 * 工具定义类型
 *
 * 推断自 tool 函数的返回值类型。
 * 包含 description、args 和 execute 三个属性。
 */
export type ToolDefinition = ReturnType<typeof tool>

/**
 * ============================================================================
 * 文件名：invalid.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * 无效工具定义模块。提供当工具调用参数无效时的错误报告工具。
 *
 * 主要功能：
 * - 定义 InvalidTool：用于报告无效的工具调用
 * - 提供标准化的错误消息格式
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类定义
 *
 * 导出内容：
 * - InvalidTool：无效工具的 Tool.Info 定义
 *
 * 使用场景：
 * - 当 AI 尝试调用不存在的工具时
 * - 当工具调用参数验证失败时
 * - 作为工具列表的占位符
 *
 * @package opencode
 * @module tool/invalid
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

/**
 * 无效工具定义
 *
 * 当工具调用无效时使用此工具返回错误信息。
 * 参数包含工具名称和错误详情。
 */
export const InvalidTool = Tool.define("invalid", {
  // 工具描述
  description: "Do not use",

  // 参数 Schema
  parameters: z.object({
    // 被调用的工具 ID
    tool: z.string(),
    // 错误消息
    error: z.string(),
  }),

  // 执行函数
  async execute(params) {
    return {
      title: "Invalid Tool",
      // 格式化错误消息
      output: `The arguments provided to the tool are invalid: ${params.error}`,
      metadata: {},
    }
  },
})

/**
 * ============================================================================
 * 文件名：multiedit.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * MultiEdit 工具模块。允许 AI 对单个文件执行多个顺序编辑操作。
 *
 * 主要功能：
 * - MultiEditTool：对单个文件执行多个编辑的工具
 * - 顺序执行多个 edit 操作
 * - 每个编辑使用 EditTool 的相同逻辑
 * - 收集所有编辑的结果
 * - 返回最后一个编辑的输出
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类
 * - ./edit：Edit 工具
 * - ./multiedit.txt：工具描述模板
 * - path：路径处理
 * - ../project/instance：实例管理
 *
 * 导出内容：
 * - MultiEditTool：MultiEdit 工具定义
 *
 * 参数：
 * - filePath：文件路径（必须是绝对路径）
 * - edits：编辑操作数组
 *   - filePath：文件路径（每个编辑的文件路径，目前未使用）
 *   - oldString：要替换的文本
 *   - newString：替换后的文本
 *   - replaceAll：是否替换所有出现（可选）
 *
 * 返回：
 * - title：相对路径标题
 * - output：最后一个编辑的输出
 * - metadata：元数据（所有编辑的结果数组）
 *
 * 行为：
 * - 编辑操作按顺序执行
 * - 每个编辑使用 EditTool 的 execute 方法
 * - 后续编辑基于前面编辑的结果
 * - 返回最后一个编辑的输出作为主要输出
 *
 * 注意：
 * - edits 数组中每个 edit 的 filePath 字段目前未使用
 * - 所有编辑都作用于 params.filePath 指定的文件
 *
 * @package opencode
 * @module tool/multiedit
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入 Edit 工具
import { EditTool } from "./edit"

// 导入工具描述模板
import DESCRIPTION from "./multiedit.txt"

// 导入路径处理
import path from "path"

// 导入实例管理
import { Instance } from "../project/instance"

/**
 * MultiEdit 工具定义
 *
 * 允许 AI 对单个文件执行多个顺序编辑操作。
 */
export const MultiEditTool = Tool.define("multiedit", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // 文件路径（必须是绝对路径）
    filePath: z.string().describe("The absolute path to the file to modify"),
    // 编辑操作数组
    edits: z
      .array(
        z.object({
          // 文件路径（目前未使用）
          filePath: z.string().describe("The absolute path to the file to modify"),
          // 要替换的文本
          oldString: z.string().describe("The text to replace"),
          // 替换后的文本
          newString: z.string().describe("The text to replace it with (must be different from oldString)"),
          // 是否替换所有出现
          replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
        }),
      )
      .describe("Array of edit operations to perform sequentially on the file"),
  }),

  async execute(params, ctx) {
    // 获取 EditTool 实例
    const tool = await EditTool.init()
    const results = []

    // 顺序执行每个编辑操作
    for (const [, edit] of params.edits.entries()) {
      // 使用 EditTool 执行编辑
      const result = await tool.execute(
        {
          filePath: params.filePath,
          oldString: edit.oldString,
          newString: edit.newString,
          replaceAll: edit.replaceAll,
        },
        ctx,
      )
      results.push(result)
    }

    return {
      // 使用相对路径作为标题
      title: path.relative(Instance.worktree, params.filePath),
      metadata: {
        // 所有编辑的结果数组
        results: results.map((r) => r.metadata),
      },
      // 返回最后一个编辑的输出
      output: results.at(-1)!.output,
    }
  },
})

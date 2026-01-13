/**
 * ============================================================================
 * 文件名：todo.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Todo 工具模块。提供读写 Todo 列表的工具。
 *
 * 主要功能：
 * - TodoWriteTool：更新 Todo 列表
 * - TodoReadTool：读取 Todo 列表
 * - 支持权限检查
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类
 * - ./todowrite.txt：写入工具描述模板
 * - ../session/todo：Todo 状态管理
 *
 * 导出内容：
 * - TodoWriteTool：写入工具定义
 * - TodoReadTool：读取工具定义
 *
 * TodoWriteTool：
 * - 参数：todos（Todo.Info 数组）
 * - 需要 todowrite 权限
 * - 更新会话的 Todo 列表
 *
 * TodoReadTool：
 * - 参数：无
 * - 需要 todoread 权限
 * - 返回会话的 Todo 列表
 *
 * 使用场景：
 * - AI 跟踪任务进度
 * - 管理待办事项列表
 * - 任务状态更新
 *
 * @package opencode
 * @module tool/todo
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入 Todo 写入工具描述模板
import DESCRIPTION_WRITE from "./todowrite.txt"

// 导入 Todo 状态管理
import { Todo } from "../session/todo"

/**
 * Todo 写入工具定义
 *
 * 允许 AI 更新会话的 Todo 列表。
 */
export const TodoWriteTool = Tool.define("todowrite", {
  // 工具描述（从模板导入）
  description: DESCRIPTION_WRITE,

  // 参数 Schema
  parameters: z.object({
    // 更新的 Todo 列表
    todos: z.array(z.object(Todo.Info.shape)).describe("The updated todo list"),
  }),

  // 执行函数
  async execute(params, ctx) {
    // 请求 todowrite 权限
    await ctx.ask({
      permission: "todowrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    // 更新 Todo 列表
    await Todo.update({
      sessionID: ctx.sessionID,
      todos: params.todos,
    })

    return {
      // 标题显示未完成的 Todo 数量
      title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
      // 输出格式化的 Todo 列表
      output: JSON.stringify(params.todos, null, 2),
      metadata: {
        // 元数据包含完整 Todo 列表
        todos: params.todos,
      },
    }
  },
})

/**
 * Todo 读取工具定义
 *
 * 允许 AI 读取会话的 Todo 列表。
 */
export const TodoReadTool = Tool.define("todoread", {
  // 工具描述
  description: "Use this tool to read your todo list",

  // 参数 Schema（无需参数）
  parameters: z.object({}),

  // 执行函数
  async execute(_params, ctx) {
    // 请求 todoread 权限
    await ctx.ask({
      permission: "todoread",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    // 获取 Todo 列表
    const todos = await Todo.get(ctx.sessionID)

    return {
      // 标题显示未完成的 Todo 数量
      title: `${todos.filter((x) => x.status !== "completed").length} todos`,
      metadata: {
        // 元数据包含完整 Todo 列表
        todos,
      },
      // 输出格式化的 Todo 列表
      output: JSON.stringify(todos, null, 2),
    }
  },
})

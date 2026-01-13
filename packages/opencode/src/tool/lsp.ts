/**
 * ============================================================================
 * 文件名：lsp.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * LSP 工具模块。允许 AI 执行 LSP（Language Server Protocol）操作。
 *
 * 主要功能：
 * - LspTool：执行 LSP 操作的工具
 * - 支持多种 LSP 操作（定义、引用、悬停、符号等）
 * - 调用 LSP 服务器获取代码智能信息
 * - 返回格式化的结果
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类
 * - path：路径处理
 * - ../lsp：LSP 集成
 * - ./lsp.txt：工具描述模板
 * - ../project/instance：实例管理
 * - url：路径转 URL
 * - ./external-directory：外部目录检查
 *
 * 导出内容：
 * - LspTool：LSP 工具定义
 *
 * 参数：
 * - operation：LSP 操作类型
 * - filePath：文件路径（绝对或相对）
 * - line：行号（1-based，编辑器显示的行号）
 * - character：字符偏移（1-based，编辑器显示的列号）
 *
 * 返回：
 * - title：操作标题（操作类型 + 文件路径 + 位置）
 * - output：格式化的结果（JSON 或无结果消息）
 * - metadata：元数据（result）
 *
 * 支持的操作：
 * - goToDefinition：跳转到定义
 * - findReferences：查找引用
 * - hover：悬停信息
 * - documentSymbol：文档符号
 * - workspaceSymbol：工作区符号
 * - goToImplementation：跳转到实现
 * - prepareCallHierarchy：准备调用层次
 * - incomingCalls：传入调用
 * - outgoingCalls：传出调用
 *
 * 坐标系统：
 * - 输入：1-based（编辑器显示）
 * - 内部：0-based（LSP 标准）
 *
 * 错误处理：
 * - 文件不存在
 * - 没有 LSP 服务器可用
 *
 * @package opencode
 * @module tool/lsp
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入路径处理
import path from "path"

// 导入 LSP 集成
import { LSP } from "../lsp"

// 导入工具描述模板
import DESCRIPTION from "./lsp.txt"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入路径转 URL
import { pathToFileURL } from "url"

// 导入外部目录检查
import { assertExternalDirectory } from "./external-directory"

// 支持的 LSP 操作列表
const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

/**
 * LSP 工具定义
 *
 * 允许 AI 执行 LSP 操作获取代码智能信息。
 */
export const LspTool = Tool.define("lsp", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // LSP 操作类型
    operation: z.enum(operations).describe("The LSP operation to perform"),
    // 文件路径（绝对或相对）
    filePath: z.string().describe("The absolute or relative path to the file"),
    // 行号（1-based，编辑器显示）
    line: z.number().int().min(1).describe("The line number (1-based, as shown in editors)"),
    // 字符偏移（1-based，编辑器显示）
    character: z.number().int().min(1).describe("The character offset (1-based, as shown in editors)"),
  }),

  execute: async (args, ctx) => {
    // 解析为绝对路径
    const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)

    // 检查外部目录权限
    await assertExternalDirectory(ctx, file)

    // 请求 lsp 权限
    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    // 转换为文件 URI
    const uri = pathToFileURL(file).href

    // 转换为 0-based 坐标（LSP 标准）
    const position = {
      file,
      line: args.line - 1,
      character: args.character - 1,
    }

    // 计算相对路径
    const relPath = path.relative(Instance.worktree, file)
    const title = `${args.operation} ${relPath}:${args.line}:${args.character}`

    // 检查文件是否存在
    const exists = await Bun.file(file).exists()
    if (!exists) {
      throw new Error(`File not found: ${file}`)
    }

    // 检查是否有可用的 LSP 服务器
    const available = await LSP.hasClients(file)
    if (!available) {
      throw new Error("No LSP server available for this file type.")
    }

    // 触发 LSP 文件更新
    await LSP.touchFile(file, true)

    // 执行 LSP 操作
    const result: unknown[] = await (async () => {
      switch (args.operation) {
        case "goToDefinition":
          return LSP.definition(position)
        case "findReferences":
          return LSP.references(position)
        case "hover":
          return LSP.hover(position)
        case "documentSymbol":
          return LSP.documentSymbol(uri)
        case "workspaceSymbol":
          return LSP.workspaceSymbol("")
        case "goToImplementation":
          return LSP.implementation(position)
        case "prepareCallHierarchy":
          return LSP.prepareCallHierarchy(position)
        case "incomingCalls":
          return LSP.incomingCalls(position)
        case "outgoingCalls":
          return LSP.outgoingCalls(position)
      }
    })()

    // 格式化输出
    const output = (() => {
      if (result.length === 0) return `No results found for ${args.operation}`
      return JSON.stringify(result, null, 2)
    })()

    return {
      title,
      metadata: { result },
      output,
    }
  },
})

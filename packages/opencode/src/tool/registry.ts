/**
 * ============================================================================
 * 文件名：registry.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * 工具注册表模块。管理所有可用工具的注册和初始化。
 *
 * 主要功能：
 * - state：工具注册状态（内置 + 自定义）
 * - fromPlugin()：从插件定义转换为工具
 * - register()：注册自定义工具
 * - all()：获取所有可用工具
 * - ids()：获取所有工具 ID
 * - tools(providerID, agent?)：初始化并返回工具列表
 *
 * 依赖关系：
 * - ./question：问题工具
 * - ./bash：Bash 工具
 * - ./edit：编辑工具
 * - ./glob：Glob 工具
 * - ./grep：Grep 工具
 * - ./batch：批量工具
 * - ./read：读取工具
 * - ./task：任务工具
 * - ./todo：Todo 工具
 * - ./webfetch：Web 获取工具
 * - ./write：写入工具
 * - ./invalid：无效工具
 * - ./skill：技能工具
 * - ./websearch：Web 搜索工具
 * - ./codesearch：代码搜索工具
 * - ./lsp：LSP 工具
 * - ./truncation：截断工具
 * - ../agent/agent：Agent 信息
 * - ./tool：工具基类
 * - ../project/instance：实例管理
 * - ../config/config：配置系统
 * - path：路径处理
 * - @opencode-ai/plugin：插件类型
 * - zod：类型验证
 * - ../plugin：插件管理
 * - @/flag/flag：功能标志
 * - @/util/log：日志记录
 *
 * 导出内容：
 * - ToolRegistry namespace：工具注册表命名空间
 *   - state：注册状态
 *   - register(tool)：注册工具
 *   - all()：获取所有工具
 *   - ids()：获取所有工具 ID
 *   - tools(providerID, agent?)：获取初始化的工具列表
 *
 * 工具加载顺序：
 * 1. InvalidTool（无效工具占位符）
 * 2. QuestionTool（仅 CLI）
 * 3. BashTool
 * 4. ReadTool
 * 5. GlobTool
 * 6. GrepTool
 * 7. EditTool
 * 8. WriteTool
 * 9. TaskTool
 * 10. WebFetchTool
 * 11. TodoWriteTool
 * 12. TodoReadTool
 * 13. WebSearchTool
 * 14. CodeSearchTool
 * 15. SkillTool
 * 16. LspTool（实验性）
 * 17. BatchTool（实验性）
 * 18. 自定义工具
 *
 * 自定义工具来源：
 * - 配置目录的 tool(s)/*.{js,ts}
 * - 插件导出的 tool
 *
 * @package opencode
 * @module tool/registry
 */

// 导入内置工具
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"

// 导入类型
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"

// 导入配置和实例
import { Instance } from "../project/instance"
import { Config } from "../config/config"

// 导入路径处理
import path from "path"

// 导入插件类型
import { type ToolDefinition } from "@opencode-ai/plugin"

// 导入 Zod
import z from "zod"

// 导入插件管理
import { Plugin } from "../plugin"

// 导入其他内置工具
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"

/**
 * 工具注册表命名空间
 *
 * 管理所有可用工具的注册和初始化。
 */
export namespace ToolRegistry {
  // 创建日志记录器
  const log = Log.create({ service: "tool.registry" })

  /**
   * 工具注册状态
   *
   * 实例级状态，包含所有自定义工具。
   * 自定义工具来自配置目录和插件。
   */
  export const state = Instance.state(async () => {
    // 自定义工具列表
    const custom = [] as Tool.Info[]

    // 扫描配置目录中的自定义工具
    const glob = new Bun.Glob("{tool,tools}/*.{js,ts}")

    // 遍历所有配置目录
    for (const dir of await Config.directories()) {
      // 扫描工具文件
      for await (const match of glob.scan({
        cwd: dir,
        absolute: true,
        followSymlinks: true,
        dot: true,
      })) {
        // 获取工具命名空间（文件名不含扩展名）
        const namespace = path.basename(match, path.extname(match))

        // 动态导入工具模块
        const mod = await import(match)

        // 遍历导出的工具定义
        for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
          // 注册工具，使用 namespace_id 格式
          custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
        }
      }
    }

    // 遍历所有插件
    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      // 遍历插件导出的工具
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  /**
   * 从插件定义转换为工具
   *
   * 将 @opencode-ai/plugin 的 ToolDefinition
   * 转换为内部的 Tool.Info。
   *
   * @param id - 工具 ID
   * @param def - 插件工具定义
   * @returns 工具信息对象
   *
   * 转换逻辑：
   * 1. 使用 Zod 从 def.args 创建参数 schema
   * 2. 包装 execute 函数
   * 3. 应用输出截断
   */
  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        // 从对象创建 Zod schema
        parameters: z.object(def.args),
        description: def.description,
        // 包装执行函数
        execute: async (args, ctx) => {
          // 调用原始执行函数
          const result = await def.execute(args as any, ctx)
          // 应用输出截断
          const out = await Truncate.output(result, {}, initCtx?.agent)
          return {
            title: "",
            // 如果被截断，返回截断后的内容
            output: out.truncated ? out.content : result,
            metadata: {
              truncated: out.truncated,
              outputPath: out.truncated ? out.outputPath : undefined
            },
          }
        },
      }),
    }
  }

  /**
   * 注册自定义工具
   *
   * 添加或替换一个工具。
   * 如果工具 ID 已存在，则替换它。
   *
   * @param tool - 工具信息对象
   *
   * 使用场景：
   * - 动态添加工具
   * - 替换现有工具
   */
  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    // 查找是否已存在
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      // 替换现有工具
      custom.splice(idx, 1, tool)
      return
    }
    // 添加新工具
    custom.push(tool)
  }

  /**
   * 获取所有可用工具
   *
   * @returns Promise，解析为工具信息数组
   *
   * 返回顺序：
   * 1. InvalidTool
   * 2. QuestionTool（仅 CLI）
   * 3-15. 其他内置工具
   * 16. LspTool（实验性）
   * 17. BatchTool（实验性）
   * 18+. 自定义工具
   */
  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()

    return [
      // 始终包含 InvalidTool（用于错误处理）
      InvalidTool,

      // QuestionTool 仅在 CLI 模式下可用
      ...(Flag.OPENCODE_CLIENT === "cli" ? [QuestionTool] : []),

      // 核心工具
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      TodoReadTool,

      // 搜索工具（需要 zen 或 enable_exa 标志）
      WebSearchTool,
      CodeSearchTool,
      SkillTool,

      // 实验性工具
      ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),

      // 自定义工具
      ...custom,
    ]
  }

  /**
   * 获取所有工具 ID
   *
   * @returns Promise，解析为工具 ID 数组
   */
  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  /**
   * 获取初始化的工具列表
   *
   * 根据提供商和 Agent 过滤并初始化工具。
   *
   * @param providerID - AI 提供商 ID
   * @param agent - 可选的 Agent 信息
   * @returns Promise，解析为初始化后的工具列表
   *
   * 过滤规则：
   * - websearch/codesearch：仅对 opencode 提供商或启用 EXA 时可用
   *
   * 初始化：
   * - 调用每个工具的 init() 函数
   * - 传递 Agent 信息（如果提供）
   * - 记录初始化时间
   */
  export async function tools(providerID: string, agent?: Agent.Info) {
    const tools = await all()

    // 并行初始化所有工具
    const result = await Promise.all(
      tools
        // 过滤工具
        .filter((t) => {
          // websearch/codesearch 需要特殊权限
          if (t.id === "codesearch" || t.id === "websearch") {
            return providerID === "opencode" || Flag.OPENCODE_ENABLE_EXA
          }
          return true
        })
        // 初始化工具
        .map(async (t) => {
          // 记录初始化时间
          using _ = log.time(t.id)
          return {
            id: t.id,
            // 调用初始化函数
            ...(await t.init({ agent })),
          }
        }),
    )
    return result
  }
}

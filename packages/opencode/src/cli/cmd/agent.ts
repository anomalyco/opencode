/**
 * ============================================================================
 * 文件名：agent.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * Agent 管理命令模块。提供创建、列出和管理 AI Agent 的 CLI 命令。
 *
 * 主要功能：
 * - AgentCreateCommand：创建新 Agent
 * - AgentListCommand：列出所有可用 Agent
 * - AgentCommand：Agent 管理命令组
 *
 * 依赖关系：
 * - ./cmd：命令包装
 * - @clack/prompts：交互式提示
 * - ../ui：UI 工具
 * - ../../global：全局配置
 * - ../../agent/agent：Agent 管理
 * - ../../provider/provider：提供商管理
 * - path：路径处理
 * - fs/promises：文件系统操作
 * - gray-matter：Frontmatter 解析
 * - ../../project/instance：实例管理
 *
 * 导出内容：
 * - AgentCreateCommand：创建 Agent 命令
 * - AgentListCommand：列出 Agent 命令
 * - AgentCommand：Agent 命令组
 *
 * Agent 模式：
 * - all：可作为 primary 和 subagent 两种角色
 * - primary：仅作为主 Agent
 * - subagent：仅作为子 Agent
 *
 * 可用工具：
 * - bash, read, write, edit, list, glob, grep, webfetch
 * - task, todowrite, todoread
 *
 * Agent 文件格式：
 * - Markdown 文件 with YAML Frontmatter
 * - frontmatter 包含：description, mode, tools
 * - 内容是 system prompt
 *
 * @package opencode
 * @module cli/cmd/agent
 */

// 导入命令包装
import { cmd } from "./cmd"

// 导入交互式提示库
import * as prompts from "@clack/prompts"

// 导入 UI 工具
import { UI } from "../ui"

// 导入全局配置
import { Global } from "../../global"

// 导入 Agent 管理
import { Agent } from "../../agent/agent"

// 导入提供商管理
import { Provider } from "../../provider/provider"

// 导入路径处理
import path from "path"

// 导入文件系统 Promise API
import fs from "fs/promises"

// 导入 Frontmatter 解析库
import matter from "gray-matter"

// 导入实例管理
import { Instance } from "../../project/instance"

// 导入行尾符
import { EOL } from "os"

// 导入 yargs 类型
import type { Argv } from "yargs"

/**
 * Agent 模式类型
 *
 * - all：可作为 primary 和 subagent 两种角色
 * - primary：仅作为主 Agent
 * - subagent：仅作为子 Agent
 */
type AgentMode = "all" | "primary" | "subagent"

/**
 * 可用工具列表
 *
 * 这些工具可以由 Agent 使用。
 */
const AVAILABLE_TOOLS = [
  "bash",      // Bash 命令执行
  "read",      // 文件读取
  "write",     // 文件写入
  "edit",      // 文件编辑
  "list",      // 目录列表
  "glob",      // 文件搜索
  "grep",      // 内容搜索
  "webfetch",  // 网页获取
  "task",      // 任务执行
  "todowrite", // TODO 写入
  "todoread",  // TODO 读取
]

/**
 * Agent 创建命令
 *
 * 创建一个新的 Agent 配置文件。
 */
const AgentCreateCommand = cmd({
  command: "create",
  describe: "create a new agent",
  builder: (yargs: Argv) =>
    yargs
      // 路径选项
      .option("path", {
        type: "string",
        describe: "directory path to generate the agent file",
      })
      // 描述选项
      .option("description", {
        type: "string",
        describe: "what the agent should do",
      })
      // 模式选项
      .option("mode", {
        type: "string",
        describe: "agent mode",
        choices: ["all", "primary", "subagent"] as const,
      })
      // 工具选项
      .option("tools", {
        type: "string",
        describe: `comma-separated list of tools to enable (default: all). Available: "${AVAILABLE_TOOLS.join(", ")}"`,
      })
      // 模型选项
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      }),
  async handler(args) {
    // 提供实例上下文
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        // 获取 CLI 参数
        const cliPath = args.path
        const cliDescription = args.description
        const cliMode = args.mode as AgentMode | undefined
        const cliTools = args.tools

        // 检查是否完全非交互模式（所有参数都已提供）
        const isFullyNonInteractive = cliPath && cliDescription && cliMode && cliTools !== undefined

        // 如果不是完全非交互模式，显示欢迎信息
        if (!isFullyNonInteractive) {
          UI.empty()
          prompts.intro("Create agent")
        }

        // 获取当前项目
        const project = Instance.project

        // 确定作用域/路径
        let targetPath: string
        if (cliPath) {
          // 如果 CLI 指定了路径，使用 cliPath/agent
          targetPath = path.join(cliPath, "agent")
        } else {
          // 否则让用户选择作用域
          let scope: "global" | "project" = "global"
          if (project.vcs === "git") {
            // 如果是 Git 项目，让用户选择
            const scopeResult = await prompts.select({
              message: "Location",
              options: [
                {
                  label: "Current project",
                  value: "project" as const,
                  hint: Instance.worktree,
                },
                {
                  label: "Global",
                  value: "global" as const,
                  hint: Global.Path.config,
                },
              ],
            })
            if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
            scope = scopeResult
          }
          // 根据作用域构建目标路径
          targetPath = path.join(
            scope === "global" ? Global.Path.config : path.join(Instance.worktree, ".opencode"),
            "agent",
          )
        }

        // 获取 Agent 描述
        let description: string
        if (cliDescription) {
          description = cliDescription
        } else {
          // 让用户输入描述
          const query = await prompts.text({
            message: "Description",
            placeholder: "What should this agent do?",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(query)) throw new UI.CancelledError()
          description = query
        }

        // 生成 Agent 配置
        const spinner = prompts.spinner()
        spinner.start("Generating agent configuration...")
        // 解析模型参数（如果提供）
        const model = args.model ? Provider.parseModel(args.model) : undefined
        // 调用 LLM 生成 Agent
        const generated = await Agent.generate({ description, model }).catch((error) => {
          spinner.stop(`LLM failed to generate agent: ${error.message}`, 1)
          if (isFullyNonInteractive) process.exit(1)
          throw new UI.CancelledError()
        })
        spinner.stop(`Agent ${generated.identifier} generated`)

        // 选择工具
        let selectedTools: string[]
        if (cliTools !== undefined) {
          // 如果 CLI 指定了工具，解析逗号分隔的列表
          selectedTools = cliTools ? cliTools.split(",").map((t) => t.trim()) : AVAILABLE_TOOLS
        } else {
          // 让用户多选工具
          const result = await prompts.multiselect({
            message: "Select tools to enable",
            options: AVAILABLE_TOOLS.map((tool) => ({
              label: tool,
              value: tool,
            })),
            initialValues: AVAILABLE_TOOLS,
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          selectedTools = result
        }

        // 获取 Agent 模式
        let mode: AgentMode
        if (cliMode) {
          mode = cliMode
        } else {
          // 让用户选择模式
          const modeResult = await prompts.select({
            message: "Agent mode",
            options: [
              {
                label: "All",
                value: "all" as const,
                hint: "Can function in both primary and subagent roles",
              },
              {
                label: "Primary",
                value: "primary" as const,
                hint: "Acts as a primary/main agent",
              },
              {
                label: "Subagent",
                value: "subagent" as const,
                hint: "Can be used as a subagent by other agents",
              },
            ],
            initialValue: "all" as const,
          })
          if (prompts.isCancel(modeResult)) throw new UI.CancelledError()
          mode = modeResult
        }

        // 构建工具配置（禁用未选择的工具）
        const tools: Record<string, boolean> = {}
        for (const tool of AVAILABLE_TOOLS) {
          if (!selectedTools.includes(tool)) {
            tools[tool] = false
          }
        }

        // 构建 Frontmatter
        const frontmatter: {
          description: string
          mode: AgentMode
          tools?: Record<string, boolean>
        } = {
          description: generated.whenToUse,
          mode,
        }
        // 如果有禁用的工具，添加到 frontmatter
        if (Object.keys(tools).length > 0) {
          frontmatter.tools = tools
        }

        // 写入文件
        // 使用 gray-matter 将 system prompt 和 frontmatter 组合
        const content = matter.stringify(generated.systemPrompt, frontmatter)
        const filePath = path.join(targetPath, `${generated.identifier}.md`)

        // 确保目录存在
        await fs.mkdir(targetPath, { recursive: true })

        // 检查文件是否已存在
        const file = Bun.file(filePath)
        if (await file.exists()) {
          if (isFullyNonInteractive) {
            console.error(`Error: Agent file already exists: ${filePath}`)
            process.exit(1)
          }
          prompts.log.error(`Agent file already exists: ${filePath}`)
          throw new UI.CancelledError()
        }

        // 写入 Agent 文件
        await Bun.write(filePath, content)

        // 显示成功消息
        if (isFullyNonInteractive) {
          console.log(filePath)
        } else {
          prompts.log.success(`Agent created: ${filePath}`)
          prompts.outro("Done")
        }
      },
    })
  },
})

/**
 * Agent 列出命令
 *
 * 列出所有可用的 Agent。
 */
const AgentListCommand = cmd({
  command: "list",
  describe: "list all available agents",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        // 获取所有 Agent 列表
        const agents = await Agent.list()
        // 排序：原生 Agent 优先，然后按名称排序
        const sortedAgents = agents.sort((a, b) => {
          if (a.native !== b.native) {
            return a.native ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })

        // 输出每个 Agent 的信息
        for (const agent of sortedAgents) {
          process.stdout.write(`${agent.name} (${agent.mode})` + EOL)
          process.stdout.write(`  ${JSON.stringify(agent.permission, null, 2)}` + EOL)
        }
      },
    })
  },
})

/**
 * Agent 命令组
 *
 * 管理 Agents 的父命令。
 */
export const AgentCommand = cmd({
  command: "agent",
  describe: "manage agents",
  builder: (yargs) => yargs.command(AgentCreateCommand).command(AgentListCommand).demandCommand(),
  async handler() {},
})
